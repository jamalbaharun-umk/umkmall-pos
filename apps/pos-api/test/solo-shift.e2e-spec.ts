import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

// UMK-2120: solo-owner mode. In a store with no active staff member the owner's first cash action opens the
// owner's shift inside the action's transaction, with the cash counted at the store's last close.

const OWNER_PIN = '135790';
const NO_SHIFT_SALE = 'Buka shift dulu sebelum berjualan';

describe('solo-owner mode: the first cash action opens the shift (UMK-2120)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const http = () => request(app.getHttpServer());
  // A second owner connection that holds a table lock while requests are in flight (the race test).
  const locker = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });

  /** Resolves once `n` backends of this database wait for a lock: the requests are in flight. */
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

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
    await locker.end();
  });

  const post = (auth: string, url: string, body: object) =>
    http().post(url).set('Authorization', auth).send(body);
  const keyed = (auth: string, url: string, body: object) =>
    http()
      .post(url)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const open = (auth: string, openingCash = 100_000) =>
    post(auth, '/shifts/open', { openingCash }).expect(201);
  const close = (auth: string, countedCash: number) =>
    post(auth, '/shifts/current/close', { countedCash }).expect(200);
  const current = async (auth: string) =>
    (await http().get('/shifts/current').set('Authorization', auth).expect(200))
      .body as { shift: { id: string } | null; autoOpen: boolean };

  const shiftRows = (tenantId: string) =>
    admin<
      {
        id: string;
        actor_id: string;
        actor_kind: string;
        opening_cash: number;
        closed_at: Date | null;
      }[]
    >`select id, actor_id, actor_kind, opening_cash::int as opening_cash, closed_at
        from pos.shifts where tenant_id = ${tenantId} order by opened_at, id`;
  const openShifts = async (tenantId: string) =>
    (await shiftRows(tenantId)).filter((r) => r.closed_at === null);
  const autoAudits = (tenantId: string) =>
    admin<
      {
        target_id: string;
        actor_kind: string;
        details: Record<string, unknown>;
      }[]
    >`select target_id, actor_kind, details from pos.audit_log
       where tenant_id = ${tenantId} and event = 'shift_open'
         and (details->>'automatic')::boolean is true
       order by occurred_at, id`;
  const saleShift = async (saleId: string) =>
    (
      await admin<
        { shift_id: string; tenant_id: string }[]
      >`select shift_id, tenant_id from pos.sales where id = ${saleId}`
    )[0];

  /** A store without staff: one product at Rp5.000 (50 on hand), Kasbon, a member, the owner's void PIN. */
  async function shop() {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Minuman',
    }).expect(201);
    const p = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Es Teh',
      costPrice: 2000,
      sellingPrice: 5000,
    }).expect(201);
    const productId = p.body.id as string;
    await post(s.auth, '/stock/opening', { productId, qty: 50 }).expect(201);
    const kasbon = await post(s.auth, '/payment-methods', {
      name: 'Kasbon',
      kind: 'credit',
    }).expect(201);
    const member = await post(s.auth, '/members', {
      name: 'Bu Sari',
      code: `M${randomUUID().slice(0, 6)}`,
      phone: '081234567890',
    }).expect(201);
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: OWNER_PIN })
      .expect(200);
    const sell = (auth = s.auth, qty = 1) =>
      keyed(auth, '/sales', {
        lines: [{ productId, qty }],
        paid: 5000 * qty,
      });
    return {
      ...s,
      productId,
      kasbonId: kasbon.body.id as string,
      memberId: member.body.id as string,
      sell,
    };
  }

  describe('the first sale', () => {
    it('opens a shift, the sale lands in it, audited as automatic in the same transaction', async () => {
      const s = await shop();
      expect(await current(s.auth)).toEqual({ shift: null, autoOpen: true });

      const sale = await s.sell().expect(201);
      const [shift] = await shiftRows(s.tenantId);
      expect(await shiftRows(s.tenantId)).toHaveLength(1);
      expect(shift).toMatchObject({
        actor_id: s.userId,
        actor_kind: 'owner',
        // no previous shift: Rp0
        opening_cash: 0,
        closed_at: null,
      });
      expect((await saleShift(sale.body.id)).shift_id).toBe(shift.id);
      expect(await current(s.auth)).toMatchObject({
        shift: { id: shift.id },
        autoOpen: false,
      });
      expect(await autoAudits(s.tenantId)).toEqual([
        {
          target_id: shift.id,
          actor_kind: 'owner',
          details: {
            shiftId: shift.id,
            openingCash: 0,
            automatic: true,
            trigger: 'sale',
          },
        },
      ]);

      // the next sale uses the same shift and opens nothing
      const next = await s.sell().expect(201);
      expect((await saleShift(next.body.id)).shift_id).toBe(shift.id);
      expect(await shiftRows(s.tenantId)).toHaveLength(1);
      expect(await autoAudits(s.tenantId)).toHaveLength(1);
      // and the shift closes like any other: expected cash 0 + 10.000
      const closed = await close(s.auth, 10_000);
      expect(closed.body).toMatchObject({ expectedCash: 10_000 });
    });

    it('a sale that fails after the shift was opened leaves no shift and no audit row', async () => {
      const s = await shop();
      // more than the 50 on hand: refused inside the sale's transaction, after the shift lock
      const res = await s.sell(s.auth, 500);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await shiftRows(s.tenantId)).toEqual([]);
      expect(await autoAudits(s.tenantId)).toEqual([]);
    });

    it('two concurrent first sales open one shift, both sales in it', async () => {
      const s = await shop();
      // Both requests find no open shift and queue at the insert of the new shift (a SHARE lock on the
      // table lets their `select … for update` through and holds every insert), then race for it at once.
      const [a, b] = await locker
        .begin(async (sql) => {
          await sql`lock table pos.shifts in share mode`;
          const both = Promise.all([
            s.sell().then((r) => r),
            s.sell().then((r) => r),
          ]);
          await untilWaiting(2);
          return [both];
        })
        .then(([both]) => both);
      expect([a.status, b.status]).toEqual([201, 201]);
      const rows = await shiftRows(s.tenantId);
      expect(rows).toHaveLength(1);
      expect((await saleShift(a.body.id)).shift_id).toBe(rows[0].id);
      expect((await saleShift(b.body.id)).shift_id).toBe(rows[0].id);
      expect(await autoAudits(s.tenantId)).toHaveLength(1);
    });
  });

  describe('opening cash = the counted cash of the store’s last close', () => {
    it('without an owner withdrawal: the counted cash, also with a difference', async () => {
      const s = await shop();
      await open(s.auth, 100_000);
      await s.sell().expect(201);
      // expected 105.000, counted 104.000 (Rp1.000 short): the drawer holds what was counted
      await close(s.auth, 104_000);
      await s.sell().expect(201);
      const shifts = await shiftRows(s.tenantId);
      expect(shifts.map((r) => r.opening_cash)).toEqual([100_000, 104_000]);
    });

    it('with "Diambil pemilik" before the count: already out of the counted cash, not subtracted again', async () => {
      const s = await shop();
      await open(s.auth, 100_000);
      await s.sell().expect(201);
      await keyed(s.auth, '/shifts/current/cash-entries', {
        direction: 'out',
        amount: 60_000,
        reason: 'ambil_pemilik',
      }).expect(201);
      // expected 100.000 + 5.000 − 60.000 = 45.000; counted 45.000
      const closed = await close(s.auth, 45_000);
      expect(closed.body).toMatchObject({ expectedCash: 45_000 });
      await s.sell().expect(201);
      const shifts = await shiftRows(s.tenantId);
      expect(shifts.map((r) => r.opening_cash)).toEqual([100_000, 45_000]);
      expect((await autoAudits(s.tenantId))[0].details).toMatchObject({
        openingCash: 45_000,
      });
    });

    it('the most recent close counts; a close at Rp0 opens at Rp0 (never negative)', async () => {
      const s = await shop();
      await open(s.auth, 50_000);
      await close(s.auth, 70_000);
      await open(s.auth, 70_000);
      await close(s.auth, 0);
      await s.sell().expect(201);
      expect((await openShifts(s.tenantId))[0].opening_cash).toBe(0);
    });
  });

  describe('who and which store', () => {
    it('a store with one active staff member keeps today’s behaviour, for the owner and the cashier', async () => {
      const s = await shop();
      const cashier = await createCashier(app, s);
      expect(await current(s.auth)).toEqual({ shift: null, autoOpen: false });
      expect(await current(cashier.auth)).toEqual({
        shift: null,
        autoOpen: false,
      });
      for (const auth of [s.auth, cashier.auth]) {
        const res = await s.sell(auth).expect(422);
        expect(res.body.message).toBe(NO_SHIFT_SALE);
      }
      // the other cash actions keep their refusal too
      const expense = await keyed(s.auth, '/expenses', {
        amount: 10_000,
        category: 'transport',
        source: 'drawer',
      }).expect(422);
      expect(expense.body).toMatchObject({
        code: 'SHIFT_REQUIRED',
        message: 'Buka shift dulu untuk mencatat pengeluaran dari laci',
      });
      expect(await shiftRows(s.tenantId)).toEqual([]);
      expect(await autoAudits(s.tenantId)).toEqual([]);
    });

    it('inactive and deleted staff do not count; adding a staff member ends auto-open at once', async () => {
      const s = await shop();
      const inactive = await createCashier(app, s);
      const deleted = await createCashier(app, s);
      await http()
        .patch(`/staff/${inactive.staffId}`)
        .set('Authorization', s.auth)
        .send({ active: false })
        .expect(200);
      await s.sell().expect(422);
      await http()
        .delete(`/staff/${deleted.staffId}`)
        .set('Authorization', s.auth)
        .expect(204);
      // one inactive and one deleted member left: solo
      await s.sell().expect(201);
      expect(await openShifts(s.tenantId)).toHaveLength(1);
      await close(s.auth, 5000);

      await createCashier(app, s);
      const res = await s.sell().expect(422);
      expect(res.body.message).toBe(NO_SHIFT_SALE);
      expect(await openShifts(s.tenantId)).toEqual([]);
    });

    it("cross-tenant: store B's first sale opens B's own shift, never A's, and B's opening cash is not A's count", async () => {
      const a = await shop();
      const b = await shop();
      await open(a.auth, 10_000);
      await close(a.auth, 77_000);
      const aBefore = await shiftRows(a.tenantId);

      const sale = await b.sell().expect(201);
      const bShifts = await shiftRows(b.tenantId);
      expect(bShifts).toHaveLength(1);
      expect(bShifts[0]).toMatchObject({ actor_id: b.userId, opening_cash: 0 });
      expect(await saleShift(sale.body.id)).toEqual({
        shift_id: bShifts[0].id,
        tenant_id: b.tenantId,
      });
      expect(await shiftRows(a.tenantId)).toEqual(aBefore);
      expect(await autoAudits(a.tenantId)).toEqual([]);

      // and A's first sale opens A's own, from A's count, not B's open shift
      const aSale = await a.sell().expect(201);
      const aOpen = await openShifts(a.tenantId);
      expect(aOpen).toHaveLength(1);
      expect(aOpen[0].opening_cash).toBe(77_000);
      expect((await saleShift(aSale.body.id)).shift_id).toBe(aOpen[0].id);
      expect(await shiftRows(b.tenantId)).toEqual(bShifts);
    });
  });

  describe('every cash action opens it', () => {
    it('a drawer expense', async () => {
      const s = await shop();
      await keyed(s.auth, '/expenses', {
        amount: 3000,
        category: 'transport',
        source: 'drawer',
      }).expect(201);
      const [shift] = await openShifts(s.tenantId);
      expect(shift).toBeDefined();
      expect((await autoAudits(s.tenantId))[0].details).toMatchObject({
        trigger: 'expense',
      });
      expect(
        await admin`select kind, amount::int as amount from pos.shift_cash_entries
                     where shift_id = ${shift.id}`,
      ).toEqual([{ kind: 'expense', amount: 3000 }]);
    });

    it('a cash kasbon instalment', async () => {
      const s = await shop();
      const sale = await keyed(s.auth, '/sales', {
        lines: [{ productId: s.productId, qty: 2 }],
        memberId: s.memberId,
        paymentMethodId: s.kasbonId,
        paid: 0,
      }).expect(201);
      await close(s.auth, 0);
      expect(await openShifts(s.tenantId)).toEqual([]);

      await keyed(s.auth, `/receivables/${sale.body.receivableId}/payments`, {
        amount: 4000,
      }).expect(201);
      const [shift] = await openShifts(s.tenantId);
      expect(shift).toBeDefined();
      expect(
        (await autoAudits(s.tenantId)).map((r) => r.details.trigger),
      ).toEqual(['sale', 'receivable_payment']);
      expect(
        await admin`select kind, amount::int as amount from pos.shift_cash_entries
                     where shift_id = ${shift.id}`,
      ).toEqual([{ kind: 'receivable_payment', amount: 4000 }]);
    });

    it('a cash void', async () => {
      const s = await shop();
      const sale = await s.sell().expect(201);
      await close(s.auth, 5000);
      expect(await openShifts(s.tenantId)).toEqual([]);

      await keyed(s.auth, `/sales/${sale.body.id}/void`, {
        reasonCode: 'wrong_item_or_qty',
        approverId: s.userId,
        pin: OWNER_PIN,
      }).expect(201);
      const [shift] = await openShifts(s.tenantId);
      // opened from the last count, the cash given back leaves it
      expect(shift.opening_cash).toBe(5000);
      expect(
        (await autoAudits(s.tenantId)).map((r) => r.details.trigger),
      ).toEqual(['sale', 'void_refund']);
      expect(
        await admin`select kind, amount::int as amount from pos.shift_cash_entries
                     where shift_id = ${shift.id}`,
      ).toEqual([{ kind: 'void_refund', amount: 5000 }]);
    });

    it('a void with a wrong PIN opens nothing', async () => {
      const s = await shop();
      const sale = await s.sell().expect(201);
      await close(s.auth, 5000);
      await keyed(s.auth, `/sales/${sale.body.id}/void`, {
        reasonCode: 'wrong_item_or_qty',
        approverId: s.userId,
        pin: '000000',
      }).expect(422);
      expect(await openShifts(s.tenantId)).toEqual([]);
    });
  });

  it('"Tunai" exists from store creation, so Kelengkapan toko ticks the payment method at once', async () => {
    const [user] = await admin<
      { id: string }[]
    >`insert into public.users default values returning id`;
    const res = await http()
      .post('/auth/dev/sign-in')
      .send({ userId: user.id })
      .expect(200);
    const tenantId = res.body.tenant.id as string;
    // read before anything lists the methods (the list would create Tunai lazily)
    expect(
      await admin`select name, is_cash from pos.payment_methods where tenant_id = ${tenantId}`,
    ).toEqual([{ name: 'Tunai', is_cash: true }]);
    const setup = await http()
      .get('/summaries/setup')
      .set('Authorization', `Bearer ${res.body.sessionToken}`)
      .expect(200);
    expect(setup.body.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'methods', done: true }),
      ]),
    );
    // a second sign-in creates nothing more
    await http()
      .post('/auth/dev/sign-in')
      .send({ userId: user.id })
      .expect(200);
    expect(
      await admin`select count(*)::int as n from pos.payment_methods where tenant_id = ${tenantId}`,
    ).toEqual([{ n: 1 }]);
  });
});
