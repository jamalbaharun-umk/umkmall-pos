import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

const DAY = 86_400_000;
/** YYYY-MM-DD in the store's day (Asia/Jakarta, UTC+7), `offset` days from today. */
const day = (offset = 0) =>
  new Date(Date.now() + 7 * 3_600_000 + offset * DAY)
    .toISOString()
    .slice(0, 10);

describe('expense log and profit and loss (UMK-1984)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const post = (auth: string, url: string, body: object = {}, key?: string) => {
    const r = http().post(url).set('Authorization', auth);
    if (key) r.set('Idempotency-Key', key);
    return r.send(body);
  };
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);
  const patch = (auth: string, url: string, body: object) =>
    http().patch(url).set('Authorization', auth).send(body);
  const put = (auth: string, url: string, body: object) =>
    http().put(url).set('Authorization', auth).send(body);

  const spend = (auth: string, body: object, key: string = randomUUID()) =>
    post(auth, '/expenses', body, key);
  const open = (auth: string, openingCash = 100_000) =>
    post(auth, '/shifts/open', { openingCash }).expect(201);
  const close = (auth: string, countedCash: number) =>
    post(auth, '/shifts/current/close', { countedCash }).expect(200);
  const current = async (auth: string) =>
    (await get(auth, '/shifts/current').expect(200)).body.shift as Record<
      string,
      unknown
    >;
  const ledger = (tenantId: string) =>
    admin<
      { direction: string; kind: string; amount: string; ref_id: string }[]
    >`
      select direction, kind, amount, ref_id from pos.shift_cash_entries
      where tenant_id = ${tenantId} order by created_at, id`;
  const rowCount = async (tenantId: string) =>
    (
      await admin<{ n: number }[]>`
        select count(*)::int as n from pos.expenses where tenant_id = ${tenantId}`
    )[0].n;

  async function product(s: Store, name: string, price: number, cost: number) {
    const cat = await post(s.auth, '/catalog/categories', {
      name: `Kat ${randomUUID().slice(0, 8)}`,
    }).expect(201);
    const p = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name,
      costPrice: cost,
      sellingPrice: price,
    }).expect(201);
    await post(s.auth, '/stock/opening', {
      productId: p.body.id,
      qty: 100,
    }).expect(201);
    return p.body.id as string;
  }
  const sell = async (s: { auth: string }, body: object) =>
    (await post(s.auth, '/sales', body, randomUUID()).expect(201)).body as {
      id: string;
      total: number;
    };

  describe('recording', () => {
    it('an expense paid outside the drawer: stored with its category, today by default, and no drawer changes', async () => {
      const s = await createStore();
      await open(s.auth);
      const res = await spend(s.auth, {
        amount: 65_000,
        category: 'lainnya',
        source: 'outside',
        note: '  Plastik & kantong ',
      }).expect(201);
      expect(res.body).toMatchObject({
        kind: 'expense',
        category: 'lainnya',
        categoryLabel: 'Lainnya',
        amount: 65_000,
        note: 'Plastik & kantong',
        date: day(),
        source: 'outside',
        shiftId: null,
        drawerCashBefore: null,
        exceedsDrawerCash: false,
        actorId: s.userId,
        actorKind: 'owner',
        actorName: 'Pemilik',
        voidedAt: null,
        drawerReversed: null,
      });
      expect(await ledger(s.tenantId)).toEqual([]);
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 100_000,
        cashOut: 0,
        expenses: 0,
      });
      // Backdating is allowed for money that never touched a drawer.
      const old = await spend(s.auth, {
        amount: 400_000,
        category: 'sewa',
        source: 'outside',
        date: day(-40),
      }).expect(201);
      expect(old.body.date).toBe(day(-40));
      const read = await get(s.auth, `/expenses/${old.body.id}`).expect(200);
      expect(read.body).toEqual(old.body);
      // No shift at all is needed either.
      await close(s.auth, 100_000);
      await spend(s.auth, {
        amount: 1000,
        category: 'gaji',
        source: 'outside',
      }).expect(201);
    });

    it('an expense paid from the drawer lowers the open shift once: live, at close and in the shift report', async () => {
      const s = await createStore();
      await open(s.auth, 100_000);
      const first = await spend(s.auth, {
        amount: 45_000,
        category: 'listrik_air',
        source: 'drawer',
        note: 'token listrik',
      }).expect(201);
      const shift = await current(s.auth);
      expect(first.body).toMatchObject({
        source: 'drawer',
        date: day(),
        shiftId: shift.id,
        drawerCashBefore: 100_000,
        exceedsDrawerCash: false,
      });
      expect(shift).toMatchObject({
        expectedCash: 55_000,
        cashIn: 0,
        cashOut: 45_000,
        expenses: 45_000,
        expenseReversals: 0,
      });
      expect(await ledger(s.tenantId)).toEqual([
        {
          direction: 'out',
          kind: 'expense',
          amount: '45000',
          ref_id: first.body.id,
        },
      ]);
      // More than the drawer holds (Rp55.000): allowed, and flagged for the warning.
      const big = await spend(s.auth, {
        amount: 56_000,
        category: 'gaji',
        source: 'drawer',
      }).expect(201);
      expect(big.body).toMatchObject({
        drawerCashBefore: 55_000,
        exceedsDrawerCash: true,
      });
      const detail = await get(s.auth, `/shifts/${shift.id as string}`).expect(
        200,
      );
      expect(detail.body.cashEntries).toMatchObject([
        { direction: 'out', kind: 'expense', amount: 45_000 },
        { direction: 'out', kind: 'expense', amount: 56_000 },
      ]);
      const closed = await close(s.auth, 0);
      expect(closed.body).toMatchObject({
        expectedCash: -1000,
        cashOut: 101_000,
        expenses: 101_000,
        difference: 1000,
      });
      const report = await get(
        s.auth,
        `/reports/shifts?from=${day(-1)}&to=${day(1)}`,
      ).expect(200);
      expect(report.body.rows).toMatchObject([
        {
          shiftId: shift.id,
          expenses: 101_000,
          expenseReversals: 0,
          cashOut: 101_000,
          expectedCash: -1000,
        },
      ]);
    });

    it('a drawer expense needs an open shift and is dated today: 422, nothing written', async () => {
      const s = await createStore();
      const none = await spend(s.auth, {
        amount: 10_000,
        category: 'transport',
        source: 'drawer',
      }).expect(422);
      expect(none.body.message).toBe(
        'Buka shift dulu untuk mencatat pengeluaran dari laci',
      );
      await open(s.auth);
      const dated = await spend(s.auth, {
        amount: 10_000,
        category: 'transport',
        source: 'drawer',
        date: day(-1),
      }).expect(422);
      expect(dated.body.errors).toEqual({
        date: 'Pengeluaran dari laci selalu bertanggal hari ini',
      });
      expect(await rowCount(s.tenantId)).toBe(0);
      expect(await ledger(s.tenantId)).toEqual([]);
      expect(await current(s.auth)).toMatchObject({ expectedCash: 100_000 });
      // Today, said out loud, is fine.
      await spend(s.auth, {
        amount: 10_000,
        category: 'transport',
        source: 'drawer',
        date: day(),
      }).expect(201);
    });

    it('a repeated Idempotency-Key returns the first expense and writes nothing; another body is refused', async () => {
      const s = await createStore();
      await open(s.auth);
      const key = randomUUID();
      const body = { amount: 30_000, category: 'transport', source: 'drawer' };
      const first = await spend(s.auth, body, key).expect(201);
      const again = await spend(s.auth, body, key).expect(201);
      expect(again.body).toEqual(first.body);
      // Two at once with a fresh key: still one expense.
      const key2 = randomUUID();
      const outside = { amount: 7000, category: 'lainnya', source: 'outside' };
      const both = await Promise.all([
        spend(s.auth, outside, key2),
        spend(s.auth, outside, key2),
      ]);
      expect(both.map((r) => r.status)).toEqual([201, 201]);
      expect(both[0].body.id).toBe(both[1].body.id);
      expect(await rowCount(s.tenantId)).toBe(2);
      expect(await ledger(s.tenantId)).toHaveLength(1);
      expect(await current(s.auth)).toMatchObject({ expectedCash: 70_000 });
      const other = await spend(
        s.auth,
        { ...body, amount: 31_000 },
        key,
      ).expect(422);
      expect(other.body.errors).toEqual({
        idempotencyKey: 'Kunci ini sudah dipakai untuk pengeluaran lain',
      });
      expect(await rowCount(s.tenantId)).toBe(2);
    });

    it('refuses bad input with 422 and an Indonesian message, never 500', async () => {
      const s = await createStore();
      const ok = { amount: 1000, category: 'sewa', source: 'outside' };
      const cases: [object, string][] = [
        [{ ...ok, amount: 0 }, 'amount'],
        [{ ...ok, amount: -5 }, 'amount'],
        [{ ...ok, amount: 10.5 }, 'amount'],
        [{ ...ok, amount: '1000' }, 'amount'],
        [{ ...ok, amount: undefined }, 'amount'],
        [{ ...ok, category: 'jajan' }, 'category'],
        [{ ...ok, category: undefined }, 'category'],
        [{ ...ok, source: 'bank' }, 'source'],
        [{ ...ok, source: undefined }, 'source'],
        [{ ...ok, date: day(1) }, 'date'],
        [{ ...ok, date: '2026-02-31' }, 'date'],
        [{ ...ok, date: '25-11-2026' }, 'date'],
        [{ ...ok, note: 'x'.repeat(201) }, 'note'],
        [{ ...ok, tenantId: randomUUID() }, 'tenantId'],
        [{ ...ok, kind: 'expense' }, 'kind'],
      ];
      for (const [body, field] of cases) {
        const res = await spend(s.auth, body).expect(422);
        expect(Object.keys(res.body.errors)).toEqual([field]);
        expect(JSON.stringify(res.body)).not.toMatch(/zod|Expected|Required/);
      }
      const future = await spend(s.auth, { ...ok, date: day(1) }).expect(422);
      expect(future.body.message).toBe('Tanggal tidak boleh di masa depan');
      // The key is required and has a shape.
      const noKey = await post(s.auth, '/expenses', ok).expect(422);
      expect(Object.keys(noKey.body.errors)).toEqual(['idempotencyKey']);
      await spend(s.auth, ok, 'short').expect(422);
      for (const q of [
        'period=year',
        `period=today&from=${day()}&to=${day()}`,
        `from=${day()}`,
        `to=${day()}`,
        `from=${day()}&to=${day(-1)}`,
        `from=${day(-400)}&to=${day()}`,
        'from=2026-02-31&to=2026-03-01',
        'page=0',
        'status=deleted',
      ]) {
        await get(s.auth, `/expenses?${q}`).expect(422);
        if (!/page|status/.test(q)) {
          await get(s.auth, `/reports/profit-loss?${q}`).expect(422);
          await get(s.auth, `/expenses/csv?${q}`).expect(422);
        }
      }
      expect(await rowCount(s.tenantId)).toBe(0);
      await get(s.auth, '/expenses/not-a-uuid').expect(404);
      await get(s.auth, `/expenses/${randomUUID()}`).expect(404);
    });

    it('a supplier payment is its own kind: listed, out of the drawer, never an expense in the totals', async () => {
      const s = await createStore();
      await open(s.auth);
      const pay = await spend(s.auth, {
        amount: 40_000,
        category: 'bayar_pemasok',
        source: 'drawer',
      }).expect(201);
      expect(pay.body).toMatchObject({
        kind: 'supplier_payment',
        categoryLabel: 'Bayar pemasok',
      });
      await spend(s.auth, {
        amount: 15_000,
        category: 'bayar_pemasok',
        source: 'outside',
      }).expect(201);
      await spend(s.auth, {
        amount: 5000,
        category: 'transport',
        source: 'outside',
      }).expect(201);
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 60_000,
        expenses: 40_000,
      });
      const list = await get(s.auth, '/expenses').expect(200);
      expect(list.body.total).toBe(3);
      expect(list.body.summary).toEqual({
        count: 3,
        expenses: 5000,
        supplierPayments: 55_000,
        fromDrawer: 40_000,
        outside: 20_000,
        byCategory: [
          {
            category: 'bayar_pemasok',
            label: 'Bayar pemasok',
            kind: 'supplier_payment',
            total: 55_000,
            count: 2,
          },
          {
            category: 'transport',
            label: 'Transport',
            kind: 'expense',
            total: 5000,
            count: 1,
          },
        ],
      });
      const pl = await get(s.auth, '/reports/profit-loss').expect(200);
      expect(pl.body.current).toMatchObject({
        expenses: 5000,
        supplierPayments: 55_000,
        netProfit: -5000,
      });
      expect(pl.body.topExpenses).toEqual([
        { category: 'transport', label: 'Transport', total: 5000, count: 1 },
      ]);
      const cats = await get(s.auth, '/expenses/categories').expect(200);
      expect(
        (cats.body.data as { label: string }[]).map((c) => c.label),
      ).toEqual([
        'Bayar pemasok',
        'Listrik & air',
        'Sewa',
        'Gaji',
        'Transport',
        'Lainnya',
      ]);
    });
  });

  describe('list', () => {
    const amounts = (res: { body: { data: { amount: number }[] } }) =>
      res.body.data.map((r) => r.amount);
    it('filters by period or dates, pages newest first, and totals the whole range', async () => {
      const s = await createStore();
      const out = (amount: number, category: string, date?: string) =>
        spend(s.auth, { amount, category, source: 'outside', date }).expect(
          201,
        );
      await out(1000, 'transport');
      await out(2000, 'listrik_air');
      await out(4000, 'transport', day(-1));
      await out(8000, 'sewa', day(-45));
      const voided = await out(16_000, 'gaji');
      await post(s.auth, `/expenses/${voided.body.id}/void`).expect(200);

      const today = await get(s.auth, '/expenses').expect(200);
      expect(today.body).toMatchObject({
        period: 'today',
        from: day(),
        to: day(),
        total: 2,
        page: 1,
        perPage: 20,
      });
      expect(amounts(today)).toEqual([2000, 1000]);
      expect(today.body.summary).toMatchObject({
        count: 2,
        expenses: 3000,
        outside: 3000,
        fromDrawer: 0,
      });

      const range = await get(
        s.auth,
        `/expenses?from=${day(-1)}&to=${day()}&perPage=2`,
      ).expect(200);
      expect(range.body).toMatchObject({ period: null, total: 3 });
      expect(amounts(range)).toEqual([2000, 1000]);
      // The summary is of the range, not of the page.
      expect(range.body.summary).toMatchObject({ count: 3, expenses: 7000 });
      expect(range.body.summary.byCategory).toMatchObject([
        { category: 'transport', total: 5000, count: 2 },
        { category: 'listrik_air', total: 2000, count: 1 },
      ]);
      const page2 = await get(
        s.auth,
        `/expenses?from=${day(-1)}&to=${day()}&perPage=2&page=2`,
      ).expect(200);
      expect(amounts(page2)).toEqual([4000]);

      const far = await get(
        s.auth,
        `/expenses?from=${day(-60)}&to=${day()}`,
      ).expect(200);
      expect(far.body.summary.expenses).toBe(15_000);
      for (const period of ['week', 'month']) {
        const res = await get(s.auth, `/expenses?period=${period}`).expect(200);
        expect(res.body).toMatchObject({ period, to: day() });
        expect(res.body.from <= day()).toBe(true);
        expect(res.body.summary.expenses).toBeGreaterThanOrEqual(3000);
      }

      // Voided rows: hidden unless asked for, never in the totals.
      const gone = await get(s.auth, '/expenses?status=voided').expect(200);
      expect(gone.body.data).toMatchObject([{ id: voided.body.id }]);
      expect(gone.body.summary.expenses).toBe(3000);
      const all = await get(s.auth, '/expenses?status=all').expect(200);
      expect(all.body.total).toBe(3);
    });
  });

  describe('update and void', () => {
    it('edits category and note always; amount and date only of an outside expense', async () => {
      const s = await createStore();
      await open(s.auth);
      const outside = (
        await spend(s.auth, {
          amount: 5000,
          category: 'lainnya',
          source: 'outside',
          note: 'salah',
        }).expect(201)
      ).body;
      const edited = await patch(s.auth, `/expenses/${outside.id}`, {
        category: 'bayar_pemasok',
        note: null,
        amount: 6000,
        date: day(-3),
      }).expect(200);
      expect(edited.body).toMatchObject({
        kind: 'supplier_payment',
        category: 'bayar_pemasok',
        note: null,
        amount: 6000,
        date: day(-3),
      });
      const [audit] = await admin`
        select updated_by_id, updated_by_kind, updated_at > created_at as later
        from pos.expenses where id = ${outside.id}`;
      expect(audit).toEqual({
        updated_by_id: s.userId,
        updated_by_kind: 'owner',
        later: true,
      });
      for (const [body, field] of [
        [{ date: day(1) }, 'date'],
        [{ amount: 0 }, 'amount'],
        [{ category: 'x' }, 'category'],
        [{ source: 'drawer', note: 'x' }, 'source'],
        [{}, '_'],
      ] as [object, string][]) {
        const res = await patch(s.auth, `/expenses/${outside.id}`, body).expect(
          422,
        );
        expect(Object.keys(res.body.errors)).toEqual([field]);
      }

      const drawer = (
        await spend(s.auth, {
          amount: 20_000,
          category: 'transport',
          source: 'drawer',
        }).expect(201)
      ).body;
      const amount = await patch(s.auth, `/expenses/${drawer.id}`, {
        amount: 25_000,
      }).expect(422);
      expect(amount.body.errors.amount).toMatch(/Batalkan lalu catat ulang/);
      await patch(s.auth, `/expenses/${drawer.id}`, { date: day(-1) }).expect(
        422,
      );
      const relabel = await patch(s.auth, `/expenses/${drawer.id}`, {
        category: 'gaji',
        note: 'uang makan',
        amount: 20_000, // unchanged: accepted
      }).expect(200);
      expect(relabel.body).toMatchObject({
        category: 'gaji',
        kind: 'expense',
        note: 'uang makan',
        amount: 20_000,
      });
      expect(await current(s.auth)).toMatchObject({ expectedCash: 80_000 });
      expect(await ledger(s.tenantId)).toHaveLength(1);

      await post(s.auth, `/expenses/${outside.id}/void`).expect(200);
      const res = await patch(s.auth, `/expenses/${outside.id}`, {
        note: 'x',
      }).expect(409);
      expect(res.body.message).toBe('Pengeluaran ini sudah dibatalkan');
    });

    it('void of a drawer expense in an open shift puts the cash back once, in that shift, whoever voids', async () => {
      const s = await createStore();
      const rina = await createCashier(app, s, [
        'sales.create',
        'expenses.manage',
      ]);
      await open(rina.auth, 50_000);
      await open(s.auth, 100_000);
      const e = (
        await spend(rina.auth, {
          amount: 12_000,
          category: 'transport',
          source: 'drawer',
        }).expect(201)
      ).body;
      expect(e).toMatchObject({ actorKind: 'cashier', actorName: 'Sari' });
      expect(await current(rina.auth)).toMatchObject({ expectedCash: 38_000 });

      // The owner voids it: the cash-in lands in Rina's shift, not the owner's.
      const voided = await post(s.auth, `/expenses/${e.id}/void`, {
        reason: 'Salah catat',
      }).expect(200);
      expect(voided.body).toMatchObject({
        id: e.id,
        voidedById: s.userId,
        voidedByName: 'Pemilik',
        voidReason: 'Salah catat',
        drawerReversed: true,
      });
      expect(voided.body.voidedAt).toEqual(expect.any(String));
      expect(await current(rina.auth)).toMatchObject({
        expectedCash: 50_000,
        cashOut: 12_000,
        cashIn: 12_000,
        expenses: 12_000,
        expenseReversals: 12_000,
      });
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 100_000,
        cashIn: 0,
      });
      // Again: the same answer, nothing more written.
      const again = await post(s.auth, `/expenses/${e.id}/void`, {
        reason: 'lain',
      }).expect(200);
      expect(again.body).toEqual(voided.body);
      expect(await ledger(s.tenantId)).toEqual([
        { direction: 'out', kind: 'expense', amount: '12000', ref_id: e.id },
        {
          direction: 'in',
          kind: 'expense_reversal',
          amount: '12000',
          ref_id: e.id,
        },
      ]);
      expect((await get(s.auth, '/expenses').expect(200)).body).toMatchObject({
        total: 0,
        summary: { count: 0, expenses: 0, fromDrawer: 0 },
      });
      await post(s.auth, `/expenses/${e.id}/void`, { foo: 1 }).expect(422);
    });

    it('void of a drawer expense of a closed shift changes no drawer: the closed shift stays as counted', async () => {
      const s = await createStore();
      const first = (await open(s.auth, 100_000)).body;
      const e = (
        await spend(s.auth, {
          amount: 30_000,
          category: 'listrik_air',
          source: 'drawer',
        }).expect(201)
      ).body;
      await close(s.auth, 70_000);
      const before = await admin`
        select * from pos.shifts where id = ${first.id}`;
      await open(s.auth, 70_000);

      const voided = await post(s.auth, `/expenses/${e.id}/void`).expect(200);
      expect(voided.body).toMatchObject({
        drawerReversed: false,
        voidReason: null,
      });
      expect(
        await admin`select * from pos.shifts where id = ${first.id}`,
      ).toEqual(before);
      expect(before[0].expected_cash).toBe('70000');
      expect(await ledger(s.tenantId)).toEqual([
        { direction: 'out', kind: 'expense', amount: '30000', ref_id: e.id },
      ]);
      // The drawer open now did not receive that money.
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 70_000,
        cashIn: 0,
      });
      const old = await get(s.auth, `/shifts/${first.id as string}`).expect(
        200,
      );
      expect(old.body).toMatchObject({
        expectedCash: 70_000,
        expenses: 30_000,
        expenseReversals: 0,
      });
      // Out of the totals all the same.
      expect(
        (await get(s.auth, '/reports/profit-loss').expect(200)).body.current
          .expenses,
      ).toBe(0);
    });
  });

  describe('access', () => {
    it('needs expenses.manage: a plain cashier gets 403 everywhere and does not see profit', async () => {
      const s = await createStore();
      const e = (
        await spend(s.auth, {
          amount: 1000,
          category: 'sewa',
          source: 'outside',
        }).expect(201)
      ).body;
      const cashier = await createCashier(app, s, [
        'sales.create',
        'reports.view',
      ]);
      await spend(cashier.auth, {
        amount: 1000,
        category: 'sewa',
        source: 'outside',
      }).expect(403);
      for (const url of [
        '/expenses',
        '/expenses/csv',
        '/expenses/categories',
        `/expenses/${e.id}`,
        '/reports/profit-loss',
        '/reports/profit-loss/csv',
      ])
        await get(cashier.auth, url).expect(403);
      await patch(cashier.auth, `/expenses/${e.id}`, { note: 'x' }).expect(403);
      await post(cashier.auth, `/expenses/${e.id}/void`).expect(403);
      await http().get('/expenses').expect(401);
      expect(await rowCount(s.tenantId)).toBe(1);

      // With the permission (and no reports.view) a cashier records and reads the report.
      const keeper = await createCashier(app, s, ['expenses.manage']);
      await spend(keeper.auth, {
        amount: 2000,
        category: 'gaji',
        source: 'outside',
      }).expect(201);
      await get(keeper.auth, '/reports/profit-loss').expect(200);
      await get(keeper.auth, '/reports/dashboard').expect(403);
    });

    it('cross-tenant: store B gets 404 on read, update and void of store A`s expense and sees none of it', async () => {
      const a = await createStore();
      const b = await createStore();
      await open(a.auth);
      const e = (
        await spend(a.auth, {
          amount: 9000,
          category: 'transport',
          source: 'drawer',
        }).expect(201)
      ).body;
      await get(b.auth, `/expenses/${e.id}`).expect(404);
      await patch(b.auth, `/expenses/${e.id}`, { note: 'x' }).expect(404);
      await post(b.auth, `/expenses/${e.id}/void`).expect(404);
      expect((await get(b.auth, '/expenses').expect(200)).body).toMatchObject({
        total: 0,
        data: [],
        summary: { count: 0, expenses: 0 },
      });
      expect(
        (await get(b.auth, '/reports/profit-loss').expect(200)).body.current,
      ).toMatchObject({ expenses: 0, revenue: 0, netProfit: 0 });
      expect(await get(b.auth, '/expenses/csv').expect(200)).toMatchObject({
        text: expect.not.stringContaining('9000'),
      });
      // A's key is A's: B may use the same one for its own expense.
      const key = randomUUID();
      const body = { amount: 500, category: 'lainnya', source: 'outside' };
      const mine = await spend(a.auth, body, key).expect(201);
      const theirs = await spend(b.auth, body, key).expect(201);
      expect(theirs.body.id).not.toBe(mine.body.id);
      // A's row is untouched.
      expect(
        (await get(a.auth, `/expenses/${e.id}`).expect(200)).body,
      ).toMatchObject({ note: null, voidedAt: null });
      expect(await current(a.auth)).toMatchObject({ expectedCash: 91_000 });
    });
  });

  describe('profit and loss', () => {
    /**
     * By hand, tax 10% from sale B on:
     *   A 3 × Teh 5.000 (cost 3.000)              total 15.000  cost  9.000
     *   B Teh + Kopi 8.000 (cost 4.000) + tax      total 14.300  cost  7.000  tax 1.300
     *   C Permen 1.250 (cost 700) + tax, cash      total  1.375  cost    700  tax   125  rounding 25
     *   D Kopi on kasbon + tax                     total  8.800  cost  4.000  tax   800
     *   E 2 × Kopi + tax, voided the same day      nets to nothing (one void)
     * revenue 39.475, tax 2.225, cost 20.700, gross profit 18.775, rounding 25.
     * Expenses: listrik 12.000 (drawer) + transport 3.000 + sewa 2.000 = 17.000; a supplier payment of
     * 4.000 and a voided 9.999 are not counted. Net profit 1.775.
     * Yesterday: sale F (Teh + tax: 5.500, cost 3.000) and gaji 1.000 → net 1.500.
     */
    async function knownStore() {
      const s = await createStore();
      const teh = await product(s, 'Es Teh', 5000, 3000);
      const kopi = await product(s, 'Kopi Susu', 8000, 4000);
      const permen = await product(s, 'Permen', 1250, 700);
      await open(s.auth);
      await sell(s, { lines: [{ productId: teh, qty: 3 }], paid: 15_000 });
      await put(s.auth, '/sales/settings', { taxBps: 1000 }).expect(200);
      await sell(s, {
        lines: [
          { productId: teh, qty: 1 },
          { productId: kopi, qty: 1 },
        ],
        paid: 14_300,
      });
      await sell(s, { lines: [{ productId: permen, qty: 1 }], paid: 1400 });
      const kasbon = await post(s.auth, '/payment-methods', {
        name: 'Kasbon',
        kind: 'credit',
      }).expect(201);
      const member = await post(s.auth, '/members', {
        name: 'Bu Sari',
        code: `M${randomUUID().slice(0, 6)}`,
        phone: '081234567890',
      }).expect(201);
      await sell(s, {
        lines: [{ productId: kopi, qty: 1 }],
        memberId: member.body.id,
        paymentMethodId: kasbon.body.id,
        paid: 0,
      });
      const e = await sell(s, {
        lines: [{ productId: kopi, qty: 2 }],
        paid: 17_600,
      });
      await put(s.auth, '/void-pin', { pin: '482913' }).expect(200);
      await post(
        s.auth,
        `/sales/${e.id}/void`,
        {
          reasonCode: 'customer_cancelled',
          approverId: s.userId,
          pin: '482913',
        },
        randomUUID(),
      ).expect(201);
      // Yesterday's sale: rung up now, moved back exactly one day (so it is before "this moment yesterday").
      const f = await sell(s, {
        lines: [{ productId: teh, qty: 1 }],
        paid: 5500,
      });
      await admin`update pos.sales set created_at = created_at - interval '1 day' where id = ${f.id}`;

      const out = (amount: number, category: string, extra: object = {}) =>
        spend(s.auth, { amount, category, source: 'outside', ...extra }).expect(
          201,
        );
      await spend(s.auth, {
        amount: 12_000,
        category: 'listrik_air',
        source: 'drawer',
      }).expect(201);
      await out(3000, 'transport');
      await out(2000, 'sewa');
      await spend(s.auth, {
        amount: 4000,
        category: 'bayar_pemasok',
        source: 'drawer',
      }).expect(201);
      const wrong = await out(9999, 'lainnya');
      await post(s.auth, `/expenses/${wrong.body.id}/void`).expect(200);
      await out(1000, 'gaji', { date: day(-1) });
      return { s, teh };
    }

    const TODAY = {
      from: day(),
      to: day(),
      salesCount: 4,
      voidCount: 1,
      revenue: 39_475,
      tax: 2225,
      cost: 20_700,
      grossProfit: 18_775,
      expenses: 17_000,
      netProfit: 1775,
      rounding: 25,
      supplierPayments: 4000,
    };
    const YESTERDAY = {
      from: day(-1),
      to: day(-1),
      salesCount: 1,
      voidCount: 0,
      revenue: 5500,
      tax: 500,
      cost: 3000,
      grossProfit: 2500,
      expenses: 1000,
      netProfit: 1500,
      rounding: 0,
      supplierPayments: 0,
    };

    it('today against yesterday: revenue with tax, stored cost, void reversed, rounding outside, supplier payments out', async () => {
      const { s } = await knownStore();
      const res = await get(s.auth, '/reports/profit-loss').expect(200);
      expect(res.body).toEqual({
        period: 'today',
        timezone: 'Asia/Jakarta',
        from: day(),
        to: day(),
        current: TODAY,
        previous: YESTERDAY,
        netProfitChange: 275,
        topExpenses: [
          {
            category: 'listrik_air',
            label: 'Listrik & air',
            total: 12_000,
            count: 1,
          },
          { category: 'transport', label: 'Transport', total: 3000, count: 1 },
          { category: 'sewa', label: 'Sewa', total: 2000, count: 1 },
        ],
      });
      // The same sales as the dashboard, which takes tax out of its gross profit.
      const dash = await get(s.auth, '/reports/dashboard?period=today').expect(
        200,
      );
      expect(dash.body.current).toMatchObject({
        revenue: TODAY.revenue,
        cost: TODAY.cost,
        tax: TODAY.tax,
        grossProfit: TODAY.grossProfit - TODAY.tax,
        rounding: 25,
      });
      // The drawer: 100.000 + cash sales (15.000 + 14.300 + 1.400 + 17.600 + 5.500) − void 17.600 − 16.000.
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 120_200,
        expenses: 16_000,
      });
    });

    it('a date range compares whole days with the same span just before; week and month hold both days', async () => {
      const { s } = await knownStore();
      const both = {
        salesCount: 5,
        voidCount: 1,
        revenue: 44_975,
        tax: 2725,
        cost: 23_700,
        grossProfit: 21_275,
        expenses: 18_000,
        netProfit: 3275,
        rounding: 25,
        supplierPayments: 4000,
      };
      const res = await get(
        s.auth,
        `/reports/profit-loss?from=${day(-1)}&to=${day()}`,
      ).expect(200);
      expect(res.body).toMatchObject({
        period: null,
        from: day(-1),
        to: day(),
        current: { from: day(-1), to: day(), ...both },
        previous: {
          from: day(-3),
          to: day(-2),
          revenue: 0,
          cost: 0,
          expenses: 0,
          netProfit: 0,
        },
        netProfitChange: 3275,
      });
      const only = await get(
        s.auth,
        `/reports/profit-loss?from=${day(-1)}&to=${day(-1)}`,
      ).expect(200);
      expect(only.body.current).toEqual(YESTERDAY);
      // A year back: nothing, and no error on an empty span.
      const empty = await get(
        s.auth,
        `/reports/profit-loss?from=${day(-365)}&to=${day(-300)}`,
      ).expect(200);
      expect(empty.body.current).toMatchObject({ revenue: 0, netProfit: 0 });
      expect(empty.body.topExpenses).toEqual([]);
      for (const period of ['week', 'month']) {
        const r = await get(
          s.auth,
          `/reports/profit-loss?period=${period}`,
        ).expect(200);
        expect(r.body.period).toBe(period);
        expect(r.body.to).toBe(day());
        // Yesterday is in the current span unless today starts the week or the month.
        const c = r.body.from <= day(-1) ? { ...both } : { ...TODAY };
        expect(r.body.current).toMatchObject({
          revenue: c.revenue,
          netProfit: c.netProfit,
          expenses: c.expenses,
        });
        expect(r.body.netProfitChange).toBe(
          r.body.current.netProfit - r.body.previous.netProfit,
        );
      }
    });

    it('the previous period stops at the same moment one period ago (like the dashboard)', async () => {
      const s = await createStore();
      const teh = await product(s, 'Es Teh', 5000, 3000);
      await open(s.auth);
      const early = await sell(s, {
        lines: [{ productId: teh, qty: 1 }],
        paid: 5000,
      });
      const late = await sell(s, {
        lines: [{ productId: teh, qty: 2 }],
        paid: 10_000,
      });
      await admin`update pos.sales set created_at = now() - interval '1 day' - interval '1 minute' where id = ${early.id}`;
      await admin`update pos.sales set created_at = now() - interval '1 day' + interval '1 minute' where id = ${late.id}`;
      const res = await get(s.auth, '/reports/profit-loss').expect(200);
      // Both sales are yesterday's unless this runs in the two minutes around the store's midnight.
      const [{ same }] = await admin<{ same: boolean }[]>`
        select bool_and((created_at at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date - 1) as same
        from pos.sales where id in ${admin([early.id, late.id])}`;
      if (same) {
        expect(res.body.previous).toMatchObject({ revenue: 5000, cost: 3000 });
        const whole = await get(
          s.auth,
          `/reports/profit-loss?from=${day(-1)}&to=${day(-1)}`,
        ).expect(200);
        expect(whole.body.current.revenue).toBe(15_000);
      }
      expect(res.body.current.revenue).toBe(0);
    });

    it('CSV: the expense list and the report, in the reports` format', async () => {
      const { s } = await knownStore();
      const list = await get(s.auth, '/expenses/csv').expect(200);
      expect(list.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(list.headers['content-disposition']).toBe(
        'attachment; filename="pengeluaran.csv"',
      );
      expect(list.text.split('\r\n')).toEqual([
        'Tanggal,Kategori,Sumber uang,Catatan,Dicatat oleh,Jumlah',
        `${day()},Listrik & air,Laci kasir,,Pemilik,12000`,
        `${day()},Transport,Di luar laci,,Pemilik,3000`,
        `${day()},Sewa,Di luar laci,,Pemilik,2000`,
        `${day()},Bayar pemasok,Laci kasir,,Pemilik,4000`,
        'Total pengeluaran,,,,,17000',
        'Total bayar pemasok (bukan pengeluaran),,,,,4000',
        '',
      ]);
      // A note that a spreadsheet would run as a formula is defused, like every report.
      await spend(s.auth, {
        amount: 100,
        category: 'lainnya',
        source: 'outside',
        note: '=1+1',
      }).expect(201);
      expect((await get(s.auth, '/expenses/csv').expect(200)).text).toContain(
        ",'=1+1,",
      );
      const pl = await get(s.auth, '/reports/profit-loss/csv').expect(200);
      expect(pl.headers['content-disposition']).toBe(
        'attachment; filename="untung-rugi.csv"',
      );
      expect(pl.text.split('\r\n')).toEqual([
        `Keterangan,${day()} s.d. ${day()},${day(-1)} s.d. ${day(-1)}`,
        'Hasil jualan,39475,5500',
        'Modal barang terjual,20700,3000',
        'Untung kotor,18775,2500',
        'Pengeluaran,17100,1000',
        'Untung bersih,1675,1500',
        'Pajak (termasuk dalam hasil jualan),2225,500',
        'Pembulatan tunai (di luar hasil jualan),25,0',
        'Bayar pemasok (bukan pengeluaran),4000,0',
        'Pengeluaran: Listrik & air,12000,',
        'Pengeluaran: Transport,3000,',
        'Pengeluaran: Sewa,2000,',
        'Pengeluaran: Lainnya,100,',
        '',
      ]);
    });
  });
});
