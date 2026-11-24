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
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
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
    // No shift of their own: accepted, in nobody's drawer (not the owner's open shift either).
    await pay(cashier.auth, s.rid, { amount: 500 }).expect(201);
    const shift = await open(cashier.auth, 0);
    const paid = await pay(cashier.auth, s.rid, { amount: 1000 }).expect(201);
    expect(paid.body.payments).toEqual([
      expect.objectContaining({
        amount: 500,
        collectedOutsideShift: true,
        shiftId: null,
      }),
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

  it('a payment racing the close is counted in the close or lands outside any shift, never both', async () => {
    for (let i = 0; i < 5; i++) {
      const s = await storeWithKasbon();
      const [paid, closed] = await Promise.all([
        pay(s.auth, s.rid, { amount: 1000 }),
        close(s.auth, 100_000),
      ]);
      expect(closed.status).toBe(200);
      expect(paid.status).toBe(201);
      const [payment] = paid.body.payments as {
        collectedOutsideShift: boolean;
        shiftId: string | null;
      }[];
      expect(payment.shiftId).toBe(
        payment.collectedOutsideShift ? null : s.shiftId,
      );
      const counted = payment.collectedOutsideShift ? 0 : 1000;
      expect(closed.body).toMatchObject({
        cashIn: counted,
        expectedCash: 100_000 + counted,
      });
      const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
      expect(detail.body).toMatchObject({
        cashIn: counted,
        expectedCash: 100_000 + counted,
      });
      const r = await get(s.auth, `/receivables/${s.rid}`).expect(200);
      expect(r.body).toMatchObject({
        rest: 5000,
        outsideShiftCollected: 1000 - counted,
      });
    }
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
  describe('cash instalments without an open shift (owner ruling 2026-11-24)', () => {
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
    const receivable = async (auth: string, rid: string) =>
      (await get(auth, `/receivables/${rid}`).expect(200)).body as {
        rest: number;
        outsideShiftCollected: number;
        payments: Payment[];
      };
    /** Every ledger row of the store, read as the database owner. */
    const ledger = (tenantId: string) =>
      admin<{ ref_id: string; shift_id: string }[]>`
        select ref_id, shift_id from pos.shift_cash_entries where tenant_id = ${tenantId}`;

    it('is accepted, audited with its collector and time, and is in no shift, also one opened afterwards', async () => {
      const s = await storeWithKasbon();
      await close(s.auth, 100_000).expect(200);
      const before = (await get(s.auth, `/shifts/${s.shiftId}`).expect(200))
        .body;
      const started = Date.now();

      // Unrounded: a kasbon instalment is taken as handed over.
      const paid = await pay(s.auth, s.rid, { amount: 1250 }).expect(201);
      expect(paid.body).toMatchObject({
        rest: 4750,
        outsideShiftCollected: 1250,
      });
      const [p] = paid.body.payments as Payment[];
      expect(p).toMatchObject({
        amount: 1250,
        paymentMethod: 'Tunai',
        actorId: s.userId,
        actorKind: 'owner',
        actorName: 'Pemilik',
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
        actor_id: s.userId,
        actor_kind: 'owner',
        amount: '1250',
      });
      expect(await ledger(s.tenantId)).toEqual([]);
      expect((await current(s.auth)) ?? null).toBeNull();

      // A shift opened afterwards starts at its opening cash and never picks the payment up.
      const next = await open(s.auth, 20_000);
      expect(await current(s.auth)).toMatchObject({
        id: next.body.id,
        cashIn: 0,
        receivablePayments: 0,
        expectedCash: 20_000,
      });
      // In that shift the old behaviour holds: the next instalment is in its ledger.
      await pay(s.auth, s.rid, { amount: 750 }).expect(201);
      const r = await receivable(s.auth, s.rid);
      expect(r).toMatchObject({ rest: 4000, outsideShiftCollected: 1250 });
      expect(
        r.payments.map((x) => [x.amount, x.collectedOutsideShift, x.shiftId]),
      ).toEqual([
        [1250, true, null],
        [750, false, next.body.id],
      ]);
      const closed = await close(s.auth, 20_750).expect(200);
      expect(closed.body).toMatchObject({
        cashIn: 750,
        receivablePayments: 750,
        expectedCash: 20_750,
        difference: 0,
      });
      const detail = await get(s.auth, `/shifts/${next.body.id}`).expect(200);
      expect(detail.body.cashEntries).toHaveLength(1);
      // The earlier, closed shift did not change either.
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

    it('a cashier with only receivables.manage cannot open a shift and still takes cash', async () => {
      const s = await storeWithKasbon();
      const collector = await createCashier(app, s, ['receivables.manage']);
      await post(collector.auth, '/shifts/open', { openingCash: 0 }).expect(
        403,
      );
      const paid = await pay(collector.auth, s.rid, { amount: 2000 }).expect(
        201,
      );
      expect(paid.body).toMatchObject({
        rest: 4000,
        outsideShiftCollected: 2000,
      });
      expect(paid.body.payments).toEqual([
        expect.objectContaining({
          amount: 2000,
          actorKind: 'cashier',
          actorName: 'Sari',
          collectedOutsideShift: true,
          shiftId: null,
        }),
      ]);
      // The owner's open shift is not the collector's drawer.
      expect(await current(s.auth)).toMatchObject({
        cashIn: 0,
        expectedCash: 100_000,
      });
      expect(await ledger(s.tenantId)).toEqual([]);
      // Pays the rest; overpaying is still refused.
      await pay(collector.auth, s.rid, { amount: 4001 }).expect(422);
      const done = await pay(collector.auth, s.rid, { amount: 4000 }).expect(
        201,
      );
      expect(done.body).toMatchObject({ rest: 0, outsideShiftCollected: 6000 });
      const list = await get(collector.auth, '/receivables').expect(200);
      expect(list.body.data).toEqual([
        expect.objectContaining({ id: s.rid, outsideShiftCollected: 6000 }),
      ]);
      expect(list.body.summary).toEqual({
        openRest: 0,
        openCount: 0,
        outsideShiftCollected: 6000,
      });
    });

    it('a non-cash payment without a shift is not an outside-shift collection', async () => {
      const s = await storeWithKasbon();
      await close(s.auth, 100_000).expect(200);
      const r = await pay(s.auth, s.rid, {
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
      // Neither is a kasbon down payment (it is in the shift's cash sales).
      await open(s.auth, 0);
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
    });

    it('a replay returns the first result and writes nothing, also after a shift was opened', async () => {
      const s = await storeWithKasbon();
      await close(s.auth, 100_000).expect(200);
      const key = randomUUID();
      const first = await pay(s.auth, s.rid, { amount: 1500 }, key).expect(201);
      const again = await pay(s.auth, s.rid, { amount: 1500 }, key).expect(201);
      expect(again.body).toEqual(first.body);
      // Double tap without a shift pays once.
      const key2 = randomUUID();
      const both = await Promise.all([
        pay(s.auth, s.rid, { amount: 500 }, key2),
        pay(s.auth, s.rid, { amount: 500 }, key2),
      ]);
      expect(both.map((r) => r.status)).toEqual([201, 201]);
      const afterTaps = await receivable(s.auth, s.rid);
      expect(afterTaps).toMatchObject({
        rest: 4000,
        outsideShiftCollected: 2000,
      });

      // The shift opens later: the replay does not move the payment into it.
      await open(s.auth, 0);
      const late = await pay(s.auth, s.rid, { amount: 1500 }, key).expect(201);
      expect(late.body).toEqual(afterTaps);
      expect(late.body.payments).toHaveLength(2);
      expect(await current(s.auth)).toMatchObject({
        cashIn: 0,
        expectedCash: 0,
      });
      expect(await ledger(s.tenantId)).toEqual([]);
      // The same key for another amount is still refused.
      await pay(s.auth, s.rid, { amount: 1 }, key).expect(422);
    });

    it('a payment racing /shifts/open lands in the new shift or outside any shift, never both or neither', async () => {
      const seen = new Set<boolean>();
      for (let i = 0; i < 8; i++) {
        const s = await storeWithKasbon();
        await close(s.auth, 100_000).expect(200);
        const [paid, opened] = await Promise.all([
          pay(s.auth, s.rid, { amount: 1000 }),
          post(s.auth, '/shifts/open', { openingCash: 0 }),
        ]);
        expect([paid.status, opened.status]).toEqual([201, 201]);
        const r = await receivable(s.auth, s.rid);
        expect(r.rest).toBe(5000);
        expect(r.payments).toHaveLength(1);
        const [p] = r.payments;
        seen.add(p.collectedOutsideShift);
        const inShift = p.collectedOutsideShift ? 0 : 1000;
        expect(p.shiftId).toBe(p.collectedOutsideShift ? null : opened.body.id);
        expect(r.outsideShiftCollected).toBe(1000 - inShift);
        expect(await ledger(s.tenantId)).toEqual(
          p.collectedOutsideShift
            ? []
            : [{ ref_id: p.id, shift_id: opened.body.id }],
        );
        expect(await current(s.auth)).toMatchObject({
          cashIn: inShift,
          expectedCash: inShift,
        });
        const closed = await close(s.auth, inShift).expect(200);
        expect(closed.body).toMatchObject({
          expectedCash: inShift,
          difference: 0,
        });
      }
      expect(seen.size).toBeGreaterThan(0);
      // Store-wide invariant: a payment never has both the marker and a ledger entry.
      const both = await admin`
        select p.id from pos.receivable_payments p
        join pos.shift_cash_entries e
          on e.tenant_id = p.tenant_id and e.kind = 'receivable_payment' and e.ref_id = p.id
        where p.collected_outside_shift`;
      expect(both).toEqual([]);
    });

    it("cross-tenant: store B cannot pay store A's receivable without a shift and sees none of A's collections", async () => {
      const a = await storeWithKasbon();
      const b = await storeWithKasbon();
      await close(a.auth, 100_000).expect(200);
      await close(b.auth, 100_000).expect(200);
      await pay(a.auth, a.rid, { amount: 1000 }).expect(201);

      await pay(b.auth, a.rid, { amount: 1000 }).expect(404);
      await get(b.auth, `/receivables/${a.rid}`).expect(404);
      const bList = await get(b.auth, '/receivables').expect(200);
      expect(bList.body.data).toEqual([
        expect.objectContaining({ id: b.rid, outsideShiftCollected: 0 }),
      ]);
      expect(bList.body.summary).toMatchObject({
        openRest: 6000,
        outsideShiftCollected: 0,
      });
      expect(await receivable(a.auth, a.rid)).toMatchObject({
        rest: 5000,
        outsideShiftCollected: 1000,
      });
      const aList = await get(a.auth, '/receivables').expect(200);
      expect(aList.body.summary).toMatchObject({
        openRest: 5000,
        outsideShiftCollected: 1000,
      });
      // A key used in store A is free in store B, and B's payment stays B's.
      const key = randomUUID();
      await pay(a.auth, a.rid, { amount: 500 }, key).expect(201);
      const paid = await pay(b.auth, b.rid, { amount: 700 }, key).expect(201);
      expect(paid.body).toMatchObject({
        rest: 5300,
        outsideShiftCollected: 700,
      });
      expect((await receivable(a.auth, a.rid)).outsideShiftCollected).toBe(
        1500,
      );
    });
  });
});
