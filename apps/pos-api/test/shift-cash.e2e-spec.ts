import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

/** YYYY-MM-DD today in the store's day (Asia/Jakarta, UTC+7). */
const today = () =>
  new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

describe('shift cash ledger: receivable payments in expected cash (UMK-1963)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  // A second owner connection that holds a row lock while a request is in flight (the race tests).
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

  const post = (auth: string, url: string, body: object) =>
    http().post(url).set('Authorization', auth).send(body);
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);
  const open = (auth: string, openingCash = 100_000) =>
    post(auth, '/shifts/open', { openingCash }).expect(201);
  const close = (auth: string, countedCash: number) =>
    post(auth, '/shifts/current/close', { countedCash });
  const current = async (auth: string) =>
    (await get(auth, '/shifts/current').expect(200)).body.shift as Record<
      string,
      unknown
    >;

  const pay = (
    auth: string,
    rid: string,
    body: object,
    key: string = randomUUID(),
  ) =>
    http()
      .post(`/receivables/${rid}/payments`)
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);

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
   * Holds the row lock of one shift or receivable (`for update`, as the database owner) while `during`
   * starts requests and waits until they queue behind it; the lock is released when `during` returns.
   */
  const holding = <T>(
    table: 'shifts' | 'receivables',
    id: string,
    during: () => Promise<T>,
  ) =>
    locker.begin(async (sql) => {
      await sql`select id from ${sql(`pos.${table}`)} where id = ${id} for update`;
      return during();
    }) as Promise<T>;

  /**
   * A store with one product at Rp6.000, a member, the methods Kasbon and Kartu Debit, and an owner
   * shift (opening cash Rp100.000) in which a kasbon sale of Rp6.000 with `down` paid was rung up.
   */
  async function storeWithKasbon(down = 0) {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Minuman',
    }).expect(201);
    const p = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Kopi Susu',
      costPrice: 1000,
      sellingPrice: 6000,
    }).expect(201);
    const productId = p.body.id as string;
    await post(s.auth, '/stock/opening', { productId, qty: 50 }).expect(201);
    const kasbon = await post(s.auth, '/payment-methods', {
      name: 'Kasbon',
      kind: 'credit',
    }).expect(201);
    const debit = await post(s.auth, '/payment-methods', {
      name: 'Kartu Debit',
      kind: 'debit',
    }).expect(201);
    const member = await post(s.auth, '/members', {
      name: 'Bu Sari',
      code: `M${randomUUID().slice(0, 6)}`,
      phone: '081234567890',
    }).expect(201);
    const shift = await open(s.auth);
    const sell = (body: object, auth = s.auth) =>
      http()
        .post('/sales')
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({ lines: [{ productId, qty: 1 }], ...body });
    const kasbonSale = (paid: number, auth = s.auth) =>
      sell(
        { memberId: member.body.id, paymentMethodId: kasbon.body.id, paid },
        auth,
      ).expect(201);
    const sale = await kasbonSale(down);
    return {
      ...s,
      shiftId: shift.body.id as string,
      rid: sale.body.receivableId as string,
      debitId: debit.body.id as string,
      sell,
      kasbonSale,
    };
  }

  it('a cash payment in an open shift is linked to it and raises expected cash, live and at close', async () => {
    const s = await storeWithKasbon();
    expect(await current(s.auth)).toMatchObject({
      expectedCash: 100_000,
      cashIn: 0,
      cashOut: 0,
      receivablePayments: 0,
    });

    const paid = await pay(s.auth, s.rid, { amount: 2500 }).expect(201);
    expect(paid.body.rest).toBe(3500);
    const paymentId = paid.body.payments[0].id as string;

    expect(await current(s.auth)).toMatchObject({
      id: s.shiftId,
      cashSales: 0,
      cashIn: 2500,
      cashOut: 0,
      receivablePayments: 2500,
      expectedCash: 102_500,
    });
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body.cashEntries).toEqual([
      expect.objectContaining({
        direction: 'in',
        kind: 'receivable_payment',
        amount: 2500,
        refId: paymentId,
      }),
    ]);

    await pay(s.auth, s.rid, { amount: 500 }).expect(201);
    const closed = await close(s.auth, 103_500).expect(200);
    expect(closed.body).toMatchObject({
      id: s.shiftId,
      openingCash: 100_000,
      cashSales: 0,
      cashIn: 3000,
      cashOut: 0,
      receivablePayments: 3000,
      expectedCash: 103_000,
      countedCash: 103_500,
      difference: 500,
    });

    const list = await get(s.auth, '/shifts').expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        id: s.shiftId,
        cashIn: 3000,
        cashOut: 0,
        receivablePayments: 3000,
        expectedCash: 103_000,
      }),
    ]);
  });

  it('a non-cash payment does not change expected cash and needs no shift', async () => {
    const s = await storeWithKasbon();
    const r = await pay(s.auth, s.rid, {
      amount: 2000,
      paymentMethodId: s.debitId,
    }).expect(201);
    expect(r.body.rest).toBe(4000);
    expect(await current(s.auth)).toMatchObject({
      cashIn: 0,
      receivablePayments: 0,
      expectedCash: 100_000,
    });
    const closed = await close(s.auth, 100_000).expect(200);
    expect(closed.body).toMatchObject({
      cashIn: 0,
      receivablePayments: 0,
      expectedCash: 100_000,
      difference: 0,
    });

    // No shift open: a transfer is still recorded, and no shift gets an entry.
    const r2 = await pay(s.auth, s.rid, {
      amount: 1000,
      paymentMethodId: s.debitId,
    }).expect(201);
    expect(r2.body.rest).toBe(3000);
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body.cashEntries).toEqual([]);
  });

  it('an actor who can open a shift (owner, sales.create) is refused cash without one (422); nothing changes', async () => {
    const s = await storeWithKasbon();
    await close(s.auth, 100_000).expect(200);
    const cashier = await createCashier(app, s, [
      'sales.create',
      'receivables.manage',
    ]);
    const key = randomUUID();
    for (const [auth, k] of [
      [s.auth, key],
      [cashier.auth, randomUUID()],
    ]) {
      const res = await pay(auth, s.rid, { amount: 1000 }, k).expect(422);
      expect(res.body).toMatchObject({
        message: 'Buka shift dulu sebelum menerima pembayaran tunai',
      });
    }
    const r = await get(s.auth, `/receivables/${s.rid}`).expect(200);
    expect(r.body).toMatchObject({
      rest: 6000,
      outsideShiftCollected: 0,
      lastPaymentAt: null,
      payments: [],
    });
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body).toMatchObject({ cashIn: 0, cashEntries: [] });
    const rows = await admin`
      select 'payment' as t from pos.receivable_payments where tenant_id = ${s.tenantId}
      union all select 'shift' from pos.shift_cash_entries where tenant_id = ${s.tenantId}
      union all select 'store' from pos.store_cash_entries where tenant_id = ${s.tenantId}`;
    expect(rows).toEqual([]);
    const storeCash = await get(s.auth, '/store-cash').expect(200);
    expect(storeCash.body).toMatchObject({
      data: [],
      summary: { cashIn: 0, cashOut: 0, balance: 0 },
    });

    // The refused request did not claim its key: the same request succeeds once a shift is open.
    await open(s.auth, 0);
    await pay(s.auth, s.rid, { amount: 1000 }, key).expect(201);
    expect(await current(s.auth)).toMatchObject({ expectedCash: 1000 });
    // The cashier's own shift, not the owner's, is what the cashier needs.
    await pay(cashier.auth, s.rid, { amount: 1000 }).expect(422);
  });

  it('cash sales and kasbon down payments keep counting; a down payment is not counted twice', async () => {
    const s = await storeWithKasbon(1000); // down payment Rp1.000
    await s.sell({ paid: 10_000 }).expect(201); // cash sale Rp6.000
    await s.sell({ paymentMethodId: s.debitId, paid: 6000 }).expect(201); // debit: no cash
    await pay(s.auth, s.rid, { amount: 2000 }).expect(201);
    const closed = await close(s.auth, 109_000).expect(200);
    expect(closed.body).toMatchObject({
      cashSales: 7000, // 6.000 cash + 1.000 down payment
      cashIn: 2000,
      receivablePayments: 2000,
      expectedCash: 109_000,
      difference: 0,
    });
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body.cashEntries).toHaveLength(1); // the down payment is in cashSales, not the ledger
  });

  it('a closed shift never changes: a later payment goes to the next shift', async () => {
    const s = await storeWithKasbon();
    await pay(s.auth, s.rid, { amount: 1000 }).expect(201);
    await close(s.auth, 101_000).expect(200);
    const before = (await get(s.auth, `/shifts/${s.shiftId}`).expect(200)).body;

    const next = await open(s.auth, 50_000);
    await pay(s.auth, s.rid, { amount: 2000 }).expect(201);
    expect(await current(s.auth)).toMatchObject({
      id: next.body.id,
      cashIn: 2000,
      expectedCash: 52_000,
    });
    const after = (await get(s.auth, `/shifts/${s.shiftId}`).expect(200)).body;
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      cashIn: 1000,
      expectedCash: 101_000,
      difference: 0,
    });
  });

  it('the payment is counted in the shift of the actor who took it', async () => {
    const s = await storeWithKasbon();
    const cashier = await createCashier(app, s, [
      'sales.create',
      'receivables.manage',
    ]);
    await pay(cashier.auth, s.rid, { amount: 1000 }).expect(422); // no shift of their own
    const shift = await open(cashier.auth, 0);
    const paid = await pay(cashier.auth, s.rid, { amount: 1000 }).expect(201);
    expect(paid.body.payments).toEqual([
      expect.objectContaining({
        amount: 1000,
        collectedOutsideShift: false,
        shiftId: shift.body.id,
      }),
    ]);
    expect(await current(cashier.auth)).toMatchObject({
      id: shift.body.id,
      cashIn: 1000,
      expectedCash: 1000,
    });
    expect(await current(s.auth)).toMatchObject({
      cashIn: 0,
      expectedCash: 100_000,
    });
  });

  it('a replayed Idempotency-Key writes one entry, also after the shift closed', async () => {
    const s = await storeWithKasbon();
    const key = randomUUID();
    const first = await pay(s.auth, s.rid, { amount: 1500 }, key).expect(201);
    const again = await pay(s.auth, s.rid, { amount: 1500 }, key).expect(201);
    expect(again.body).toEqual(first.body);
    expect(await current(s.auth)).toMatchObject({
      cashIn: 1500,
      expectedCash: 101_500,
    });
    // Double tap: the same key in parallel still pays once.
    const key2 = randomUUID();
    const both = await Promise.all([
      pay(s.auth, s.rid, { amount: 500 }, key2),
      pay(s.auth, s.rid, { amount: 500 }, key2),
    ]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(await current(s.auth)).toMatchObject({ cashIn: 2000 });

    await close(s.auth, 102_000).expect(200);
    const late = await pay(s.auth, s.rid, { amount: 1500 }, key).expect(201);
    expect(late.body.rest).toBe(4000);
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body.cashEntries).toHaveLength(2);
    expect(detail.body).toMatchObject({ cashIn: 2000, expectedCash: 102_000 });
  });

  it('a payment that reaches the shift before the close is counted in that close', async () => {
    const s = await storeWithKasbon();
    // Both wait for the shift's row lock, the payment first.
    const [paying, closing] = await holding('shifts', s.shiftId, async () => {
      const paying = send(pay(s.auth, s.rid, { amount: 1000 }));
      await untilWaiting(1);
      const closing = send(close(s.auth, 101_000));
      await untilWaiting(2);
      return [paying, closing];
    });
    const [paid, closed] = [await paying, await closing];
    expect(paid.status).toBe(201);
    expect(paid.body.payments).toEqual([
      expect.objectContaining({
        collectedOutsideShift: false,
        shiftId: s.shiftId,
      }),
    ]);
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({
      cashIn: 1000,
      receivablePayments: 1000,
      expectedCash: 101_000,
      difference: 0,
    });
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body).toMatchObject({ cashIn: 1000, expectedCash: 101_000 });
    expect(detail.body.cashEntries).toHaveLength(1);
    const r = await get(s.auth, `/receivables/${s.rid}`).expect(200);
    expect(r.body).toMatchObject({ rest: 5000, outsideShiftCollected: 0 });
  });

  it('a payment that reaches the shift after the close began is refused; the close does not count it', async () => {
    const s = await storeWithKasbon();
    // Both wait for the shift's row lock, the close first.
    const [closing, paying] = await holding('shifts', s.shiftId, async () => {
      const closing = send(close(s.auth, 100_000));
      await untilWaiting(1);
      const paying = send(pay(s.auth, s.rid, { amount: 1000 }));
      await untilWaiting(2);
      return [closing, paying];
    });
    const [closed, paid] = [await closing, await paying];
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({
      cashIn: 0,
      expectedCash: 100_000,
      difference: 0,
    });
    // The owner can open a shift, so the cash is not taken outside one.
    expect(paid.status).toBe(422);
    expect(paid.body.message).toBe(
      'Buka shift dulu sebelum menerima pembayaran tunai',
    );
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body).toMatchObject({
      cashIn: 0,
      expectedCash: 100_000,
      cashEntries: [],
    });
    const r = await get(s.auth, `/receivables/${s.rid}`).expect(200);
    expect(r.body).toMatchObject({
      rest: 6000,
      outsideShiftCollected: 0,
      payments: [],
    });
    expect(
      (await get(s.auth, '/store-cash').expect(200)).body.summary.balance,
    ).toBe(0);
  });

  it('the shift report shows the receivable payments line and cash in/out (JSON and CSV)', async () => {
    const s = await storeWithKasbon();
    await pay(s.auth, s.rid, { amount: 2500 }).expect(201);
    await pay(s.auth, s.rid, {
      amount: 1000,
      paymentMethodId: s.debitId,
    }).expect(201);
    await close(s.auth, 102_500).expect(200);
    const q = `from=${today()}&to=${today()}`;
    const report = await get(s.auth, `/reports/shifts?${q}`).expect(200);
    expect(report.body.rows).toEqual([
      expect.objectContaining({
        shiftId: s.shiftId,
        salesCount: 1, // the ledger join does not multiply the shift's sales
        revenue: 6000,
        openingCash: 100_000,
        receivablePayments: 2500,
        cashIn: 2500,
        cashOut: 0,
        expectedCash: 102_500,
        countedCash: 102_500,
        difference: 0,
      }),
    ]);
    const csv = await get(s.auth, `/reports/shifts/csv?${q}`).expect(200);
    const [header, row] = csv.text.trim().split(/\r?\n/);
    const cols = header.split(',');
    const cells = row.split(',');
    const cell = (name: string) => cells[cols.indexOf(name)];
    expect(cell('Pembayaran piutang')).toBe('2500');
    expect(cell('Kas masuk')).toBe('2500');
    expect(cell('Kas keluar')).toBe('0');
    expect(cell('Kas seharusnya')).toBe('102500');
  });

  it("cross-tenant: store B gets 404 on store A's shift and receivable; A's ledger is unchanged", async () => {
    const a = await storeWithKasbon();
    const b = await storeWithKasbon();
    await pay(a.auth, a.rid, { amount: 1000 }).expect(201);

    await get(b.auth, `/shifts/${a.shiftId}`).expect(404);
    await get(b.auth, `/receivables/${a.rid}`).expect(404);
    await pay(b.auth, a.rid, { amount: 1000 }).expect(404);
    expect((await get(b.auth, '/shifts').expect(200)).body.data).toEqual([
      expect.objectContaining({ id: b.shiftId, cashIn: 0 }),
    ]);
    expect(await current(b.auth)).toMatchObject({
      id: b.shiftId,
      cashIn: 0,
      expectedCash: 100_000,
    });
    const q = `from=${today()}&to=${today()}`;
    const report = await get(b.auth, `/reports/shifts?${q}`).expect(200);
    expect(report.body.rows).toEqual([
      expect.objectContaining({ shiftId: b.shiftId, cashIn: 0 }),
    ]);

    const detail = await get(a.auth, `/shifts/${a.shiftId}`).expect(200);
    expect(detail.body.cashIn).toBe(1000);
    expect(detail.body.cashEntries).toHaveLength(1);
    expect(await current(a.auth)).toMatchObject({ expectedCash: 101_000 });
    const r = await get(a.auth, `/receivables/${a.rid}`).expect(200);
    expect(r.body.rest).toBe(5000);
  });

  it("a cashier without reports.view gets 404 on another actor's shift and its ledger", async () => {
    const s: Store & { shiftId: string; rid: string } = await storeWithKasbon();
    await pay(s.auth, s.rid, { amount: 1000 }).expect(201);
    const cashier = await createCashier(app, s, ['sales.create']);
    await get(cashier.auth, `/shifts/${s.shiftId}`).expect(404);
    expect((await get(cashier.auth, '/shifts').expect(200)).body.data).toEqual(
      [],
    );
  });
  describe('cash instalments by an actor who cannot open a shift (owner ruling 2026-11-24)', () => {
    type Payment = {
      id: string;
      amount: number;
      actorId: string;
      actorKind: string;
      actorName: string;
      collectedOutsideShift: boolean;
      shiftId: string | null;
      createdAt: string;
    };
    type StoreCash = {
      data: Record<string, unknown>[];
      total: number;
      summary: { cashIn: number; cashOut: number; balance: number };
    };
    const receivable = async (auth: string, rid: string) =>
      (await get(auth, `/receivables/${rid}`).expect(200)).body as {
        rest: number;
        outsideShiftCollected: number;
        payments: Payment[];
      };
    const storeCash = async (auth: string, query = '') =>
      (await get(auth, `/store-cash${query}`).expect(200)).body as StoreCash;
    /** Every shift ledger row of the store, read as the database owner. */
    const ledger = (tenantId: string) =>
      admin<{ ref_id: string; shift_id: string }[]>`
        select ref_id, shift_id from pos.shift_cash_entries where tenant_id = ${tenantId}`;
    /** `receivables.manage` only: may not sell, so may not open a shift. */
    const collector = (s: Store) =>
      createCashier(app, s, ['receivables.manage']);

    it('is accepted, audited, entered into the store cash and in no shift, also one opened afterwards', async () => {
      const s = await storeWithKasbon();
      const c = await collector(s);
      await post(c.auth, '/shifts/open', { openingCash: 0 }).expect(403);
      const started = Date.now();

      // Unrounded: a kasbon instalment is taken as handed over.
      const paid = await pay(c.auth, s.rid, { amount: 1250 }).expect(201);
      expect(paid.body).toMatchObject({
        rest: 4750,
        outsideShiftCollected: 1250,
      });
      const [p] = paid.body.payments as Payment[];
      expect(p).toMatchObject({
        amount: 1250,
        paymentMethod: 'Tunai',
        actorId: c.staffId,
        actorKind: 'cashier',
        actorName: 'Sari',
        collectedOutsideShift: true,
        shiftId: null,
      });
      expect(Date.parse(p.createdAt)).toBeGreaterThan(started - 5000);
      expect(Date.parse(p.createdAt)).toBeLessThan(Date.now() + 5000);
      const [row] = await admin`
        select collected_outside_shift, actor_id, actor_kind, amount
        from pos.receivable_payments where id = ${p.id}`;
      expect(row).toMatchObject({
        collected_outside_shift: true,
        actor_id: c.staffId,
        actor_kind: 'cashier',
        amount: '1250',
      });

      // Recorded into the store's cash, with the payment as its source, in the same instant.
      const cash = await storeCash(s.auth);
      expect(cash).toMatchObject({
        total: 1,
        page: 1,
        summary: { cashIn: 1250, cashOut: 0, balance: 1250 },
      });
      expect(cash.data).toEqual([
        {
          id: expect.any(String),
          direction: 'in',
          kind: 'receivable_payment',
          amount: 1250,
          refId: p.id,
          note: null,
          actorId: c.staffId,
          actorKind: 'cashier',
          actorName: 'Sari',
          createdAt: p.createdAt,
        },
      ]);
      // The store's money position is a report: not for the collector.
      await get(c.auth, '/store-cash').expect(403);

      // Not in the owner's open shift, nor in any shift's ledger.
      expect(await ledger(s.tenantId)).toEqual([]);
      expect(await current(s.auth)).toMatchObject({
        cashIn: 0,
        expectedCash: 100_000,
      });
      const closed = await close(s.auth, 100_000).expect(200);
      expect(closed.body).toMatchObject({
        cashIn: 0,
        receivablePayments: 0,
        expectedCash: 100_000,
        difference: 0,
      });
      const before = (await get(s.auth, `/shifts/${s.shiftId}`).expect(200))
        .body;

      // A shift opened afterwards starts at its opening cash and never picks the payment up.
      const next = await open(s.auth, 20_000);
      expect(await current(s.auth)).toMatchObject({
        id: next.body.id,
        cashIn: 0,
        receivablePayments: 0,
        expectedCash: 20_000,
      });
      // In that shift the owner's own instalment goes to the drawer, not to the store cash.
      await pay(s.auth, s.rid, { amount: 750 }).expect(201);
      const r = await receivable(s.auth, s.rid);
      expect(r).toMatchObject({ rest: 4000, outsideShiftCollected: 1250 });
      expect(
        r.payments.map((x) => [x.amount, x.collectedOutsideShift, x.shiftId]),
      ).toEqual([
        [1250, true, null],
        [750, false, next.body.id],
      ]);
      const closed2 = await close(s.auth, 20_750).expect(200);
      expect(closed2.body).toMatchObject({
        cashIn: 750,
        receivablePayments: 750,
        expectedCash: 20_750,
        difference: 0,
      });
      expect((await storeCash(s.auth)).summary).toEqual({
        cashIn: 1250,
        cashOut: 0,
        balance: 1250,
      });
      expect(
        (await get(s.auth, `/shifts/${s.shiftId}`).expect(200)).body,
      ).toEqual(before);
      const q = `from=${today()}&to=${today()}`;
      const report = await get(s.auth, `/reports/shifts?${q}`).expect(200);
      expect(
        (report.body.rows as { receivablePayments: number }[]).reduce(
          (n, x) => n + x.receivablePayments,
          0,
        ),
      ).toBe(750);
    });

    it('pays a receivable off end to end; the list, its summary and the store cash pages add up', async () => {
      const s = await storeWithKasbon();
      const c = await collector(s);
      await pay(c.auth, s.rid, { amount: 2000 }).expect(201);
      // Overpaying is still refused, and leaves no store cash behind.
      await pay(c.auth, s.rid, { amount: 4001 }).expect(422);
      const done = await pay(c.auth, s.rid, { amount: 4000 }).expect(201);
      expect(done.body).toMatchObject({ rest: 0, outsideShiftCollected: 6000 });
      const list = await get(c.auth, '/receivables').expect(200);
      expect(list.body.data).toEqual([
        expect.objectContaining({ id: s.rid, outsideShiftCollected: 6000 }),
      ]);
      expect(list.body.summary).toEqual({
        openRest: 0,
        openCount: 0,
        outsideShiftCollected: 6000,
      });
      expect(await ledger(s.tenantId)).toEqual([]);
      expect(await current(s.auth)).toMatchObject({ expectedCash: 100_000 });

      // Newest first, paged; the summary is of the whole ledger.
      const p1 = await storeCash(s.auth, '?perPage=1');
      const p2 = await storeCash(s.auth, '?perPage=1&page=2');
      expect([p1.data[0].amount, p2.data[0].amount]).toEqual([4000, 2000]);
      for (const page of [p1, p2])
        expect(page).toMatchObject({
          total: 2,
          summary: { cashIn: 6000, cashOut: 0, balance: 6000 },
        });
      await get(s.auth, '/store-cash?perPage=0').expect(422);
      // Every outside-shift payment has exactly one store cash entry of its amount.
      const unmatched = await admin`
        select p.id from pos.receivable_payments p
        left join pos.store_cash_entries e
          on e.tenant_id = p.tenant_id and e.kind = 'receivable_payment'
         and e.ref_id = p.id and e.direction = 'in' and e.amount = p.amount
        where p.tenant_id = ${s.tenantId} and p.collected_outside_shift and e.id is null`;
      expect(unmatched).toEqual([]);
    });

    it('a non-cash payment or a down payment is neither outside-shift nor store cash', async () => {
      const s = await storeWithKasbon();
      const c = await collector(s);
      const r = await pay(c.auth, s.rid, {
        amount: 1000,
        paymentMethodId: s.debitId,
      }).expect(201);
      expect(r.body).toMatchObject({ rest: 5000, outsideShiftCollected: 0 });
      expect(r.body.payments).toEqual([
        expect.objectContaining({
          collectedOutsideShift: false,
          shiftId: null,
        }),
      ]);
      const sale = await s.kasbonSale(1000);
      const down = await receivable(s.auth, sale.body.receivableId);
      expect(down.outsideShiftCollected).toBe(0);
      expect(down.payments).toEqual([
        expect.objectContaining({
          collectedOutsideShift: false,
          shiftId: null,
        }),
      ]);
      const list = await get(s.auth, '/receivables').expect(200);
      expect(list.body.summary).toEqual({
        openRest: 10_000,
        openCount: 2,
        outsideShiftCollected: 0,
      });
      expect(await storeCash(s.auth)).toMatchObject({
        data: [],
        total: 0,
        summary: { cashIn: 0, cashOut: 0, balance: 0 },
      });
    });

    it('a replay returns the first result and writes nothing, also once the collector has a shift', async () => {
      const s = await storeWithKasbon();
      const c = await collector(s);
      const key = randomUUID();
      const first = await pay(c.auth, s.rid, { amount: 1500 }, key).expect(201);
      const again = await pay(c.auth, s.rid, { amount: 1500 }, key).expect(201);
      expect(again.body).toEqual(first.body);
      // Double tap pays once and enters the store cash once.
      const key2 = randomUUID();
      const both = await Promise.all([
        pay(c.auth, s.rid, { amount: 500 }, key2),
        pay(c.auth, s.rid, { amount: 500 }, key2),
      ]);
      expect(both.map((r) => r.status)).toEqual([201, 201]);
      const afterTaps = await receivable(c.auth, s.rid);
      expect(afterTaps).toMatchObject({
        rest: 4000,
        outsideShiftCollected: 2000,
      });
      const cashBefore = await storeCash(s.auth);
      expect(cashBefore).toMatchObject({
        total: 2,
        summary: { cashIn: 2000, balance: 2000 },
      });

      // The collector is given `sales.create` and opens a shift: the replay does not move the payment.
      await http()
        .patch(`/roles/${c.roleId}`)
        .set('Authorization', s.auth)
        .send({ permissions: ['receivables.manage', 'sales.create'] })
        .expect(200);
      const shift = await open(c.auth, 0);
      const late = await pay(c.auth, s.rid, { amount: 1500 }, key).expect(201);
      expect(late.body).toEqual(afterTaps);
      expect(await current(c.auth)).toMatchObject({
        id: shift.body.id,
        cashIn: 0,
        expectedCash: 0,
      });
      expect(await ledger(s.tenantId)).toEqual([]);
      expect(await storeCash(s.auth)).toEqual(cashBefore);
      // The same key for another amount is still refused.
      await pay(c.auth, s.rid, { amount: 1 }, key).expect(422);
      // From now on this actor's cash goes to their drawer, and without a shift is refused.
      await pay(c.auth, s.rid, { amount: 300 }).expect(201);
      expect(await current(c.auth)).toMatchObject({ cashIn: 300 });
      await close(c.auth, 300).expect(200);
      await pay(c.auth, s.rid, { amount: 300 }).expect(422);
      expect((await storeCash(s.auth)).summary.balance).toBe(2000);
    });

    it('a payment in flight while the actor opens a shift lands in that shift, exactly once', async () => {
      const s = await storeWithKasbon();
      await close(s.auth, 100_000).expect(200);
      // The payment waits for the receivable's row lock; the shift opens meanwhile.
      const [paying, opened] = await holding('receivables', s.rid, async () => {
        const paying = send(pay(s.auth, s.rid, { amount: 1000 }));
        await untilWaiting(1);
        return [paying, await open(s.auth, 0)] as const;
      });
      const paid = await paying;
      expect(paid.status).toBe(201);
      expect(paid.body).toMatchObject({ rest: 5000, outsideShiftCollected: 0 });
      expect(paid.body.payments).toEqual([
        expect.objectContaining({
          collectedOutsideShift: false,
          shiftId: opened.body.id,
        }),
      ]);
      expect(await ledger(s.tenantId)).toEqual([
        { ref_id: paid.body.payments[0].id, shift_id: opened.body.id },
      ]);
      expect((await storeCash(s.auth)).total).toBe(0);
      const closed = await close(s.auth, 1000).expect(200);
      expect(closed.body).toMatchObject({ expectedCash: 1000, difference: 0 });
    });

    it('a shift that is not yet committed does not count: an owner is refused, a collector goes to the store cash', async () => {
      const s = await storeWithKasbon();
      await close(s.auth, 100_000).expect(200);
      const c = await collector(s);
      // Shifts being opened (inserted, not committed) for both actors while each pays.
      const [owner, coll] = (await locker.begin(async (sql) => {
        await sql`insert into pos.shifts (tenant_id, actor_id, actor_kind, opening_cash)
          values (${s.tenantId}, ${s.userId}, 'owner', 0), (${s.tenantId}, ${c.staffId}, 'cashier', 0)`;
        return [
          await send(pay(s.auth, s.rid, { amount: 1000 })),
          await send(pay(c.auth, s.rid, { amount: 700 })),
        ];
      })) as request.Response[];
      expect(owner.status).toBe(422);
      expect(coll.status).toBe(201);
      const r = await receivable(s.auth, s.rid);
      expect(r).toMatchObject({ rest: 5300, outsideShiftCollected: 700 });
      expect(r.payments).toEqual([
        expect.objectContaining({
          amount: 700,
          collectedOutsideShift: true,
          shiftId: null,
        }),
      ]);
      // The shifts are open now and hold nothing; the Rp700 is in the store cash only.
      expect(await ledger(s.tenantId)).toEqual([]);
      expect(await current(s.auth)).toMatchObject({
        cashIn: 0,
        expectedCash: 0,
      });
      expect((await storeCash(s.auth)).summary).toEqual({
        cashIn: 700,
        cashOut: 0,
        balance: 700,
      });
      // Store-wide: no payment is in a shift ledger and marked outside, or in both ledgers.
      const both = await admin`
        select p.id from pos.receivable_payments p
        join pos.shift_cash_entries e
          on e.tenant_id = p.tenant_id and e.kind = 'receivable_payment' and e.ref_id = p.id
        left join pos.store_cash_entries c
          on c.tenant_id = p.tenant_id and c.kind = 'receivable_payment' and c.ref_id = p.id
        where p.collected_outside_shift or c.id is not null`;
      expect(both).toEqual([]);
    });

    it("cross-tenant: store B cannot pay store A's receivable and sees none of A's collections or store cash", async () => {
      const a = await storeWithKasbon();
      const b = await storeWithKasbon();
      const ca = await collector(a);
      const cb = await collector(b);
      const paidA = await pay(ca.auth, a.rid, { amount: 1000 }).expect(201);

      await pay(cb.auth, a.rid, { amount: 1000 }).expect(404);
      await pay(b.auth, a.rid, { amount: 1000 }).expect(404);
      await get(cb.auth, `/receivables/${a.rid}`).expect(404);
      const bList = await get(cb.auth, '/receivables').expect(200);
      expect(bList.body.data).toEqual([
        expect.objectContaining({ id: b.rid, outsideShiftCollected: 0 }),
      ]);
      expect(bList.body.summary).toMatchObject({
        openRest: 6000,
        outsideShiftCollected: 0,
      });
      expect(await storeCash(b.auth)).toMatchObject({
        data: [],
        total: 0,
        summary: { cashIn: 0, cashOut: 0, balance: 0 },
      });
      // A key used in store A is free in store B, and B's payment stays B's.
      const key = randomUUID();
      await pay(ca.auth, a.rid, { amount: 500 }, key).expect(201);
      const paidB = await pay(cb.auth, b.rid, { amount: 700 }, key).expect(201);
      expect(paidB.body).toMatchObject({
        rest: 5300,
        outsideShiftCollected: 700,
      });

      expect(await receivable(a.auth, a.rid)).toMatchObject({
        rest: 4500,
        outsideShiftCollected: 1500,
      });
      const cashA = await storeCash(a.auth);
      expect(cashA.summary).toEqual({
        cashIn: 1500,
        cashOut: 0,
        balance: 1500,
      });
      expect(cashA.data.map((e) => e.refId)).toContain(
        paidA.body.payments[0].id,
      );
      const cashB = await storeCash(b.auth);
      expect(cashB.summary).toEqual({ cashIn: 700, cashOut: 0, balance: 700 });
      expect(cashB.data.map((e) => e.refId)).toEqual([
        paidB.body.payments[0].id,
      ]);
      const aList = await get(a.auth, '/receivables').expect(200);
      expect(aList.body.summary).toMatchObject({
        openRest: 4500,
        outsideShiftCollected: 1500,
      });
    });
  });
});
