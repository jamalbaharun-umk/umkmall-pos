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
  // A second owner connection that holds a row lock while requests are in flight (the race tests).
  const locker = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
    await locker.end();
  });

  /** Resolves once `n` backends of this database wait for a lock: the requests are in flight, in order. */
  async function untilWaiting(n: number) {
    for (let i = 0; i < 400; i++) {
      const [{ waiting }] = await admin<{ waiting: number }[]>`
        select count(*)::int as waiting from pg_locks l
        join pg_stat_activity a on a.pid = l.pid
        where not l.granted and a.datname = current_database()`;
      if (waiting >= n) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`fewer than ${n} requests reached the lock`);
  }
  /** Sends the request now (supertest sends on `then`) and returns its pending response. */
  const send = (req: request.Test) => req.then((res) => res);
  /**
   * Holds the row lock of one shift or expense (`for update`, as the database owner) while `during`
   * starts requests and waits until they queue behind it; the lock is released when `during` returns.
   */
  const holding = <T>(
    table: 'shifts' | 'expenses',
    id: string,
    during: () => Promise<T>,
  ) =>
    locker.begin(async (sql) => {
      await sql`select id from ${sql(`pos.${table}`)} where id = ${id} for update`;
      return during();
    }) as Promise<T>;
  /** YYYY-MM-DD today in `tz`. */
  const dayIn = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

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
  const storeCash = (tenantId: string) =>
    admin<
      {
        direction: string;
        kind: string;
        amount: string;
        ref_id: string;
        actor_id: string;
        note: string | null;
      }[]
    >`
      select direction, kind, amount, ref_id, actor_id, note from pos.store_cash_entries
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
        cashReturnedTo: 'drawer',
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
      // The drawer got it back, so the store cash did not.
      expect(await storeCash(s.tenantId)).toEqual([]);
      expect((await get(s.auth, '/expenses').expect(200)).body).toMatchObject({
        total: 0,
        summary: { count: 0, expenses: 0, fromDrawer: 0 },
      });
      await post(s.auth, `/expenses/${e.id}/void`, { foo: 1 }).expect(422);
      // An expense paid outside the drawer returns no cash anywhere.
      const out = await spend(s.auth, {
        amount: 700,
        category: 'lainnya',
        source: 'outside',
      }).expect(201);
      const gone = await post(s.auth, `/expenses/${out.body.id}/void`).expect(
        200,
      );
      expect(gone.body).toMatchObject({
        drawerReversed: null,
        cashReturnedTo: null,
      });
      expect(await storeCash(s.tenantId)).toEqual([]);
    });

    it('void of a drawer expense of a closed shift: the cash goes into the store cash, by whoever voids, once; no drawer changes', async () => {
      const s = await createStore();
      const other = await createStore();
      const keeper = await createCashier(app, s, [
        'expenses.manage',
        'reports.view',
      ]);
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

      // Another store cannot void it and gets no cash for it.
      await post(other.auth, `/expenses/${e.id}/void`).expect(404);
      expect(await storeCash(s.tenantId)).toEqual([]);
      const voided = await post(keeper.auth, `/expenses/${e.id}/void`, {
        reason: 'Salah catat',
      }).expect(200);
      expect(voided.body).toMatchObject({
        drawerReversed: false,
        cashReturnedTo: 'store_cash',
        voidReason: 'Salah catat',
        voidedById: keeper.staffId,
        voidedByName: 'Sari',
      });
      // One cash-in of the store, for the expense, by the cashier who voided.
      const entry = {
        direction: 'in',
        kind: 'expense_void',
        amount: '30000',
        ref_id: e.id,
        actor_id: keeper.staffId,
        note: 'Salah catat',
      };
      expect(await storeCash(s.tenantId)).toEqual([entry]);
      // Again, by anyone: the same answer, nothing more written.
      const again = await post(s.auth, `/expenses/${e.id}/void`).expect(200);
      expect(again.body).toEqual(voided.body);
      expect(await storeCash(s.tenantId)).toEqual([entry]);
      const kas = await get(s.auth, '/store-cash').expect(200);
      expect(kas.body).toMatchObject({
        total: 1,
        summary: { cashIn: 30_000, cashOut: 0, balance: 30_000 },
        data: [
          {
            direction: 'in',
            kind: 'expense_void',
            amount: 30_000,
            refId: e.id,
            actorId: keeper.staffId,
            actorName: 'Sari',
          },
        ],
      });
      // The other store's cash holds nothing of it.
      expect(await storeCash(other.tenantId)).toEqual([]);
      expect(
        (await get(other.auth, '/store-cash').expect(200)).body,
      ).toMatchObject({ total: 0, summary: { balance: 0 } });
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
    it('needs expenses.manage for the log and reports.view for the profit: neither permission opens the other', async () => {
      const s = await createStore();
      const e = (
        await spend(s.auth, {
          amount: 1000,
          category: 'sewa',
          source: 'outside',
        }).expect(201)
      ).body;
      // A cashier who sees reports but does not manage expenses: the report, not the log.
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
      ])
        await get(cashier.auth, url).expect(403);
      await patch(cashier.auth, `/expenses/${e.id}`, { note: 'x' }).expect(403);
      await post(cashier.auth, `/expenses/${e.id}/void`).expect(403);
      await get(cashier.auth, '/reports/profit-loss').expect(200);
      await get(cashier.auth, '/reports/profit-loss/csv').expect(200);
      await http().get('/expenses').expect(401);
      await http().get('/reports/profit-loss').expect(401);
      expect(await rowCount(s.tenantId)).toBe(1);

      // A holder of expenses.manage alone records, reads, edits and voids expenses, and sees no profit.
      const keeper = await createCashier(app, s, ['expenses.manage']);
      const mine = await spend(keeper.auth, {
        amount: 2000,
        category: 'gaji',
        source: 'outside',
      }).expect(201);
      await get(keeper.auth, '/expenses').expect(200);
      await get(keeper.auth, '/expenses/csv').expect(200);
      await patch(keeper.auth, `/expenses/${mine.body.id}`, {
        note: 'x',
      }).expect(200);
      await post(keeper.auth, `/expenses/${mine.body.id}/void`).expect(200);
      await get(keeper.auth, '/reports/profit-loss').expect(403);
      await get(keeper.auth, '/reports/profit-loss/csv').expect(403);
      await get(keeper.auth, '/reports/dashboard').expect(403);
      // A cashier with neither sees neither.
      const plain = await createCashier(app, s, ['sales.create']);
      await get(plain.auth, '/expenses').expect(403);
      await get(plain.auth, '/reports/profit-loss').expect(403);
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

  describe('edit history', () => {
    it('keeps before and after of every edit, who and when; an edit that changes nothing leaves no trace', async () => {
      const s = await createStore();
      const keeper = await createCashier(app, s, ['expenses.manage']);
      const e = (
        await spend(s.auth, {
          amount: 5000,
          category: 'lainnya',
          source: 'outside',
          note: 'plastik',
        }).expect(201)
      ).body;
      expect(e.edits).toEqual([]);
      await patch(keeper.auth, `/expenses/${e.id}`, {
        amount: 6000,
        note: null,
      }).expect(200);
      const second = await patch(s.auth, `/expenses/${e.id}`, {
        category: 'transport',
        date: day(-2),
        amount: 6000, // the same amount: not a change
      }).expect(200);
      expect(second.body.edits).toMatchObject([
        {
          changes: {
            amount: { from: 5000, to: 6000 },
            note: { from: 'plastik', to: null },
          },
          actorId: keeper.staffId,
          actorKind: 'cashier',
          actorName: 'Sari',
          createdAt: expect.any(String),
        },
        {
          changes: {
            category: { from: 'lainnya', to: 'transport' },
            date: { from: day(), to: day(-2) },
          },
          actorId: s.userId,
          actorKind: 'owner',
          actorName: 'Pemilik',
        },
      ]);
      expect(Object.keys(second.body.edits[1].changes).sort()).toEqual([
        'category',
        'date',
      ]);
      // The same values again: no history row, "last edited" stays.
      const same = await patch(keeper.auth, `/expenses/${e.id}`, {
        category: 'transport',
        note: '',
        amount: 6000,
        date: day(-2),
      }).expect(200);
      expect(same.body).toEqual(second.body);
      const [{ n }] = await admin<{ n: number }[]>`
        select count(*)::int as n from pos.expense_edits where expense_id = ${e.id}`;
      expect(n).toBe(2);
      // A refused edit leaves none either.
      await patch(s.auth, `/expenses/${e.id}`, { date: day(1) }).expect(422);
      // The history is the expense's own: the list rows do not carry it, another store never reads it.
      const other = await createStore();
      await get(other.auth, `/expenses/${e.id}`).expect(404);
      const read = await get(s.auth, `/expenses/${e.id}`).expect(200);
      expect(read.body.edits).toHaveLength(2);
    });
  });

  describe('races (the test holds the row lock and releases it when the requests are queued)', () => {
    const drawerExpense = async (auth: string, amount = 30_000) =>
      (
        await spend(auth, {
          amount,
          category: 'transport',
          source: 'drawer',
        }).expect(201)
      ).body as { id: string; shiftId: string };

    it('a double tap on a drawer expense: one expense, one cash-out', async () => {
      const s = await createStore();
      const shift = (await open(s.auth, 100_000)).body as { id: string };
      const key = randomUUID();
      const body = { amount: 30_000, category: 'transport', source: 'drawer' };
      const [a, b] = await holding('shifts', shift.id, async () => {
        const first = send(spend(s.auth, body, key));
        await untilWaiting(1);
        const second = send(spend(s.auth, body, key));
        await untilWaiting(2);
        return [first, second];
      }).then((pending) => Promise.all(pending));
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(b.body).toEqual(a.body);
      expect(await rowCount(s.tenantId)).toBe(1);
      expect(await ledger(s.tenantId)).toEqual([
        {
          direction: 'out',
          kind: 'expense',
          amount: '30000',
          ref_id: a.body.id,
        },
      ]);
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 70_000,
        expenses: 30_000,
      });
    });

    it('two voids at once: one reversal', async () => {
      const s = await createStore();
      await open(s.auth, 100_000);
      const e = await drawerExpense(s.auth);
      const [a, b] = await holding('expenses', e.id, async () => {
        const first = send(post(s.auth, `/expenses/${e.id}/void`));
        await untilWaiting(1);
        const second = send(
          post(s.auth, `/expenses/${e.id}/void`, { reason: 'kedua' }),
        );
        await untilWaiting(2);
        return [first, second];
      }).then((pending) => Promise.all(pending));
      expect([a.status, b.status]).toEqual([200, 200]);
      // The first one in wins, reason included; the second finds it voided.
      expect(a.body).toMatchObject({ drawerReversed: true, voidReason: null });
      expect(b.body).toEqual(a.body);
      expect(await ledger(s.tenantId)).toEqual([
        { direction: 'out', kind: 'expense', amount: '30000', ref_id: e.id },
        {
          direction: 'in',
          kind: 'expense_reversal',
          amount: '30000',
          ref_id: e.id,
        },
      ]);
      expect(await current(s.auth)).toMatchObject({ expectedCash: 100_000 });
    });

    it('a void that reaches the shift before the close is counted in it', async () => {
      const s = await createStore();
      await open(s.auth, 100_000);
      const e = await drawerExpense(s.auth);
      const [voided, closed] = await holding('shifts', e.shiftId, async () => {
        const first = send(post(s.auth, `/expenses/${e.id}/void`));
        await untilWaiting(1);
        const second = send(
          post(s.auth, '/shifts/current/close', { countedCash: 100_000 }),
        );
        await untilWaiting(2);
        return [first, second];
      }).then((pending) => Promise.all(pending));
      expect([voided.status, closed.status]).toEqual([200, 200]);
      expect(voided.body.drawerReversed).toBe(true);
      expect(closed.body).toMatchObject({
        expectedCash: 100_000,
        expenses: 30_000,
        expenseReversals: 30_000,
        difference: 0,
      });
    });

    it('a void that reaches the shift after the close leaves it as counted', async () => {
      const s = await createStore();
      await open(s.auth, 100_000);
      const e = await drawerExpense(s.auth);
      const [closed, voided] = await holding('shifts', e.shiftId, async () => {
        const first = send(
          post(s.auth, '/shifts/current/close', { countedCash: 70_000 }),
        );
        await untilWaiting(1);
        const second = send(post(s.auth, `/expenses/${e.id}/void`));
        await untilWaiting(2);
        return [first, second];
      }).then((pending) => Promise.all(pending));
      expect([closed.status, voided.status]).toEqual([200, 200]);
      expect(closed.body).toMatchObject({
        expectedCash: 70_000,
        difference: 0,
      });
      expect(voided.body).toMatchObject({
        drawerReversed: false,
        cashReturnedTo: 'store_cash',
      });
      expect(await ledger(s.tenantId)).toHaveLength(1);
      // The shift was counted without it, so the cash is the store's.
      expect(await storeCash(s.tenantId)).toMatchObject([
        {
          direction: 'in',
          kind: 'expense_void',
          amount: '30000',
          ref_id: e.id,
        },
      ]);
      const after = await get(s.auth, `/shifts/${e.shiftId}`).expect(200);
      expect(after.body).toMatchObject({
        expectedCash: 70_000,
        expenseReversals: 0,
      });
    });

    it('a drawer expense that reaches the shift after the close is refused', async () => {
      const s = await createStore();
      const shift = (await open(s.auth, 100_000)).body as { id: string };
      const [closed, late] = await holding('shifts', shift.id, async () => {
        const first = send(
          post(s.auth, '/shifts/current/close', { countedCash: 100_000 }),
        );
        await untilWaiting(1);
        const second = send(
          spend(s.auth, {
            amount: 5000,
            category: 'transport',
            source: 'drawer',
          }),
        );
        await untilWaiting(2);
        return [first, second];
      }).then((pending) => Promise.all(pending));
      expect([closed.status, late.status]).toEqual([200, 422]);
      expect(closed.body.expectedCash).toBe(100_000);
      expect(await rowCount(s.tenantId)).toBe(0);
      expect(await ledger(s.tenantId)).toEqual([]);
    });
  });

  describe('the store`s day (timezone)', () => {
    const setTimezone = (s: Store, timezone: string) =>
      put(s.auth, '/reports/settings', { timezone }).expect(200);

    it('today, the default date and "not in the future" follow the store`s timezone, not the server`s', async () => {
      // UTC+14 and UTC−12 are 26 hours apart: the first store's today is always the second's tomorrow.
      const east = await createStore();
      const west = await createStore();
      await setTimezone(east, 'Pacific/Kiritimati');
      await setTimezone(west, 'Etc/GMT+12');
      const eastDay = dayIn('Pacific/Kiritimati');
      const westDay = dayIn('Etc/GMT+12');
      expect(eastDay > westDay).toBe(true);
      const body = { amount: 1000, category: 'lainnya', source: 'outside' };

      expect((await spend(east.auth, body).expect(201)).body.date).toBe(
        eastDay,
      );
      expect((await spend(west.auth, body).expect(201)).body.date).toBe(
        westDay,
      );
      // The east's today is a future date in the west, and fine in the east.
      const future = await spend(west.auth, { ...body, date: eastDay }).expect(
        422,
      );
      expect(future.body.errors).toEqual({
        date: 'Tanggal tidak boleh di masa depan',
      });
      await spend(east.auth, { ...body, date: eastDay }).expect(201);
      // A drawer expense is dated the store's today; the west's date is "not today" in the east.
      await open(east.auth);
      await spend(east.auth, {
        ...body,
        source: 'drawer',
        date: westDay,
      }).expect(422);
      const drawer = await spend(east.auth, {
        ...body,
        source: 'drawer',
      }).expect(201);
      expect(drawer.body.date).toBe(eastDay);
      // "Today" in the list and in the report is that store's day.
      for (const [store, d, count] of [
        [east, eastDay, 3],
        [west, westDay, 1],
      ] as [Store, string, number][]) {
        const list = await get(store.auth, '/expenses?period=today').expect(
          200,
        );
        expect(list.body).toMatchObject({ from: d, to: d, total: count });
        const pl = await get(store.auth, '/reports/profit-loss').expect(200);
        expect(pl.body).toMatchObject({ from: d, to: d });
        expect(pl.body.current.expenses).toBe(count * 1000);
      }
    });

    it('a sale around midnight counts in the store`s own day: WIB and WITA disagree for one hour', async () => {
      // 16:30 UTC on 10 March = 23:30 WIB on the 10th = 00:30 WITA on the 11th.
      const revenue = async (s: Store, date: string) =>
        (
          await get(
            s.auth,
            `/reports/profit-loss?from=${date}&to=${date}`,
          ).expect(200)
        ).body.current.revenue as number;
      const storeWithSales = async (timezone: string, instants: string[]) => {
        const s = await createStore();
        await setTimezone(s, timezone);
        const teh = await product(s, 'Es Teh', 5000, 3000);
        await open(s.auth);
        for (const at of instants) {
          const sale = await sell(s, {
            lines: [{ productId: teh, qty: 1 }],
            paid: 5000,
          });
          await admin`update pos.sales set created_at = ${at}::timestamptz where id = ${sale.id}`;
        }
        return s;
      };
      const wib = await storeWithSales('Asia/Jakarta', [
        '2026-03-10T16:30:00Z',
      ]);
      const wita = await storeWithSales('Asia/Makassar', [
        '2026-03-10T16:30:00Z',
      ]);
      expect(await revenue(wib, '2026-03-10')).toBe(5000);
      expect(await revenue(wib, '2026-03-11')).toBe(0);
      expect(await revenue(wita, '2026-03-10')).toBe(0);
      expect(await revenue(wita, '2026-03-11')).toBe(5000);
      // The boundary itself, to the second: 23:59:59 is the old day, 00:00:00 the new one.
      const edge = await storeWithSales('Asia/Jakarta', [
        '2026-03-10T16:59:59Z',
        '2026-03-10T17:00:00Z',
        '2026-03-10T17:00:00Z',
      ]);
      expect(await revenue(edge, '2026-03-10')).toBe(5000);
      expect(await revenue(edge, '2026-03-11')).toBe(10_000);
      // An expense's day is the date it was given, whatever the timezone.
      await spend(wita.auth, {
        amount: 700,
        category: 'lainnya',
        source: 'outside',
        date: '2026-03-10',
      }).expect(201);
      const pl = await get(
        wita.auth,
        '/reports/profit-loss?from=2026-03-10&to=2026-03-10',
      ).expect(200);
      expect(pl.body).toMatchObject({
        timezone: 'Asia/Makassar',
        current: { revenue: 0, expenses: 700, netProfit: -700 },
        previous: { from: '2026-03-09', to: '2026-03-09' },
      });
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
     * Sale totals 39.475, of which tax 2.225 (held for remittance, in no profit: owner ruling
     * 2026-11-25) → revenue 37.250, cost 20.700, gross profit 16.550, rounding 25.
     * Expenses: listrik 12.000 (drawer) + transport 3.000 + sewa 2.000 = 17.000; a supplier payment of
     * 4.000 and a voided 9.999 are not counted. Net profit −450.
     * Yesterday: sale F (Teh + tax: 5.500, cost 3.000) → revenue 5.000, gross 2.000; gaji 1.000 → net 1.000.
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
      revenue: 37_250,
      tax: 2225,
      cost: 20_700,
      grossProfit: 16_550,
      expenses: 17_000,
      netProfit: -450,
      rounding: 25,
      supplierPayments: 4000,
    };
    const YESTERDAY = {
      from: day(-1),
      to: day(-1),
      salesCount: 1,
      voidCount: 0,
      revenue: 5000,
      tax: 500,
      cost: 3000,
      grossProfit: 2000,
      expenses: 1000,
      netProfit: 1000,
      rounding: 0,
      supplierPayments: 0,
    };

    it('today against yesterday: revenue and profit without tax, stored cost, void reversed, rounding outside, supplier payments out', async () => {
      const { s } = await knownStore();
      const res = await get(s.auth, '/reports/profit-loss').expect(200);
      expect(res.body).toEqual({
        period: 'today',
        timezone: 'Asia/Jakarta',
        from: day(),
        to: day(),
        // Tax is in no profit, and the labels say so (owner ruling 2026-11-25).
        taxIncluded: false,
        labels: {
          revenue: 'Hasil jualan (tanpa pajak)',
          cost: 'Modal barang terjual',
          grossProfit: 'Untung kotor (tanpa pajak)',
          expenses: 'Pengeluaran',
          netProfit: 'Untung bersih (tanpa pajak)',
          tax: 'Pajak (titipan, di luar hasil jualan)',
          rounding: 'Pembulatan tunai (di luar hasil jualan)',
          supplierPayments: 'Bayar pemasok (bukan pengeluaran)',
        },
        current: TODAY,
        previous: YESTERDAY,
        netProfitChange: -1450,
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
      // One gross profit everywhere: the dashboard's and the sales report's are this report's. Their
      // `revenue` is Σ sale totals (tax inside); this report's is that minus tax.
      const dash = await get(s.auth, '/reports/dashboard?period=today').expect(
        200,
      );
      expect(dash.body.current).toMatchObject({
        revenue: TODAY.revenue + TODAY.tax,
        cost: TODAY.cost,
        tax: TODAY.tax,
        grossProfit: TODAY.grossProfit,
        rounding: 25,
      });
      const salesReport = await get(
        s.auth,
        `/reports/sales?from=${day()}&to=${day()}`,
      ).expect(200);
      expect(salesReport.body.totals).toMatchObject({
        revenue: 39_475,
        tax: 2225,
        grossProfit: TODAY.grossProfit,
      });
      // The sum on the screen holds without tax.
      const c = res.body.current;
      expect(c.revenue - c.cost).toBe(c.grossProfit);
      expect(c.grossProfit - c.expenses).toBe(c.netProfit);
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
        revenue: 42_250,
        tax: 2725,
        cost: 23_700,
        grossProfit: 18_550,
        expenses: 18_000,
        netProfit: 550,
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
        netProfitChange: 550,
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
        'Hasil jualan (tanpa pajak),37250,5000',
        'Modal barang terjual,20700,3000',
        'Untung kotor (tanpa pajak),16550,2000',
        'Pengeluaran,17100,1000',
        'Untung bersih (tanpa pajak),-550,1000',
        '"Pajak (titipan, di luar hasil jualan)",2225,500',
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
