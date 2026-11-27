import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

const OWNER_PIN = '482913';

describe('koreksi pembayaran kasbon: a reversal plus a new payment (UMK-1971, design feature 31)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  // Holds the receivable's row lock while a request is in flight (the atomicity and double-submit tests).
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

  const post = (auth: string, url: string, body: object, key?: string) => {
    const req = http().post(url).set('Authorization', auth);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);

  type Payment = {
    id: string;
    amount: number;
    restBefore: number;
    paymentMethod: string;
    status: 'active' | 'reversed' | 'reversal';
    correctable: boolean;
    reversesId: string | null;
    replacesId: string | null;
    reversedById: string | null;
    reasonCode: string | null;
    shiftId: string | null;
    shiftClosed: boolean;
    collectedOutsideShift: boolean;
    downPayment: boolean;
    viaStoreCash: boolean;
  };

  /**
   * The design's store: Siti owes Rp6.000 on a kasbon (one Rp6.000 item, `qty` of them), methods Tunai and Transfer,
   * the owner's void PIN set and an owner shift open with Rp0 in the drawer.
   */
  async function kasbonStore(qty = 1, opts: { down?: number } = {}) {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Sembako',
    }).expect(201);
    const product = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Beras 1 kg',
      costPrice: 4000,
      sellingPrice: 6000,
    }).expect(201);
    await post(s.auth, '/stock/opening', {
      productId: product.body.id,
      qty: 50,
    }).expect(201);
    const kasbon = await post(s.auth, '/payment-methods', {
      name: 'Kasbon',
      kind: 'credit',
    }).expect(201);
    const transfer = await post(s.auth, '/payment-methods', {
      name: 'Transfer',
      kind: 'debit',
    }).expect(201);
    const member = await post(s.auth, '/members', {
      name: 'Siti',
      code: `M${randomUUID().slice(0, 6)}`,
    }).expect(201);
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: OWNER_PIN })
      .expect(200);
    const shift = await post(s.auth, '/shifts/open', {
      openingCash: 0,
    }).expect(201);
    const sale = await post(
      s.auth,
      '/sales',
      {
        lines: [{ productId: product.body.id, qty }],
        memberId: member.body.id,
        paymentMethodId: kasbon.body.id,
        paid: opts.down ?? 0,
      },
      randomUUID(),
    ).expect(201);
    const rid = sale.body.receivableId as string;
    return {
      ...s,
      rid,
      saleId: sale.body.id as string,
      transferId: transfer.body.id as string,
      ownerShiftId: shift.body.id as string,
      productId: product.body.id as string,
      kasbonId: kasbon.body.id as string,
      memberId: member.body.id as string,
    };
  }
  type KasbonStore = Awaited<ReturnType<typeof kasbonStore>>;

  const pay = async (
    auth: string,
    k: KasbonStore,
    amount: number,
    paymentMethodId?: string,
  ) => {
    const res = await post(
      auth,
      `/receivables/${k.rid}/payments`,
      { amount, paymentMethodId },
      randomUUID(),
    ).expect(201);
    const payments = res.body.payments as Payment[];
    return payments[payments.length - 1];
  };
  const receivable = async (auth: string, k: KasbonStore) =>
    (await get(auth, `/receivables/${k.rid}`).expect(200)).body as {
      total: number;
      rest: number;
      payments: Payment[];
    };
  const body = (
    k: KasbonStore,
    replacement: { amount: number; paymentMethodId?: string } | null,
    extra: Record<string, unknown> = {},
  ) => ({
    replacement,
    reasonCode: 'wrong_amount',
    approverId: k.userId,
    pin: OWNER_PIN,
    ...extra,
  });
  const correct = (
    auth: string,
    k: KasbonStore,
    paymentId: string,
    b: object,
    key: string = randomUUID(),
  ) =>
    post(
      auth,
      `/receivables/${k.rid}/payments/${paymentId}/correction`,
      b,
      key,
    );
  const shiftOf = async (auth: string, id: string) =>
    (await get(auth, `/shifts/${id}`).expect(200)).body as Record<
      string,
      unknown
    >;
  const currentShift = async (auth: string) =>
    (await get(auth, '/shifts/current').expect(200)).body.shift as Record<
      string,
      unknown
    >;
  const bookRows = (tenantId: string) =>
    admin<
      {
        amount: string;
        reverses_id: string | null;
        replaces_id: string | null;
      }[]
    >`select amount, reverses_id, replaces_id from pos.receivable_payments
      where tenant_id = ${tenantId} order by created_at, reverses_id is null, id`;
  /** The owner's wrong-PIN count. */
  const pinFailures = async (s: { tenantId: string; userId: string }) =>
    (
      await admin<{ failures: number }[]>`
        select failures from pos.void_pins
        where tenant_id = ${s.tenantId} and actor_id = ${s.userId}`
    )[0]?.failures;

  /** The store's Log aktivitas rows of a kasbon correction (UMK-1969). */
  const auditRows = (tenantId: string) =>
    admin<
      {
        actor_id: string;
        target_type: string;
        target_id: string;
        target_label: string;
        details: Record<string, unknown>;
      }[]
    >`select actor_id, target_type, target_id, target_label, details from pos.audit_log
      where tenant_id = ${tenantId} and event = 'kasbon_correction' order by occurred_at`;
  const today = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(
      new Date(),
    );

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
  /** Holds the receivable's row lock while `during` starts requests and lets them queue behind it. */
  const holdingReceivable = <T>(rid: string, during: () => Promise<T>) =>
    locker.begin(async (sql) => {
      await sql`select id from pos.receivables where id = ${rid} for update`;
      return during();
    }) as Promise<T>;
  const send = (req: request.Test) => req.then((res) => res);

  it('the design example, exact numbers: Rp1.000 transfer cancelled, Rp2.500 tunai corrected to Rp3.000, sisa Rp3.000', async () => {
    const k = await kasbonStore();
    const transfer = await pay(k.auth, k, 1000, k.transferId);
    expect((await receivable(k.auth, k)).rest).toBe(5000);

    // "Batalkan saja": a payment taken from the wrong customer, no replacement.
    const cancelled = await correct(
      k.auth,
      k,
      transfer.id,
      body(k, null, { reasonCode: 'wrong_customer' }),
    ).expect(201);
    expect(cancelled.body.correction).toMatchObject({
      paymentId: transfer.id,
      oldAmount: 1000,
      newAmount: null,
      newPaymentId: null,
      reasonCode: 'wrong_customer',
      restAfter: 6000,
    });

    const cash = await pay(k.auth, k, 2500);
    expect((await receivable(k.auth, k)).rest).toBe(3500);

    const fixed = await correct(
      k.auth,
      k,
      cash.id,
      body(k, { amount: 3000 }),
    ).expect(201);
    expect(fixed.body.correction).toMatchObject({
      paymentId: cash.id,
      oldAmount: 2500,
      newAmount: 3000,
      restAfter: 3000,
    });

    const r = await receivable(k.auth, k);
    // Remaining = kasbon − (payments − reversals), from the book.
    expect(r.total).toBe(6000);
    expect(r.rest).toBe(3000);
    expect(r.payments.reduce((n, p) => n + p.amount, 0)).toBe(3000);
    expect(
      r.payments.map((p) => [
        p.amount,
        p.paymentMethod,
        p.status,
        p.correctable,
        p.restBefore,
      ]),
    ).toEqual([
      [1000, 'Transfer', 'reversed', false, 6000],
      [-1000, 'Transfer', 'reversal', false, 5000],
      [2500, 'Tunai', 'reversed', false, 6000],
      [-2500, 'Tunai', 'reversal', false, 3500],
      [3000, 'Tunai', 'active', true, 6000],
    ]);
    expect(r.payments[1]).toMatchObject({
      reversesId: transfer.id,
      reasonCode: 'wrong_customer',
    });
    expect(r.payments[0].reversedById).toBe(r.payments[1].id);
    expect(r.payments[4]).toMatchObject({ replacesId: cash.id });
    expect(fixed.body.correction.newPaymentId).toBe(r.payments[4].id);

    // Append-only: the originals keep their amounts; the book is five rows.
    expect((await bookRows(k.tenantId)).map((x) => Number(x.amount))).toEqual([
      1000, -1000, 2500, -2500, 3000,
    ]);

    // The drawer (the same shift, still open): +2.500 −2.500 +3.000 = Rp3.000.
    expect(await currentShift(k.auth)).toMatchObject({
      id: k.ownerShiftId,
      cashIn: 5500,
      cashOut: 2500,
      receivablePayments: 5500,
      receivableReversals: 2500,
      expectedCash: 3000,
    });
    const shift = await shiftOf(k.auth, k.ownerShiftId);
    const entries = shift.cashEntries as {
      kind: string;
      direction: string;
      amount: number;
      reversed: boolean;
      reversalOf: { type: string; id: string } | null;
    }[];
    // One transaction writes the reversal and the new payment at the same instant: compared without order.
    expect(
      entries.map((e) => [e.kind, e.direction, e.amount, e.reversed]),
    ).toEqual(
      expect.arrayContaining([
        ['receivable_payment', 'in', 2500, true],
        ['receivable_reversal', 'out', 2500, false],
        ['receivable_payment', 'in', 3000, false],
      ]),
    );
    expect(entries).toHaveLength(3);
    // Laporan kasir shows the reversal as its own figure, not only inside cash out.
    const report = await get(
      k.auth,
      `/reports/shifts?from=${today()}&to=${today()}`,
    ).expect(200);
    expect(
      (report.body.rows as { shiftId: string }[]).find(
        (x) => x.shiftId === k.ownerShiftId,
      ),
    ).toMatchObject({
      receivablePayments: 5500,
      receivableReversals: 2500,
      cashOut: 2500,
    });
    expect(
      entries.find((e) => e.kind === 'receivable_reversal')?.reversalOf,
    ).toMatchObject({
      type: 'receivable_payment',
      id: cash.id,
    });
  });

  it('a correction twice is refused (ALREADY_REVERSED), a reversal row and the down payment are not correctable, the new payment is; none costs a PIN attempt', async () => {
    const k = await kasbonStore(2, { down: 1000 });
    const r0 = await receivable(k.auth, k);
    const down = r0.payments[0];
    expect(down).toMatchObject({
      amount: 1000,
      downPayment: true,
      correctable: false,
    });
    const p = await pay(k.auth, k, 2500);
    const first = await correct(
      k.auth,
      k,
      p.id,
      body(k, { amount: 3000 }),
    ).expect(201);

    // Wrong PIN on purpose: each refusal comes first and counts nowhere.
    const wrong = { pin: '000000' };
    const again = await correct(
      k.auth,
      k,
      p.id,
      body(k, { amount: 2000 }, wrong),
    ).expect(422);
    expect(again.body).toMatchObject({ code: 'ALREADY_REVERSED' });
    expect(again.body.message).toMatch(/sudah dikoreksi/);
    const reversal = await correct(
      k.auth,
      k,
      first.body.correction.id,
      body(k, null, wrong),
    ).expect(422);
    expect(reversal.body.code).toBe('NOT_CORRECTABLE');
    const dp = await correct(k.auth, k, down.id, body(k, null, wrong)).expect(
      422,
    );
    expect(dp.body.code).toBe('DOWN_PAYMENT');
    expect(await pinFailures(k)).toBe(0);

    // The new payment is a payment like any other: it can itself be corrected once.
    const chained = await correct(
      k.auth,
      k,
      first.body.correction.newPaymentId,
      body(
        k,
        { amount: 2000, paymentMethodId: k.transferId },
        {
          reasonCode: 'wrong_method',
        },
      ),
    ).expect(201);
    expect(chained.body.correction).toMatchObject({
      oldAmount: 3000,
      newAmount: 2000,
      restAfter: 12000 - 1000 - 2000,
    });
    // The same amount and way of paying is no correction.
    const same = await correct(
      k.auth,
      k,
      chained.body.correction.newPaymentId,
      body(k, { amount: 2000, paymentMethodId: k.transferId }),
    ).expect(422);
    expect(same.body.code).toBe('SAME_AS_ORIGINAL');
    // More than the kasbon would then owe.
    const over = await correct(
      k.auth,
      k,
      chained.body.correction.newPaymentId,
      body(k, { amount: 11001 }),
    ).expect(422);
    expect(over.body.code).toBe('AMOUNT_EXCEEDS_REST');
    expect(over.body.errors['replacement.amount']).toMatch(/Rp11\.000/);
  });

  it('the same request twice (double submit, also at the same instant) makes one correction and asks the PIN once; the key with another body is refused', async () => {
    const k = await kasbonStore();
    const p = await pay(k.auth, k, 2500);
    const key = randomUUID();
    const b = body(k, { amount: 3000 });
    // Both requests pass the checks and the PIN, then queue on the receivable's lock: the second finds the first.
    const [a, c] = await holdingReceivable(k.rid, async () => {
      const both = [
        send(correct(k.auth, k, p.id, b, key)),
        send(correct(k.auth, k, p.id, b, key)),
      ];
      await untilWaiting(2);
      return both;
    }).then((x) => Promise.all(x));
    expect([a.status, c.status]).toEqual([201, 201]);
    expect(a.body.correction.id).toBe(c.body.correction.id);
    // A later replay is answered from the first result, without checking the PIN again.
    const replay = await correct(
      k.auth,
      k,
      p.id,
      { ...b, pin: '000000' },
      key,
    ).expect(201);
    expect(replay.body.correction.id).toBe(a.body.correction.id);
    expect(await pinFailures(k)).toBe(0);
    expect(await bookRows(k.tenantId)).toHaveLength(3);
    expect((await receivable(k.auth, k)).rest).toBe(3000);
    expect(await currentShift(k.auth)).toMatchObject({ expectedCash: 3000 });

    const reused = await correct(
      k.auth,
      k,
      p.id,
      body(k, { amount: 2000 }),
      key,
    ).expect(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // A correction's key is not a payment's key either.
    await post(
      k.auth,
      `/receivables/${k.rid}/payments`,
      { amount: 100 },
      key,
    ).expect(422);
  });

  it('the reversal and the new payment are one transaction: a new payment refused inside it leaves no reversal behind', async () => {
    const k = await kasbonStore();
    const p = await pay(k.auth, k, 1000, k.transferId);
    // The request passes every check and the PIN (the owner's shift is open), then waits on the receivable's
    // lock; meanwhile the shift closes, so the new CASH payment is refused after the reversal was written.
    const res = await holdingReceivable(k.rid, async () => {
      const pending = send(correct(k.auth, k, p.id, body(k, { amount: 1000 })));
      await untilWaiting(1);
      await post(k.auth, '/shifts/current/close', { countedCash: 0 }).expect(
        200,
      );
      // An array, not the promise itself: the lock is released before the answer is awaited.
      return [pending];
    }).then(([pending]) => pending);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SHIFT_REQUIRED');
    expect(await bookRows(k.tenantId)).toHaveLength(1);
    // The Log aktivitas row rolls back with the correction.
    expect(await auditRows(k.tenantId)).toEqual([]);
    const r = await receivable(k.auth, k);
    expect(r.rest).toBe(5000);
    expect(r.payments[0]).toMatchObject({
      status: 'active',
      correctable: true,
    });
  });

  it('cash of a shift still open goes out of THAT shift (also another cashier’s); a closed shift and today’s drawer never change: the store cash gives it back, with or without an open shift', async () => {
    const k = await kasbonStore(3);
    const rina = await createCashier(app, k, [
      'sales.create',
      'receivables.manage',
    ]);
    const rinaShift = await post(rina.auth, '/shifts/open', {
      openingCash: 0,
    }).expect(201);
    const byRina = await pay(rina.auth, k, 2500);
    // The owner corrects Rina's cash instalment to a transfer while Rina's shift is open.
    await correct(
      k.auth,
      k,
      byRina.id,
      body(
        k,
        { amount: 2500, paymentMethodId: k.transferId },
        {
          reasonCode: 'wrong_method',
        },
      ),
    ).expect(201);
    expect(await currentShift(rina.auth)).toMatchObject({
      id: rinaShift.body.id,
      cashIn: 2500,
      cashOut: 2500,
      expectedCash: 0,
    });
    expect(await currentShift(k.auth)).toMatchObject({
      cashIn: 0,
      cashOut: 0,
      expectedCash: 0,
    });

    // Two cash instalments in the owner's shift, which is then closed (counted Rp5.000).
    const p = await pay(k.auth, k, 2500);
    const q = await pay(k.auth, k, 2500);
    await post(k.auth, '/shifts/current/close', { countedCash: 5000 }).expect(
      200,
    );
    const closedBefore = await shiftOf(k.auth, k.ownerShiftId);
    expect(closedBefore).toMatchObject({ expectedCash: 5000, cashOut: 0 });
    expect(
      (await receivable(k.auth, k)).payments.find((x) => x.id === p.id),
    ).toMatchObject({ shiftId: k.ownerShiftId, shiftClosed: true });
    const storeOut = () =>
      admin<
        { kind: string; direction: string; amount: number; ref_id: string }[]
      >`
        select kind, direction, amount::int as amount, ref_id from pos.store_cash_entries
         where tenant_id = ${k.tenantId} and direction = 'out' order by created_at, amount`;

    // No open shift: the reversal needs none (owner ruling 2026-11-26), only a new CASH payment does, and that
    // refusal still comes before the PIN.
    const cashNoShift = await correct(
      k.auth,
      k,
      q.id,
      body(k, { amount: 3000 }, { pin: '000000' }),
    ).expect(422);
    expect(cashNoShift.body).toMatchObject({ code: 'SHIFT_REQUIRED' });
    expect(cashNoShift.body.message).toMatch(/Buka shift dulu/);
    expect(await pinFailures(k)).toBe(0);
    // The store cash is empty: it cannot give the closed shift's cash back (never below zero, owner ruling
    // 2026-11-27). Then Rp5.000 is in it (seeded: how it got there is not this test's subject).
    const empty = await correct(
      k.auth,
      k,
      p.id,
      body(
        k,
        { amount: 2500, paymentMethodId: k.transferId },
        { reasonCode: 'wrong_method' },
      ),
    ).expect(422);
    expect(empty.body).toMatchObject({
      code: 'STORE_CASH_INSUFFICIENT',
      available: 0,
    });
    await admin`insert into pos.store_cash_entries (tenant_id, direction, kind, amount, actor_id, actor_kind)
      values (${k.tenantId}, 'in', 'expense_void', 5000, ${k.userId}, 'owner')`;
    const toTransfer = await correct(
      k.auth,
      k,
      p.id,
      body(
        k,
        { amount: 2500, paymentMethodId: k.transferId },
        { reasonCode: 'wrong_method' },
      ),
    ).expect(201);
    expect(await storeOut()).toEqual([
      {
        kind: 'receivable_reversal_closed_shift',
        direction: 'out',
        amount: 2500,
        ref_id: toTransfer.body.correction.id,
      },
    ]);

    // With a shift open now: the reversal still leaves the store cash; today's drawer takes only the new cash.
    const next = await post(k.auth, '/shifts/open', { openingCash: 0 }).expect(
      201,
    );
    await correct(k.auth, k, q.id, body(k, { amount: 3000 })).expect(201);
    expect(await currentShift(k.auth)).toMatchObject({
      id: next.body.id,
      cashIn: 3000,
      cashOut: 0,
      receivableReversals: 0,
      expectedCash: 3000,
    });
    expect((await storeOut()).map((e) => [e.kind, e.amount])).toEqual([
      ['receivable_reversal_closed_shift', 2500],
      ['receivable_reversal_closed_shift', 2500],
    ]);
    // The store cash pays it out; no collector holds less (Setoran penagih and Laporan kasbon).
    const store = (await get(k.auth, '/store-cash').expect(200)).body;
    expect(store.summary).toMatchObject({
      cashOut: 5000,
      balance: 0,
      outstanding: 0,
    });
    expect(store.collectors).toEqual([]);
    const report = await get(k.auth, '/reports/receivables').expect(200);
    expect(report.body.summary.collectorHeld).toBe(0);

    // The closed shift's report is unchanged.
    const closedAfter = await shiftOf(k.auth, k.ownerShiftId);
    for (const field of [
      'expectedCash',
      'countedCash',
      'cashIn',
      'cashOut',
      'difference',
    ])
      expect(closedAfter[field]).toEqual(closedBefore[field]);
    expect(closedAfter.cashEntries).toEqual(
      (closedBefore.cashEntries as { reversed: boolean }[]).map((e) => ({
        ...e,
        // Only the derived marker says the instalment was corrected later.
        reversed: true,
      })),
    );
    // The history says where the reversal's cash came from.
    const r = await receivable(k.auth, k);
    expect(
      r.payments
        .filter((x) => x.status === 'reversal')
        .map((x) => [x.amount, x.viaStoreCash, x.shiftId]),
    ).toEqual([
      [-2500, false, rinaShift.body.id],
      [-2500, true, null],
      [-2500, true, null],
    ]);
    expect(r.rest).toBe(18000 - 2500 - 2500 - 3000);
  });

  it('collector cash: a reversal lowers what the collector holds, never below what they already deposited (REVERSAL_EXCEEDS_HELD)', async () => {
    const k = await kasbonStore(5);
    // `receivables.manage` alone: cannot open a shift, so collects outside every shift.
    const c = await createCashier(app, k, ['receivables.manage']);
    const big = await pay(c.auth, k, 10_000);
    const small = await pay(c.auth, k, 5000);
    const held = async () =>
      (await get(k.auth, '/store-cash').expect(200)).body as {
        summary: Record<string, number>;
        collectors: Record<string, unknown>[];
      };
    expect((await held()).summary).toMatchObject({
      balance: 15_000,
      outstanding: 15_000,
    });

    await correct(k.auth, k, small.id, body(k, null)).expect(201);
    const after = await held();
    expect(after.summary).toMatchObject({
      cashIn: 15_000,
      cashOut: 5000,
      balance: 10_000,
      outstanding: 10_000,
    });
    expect(after.collectors).toEqual([
      expect.objectContaining({
        collectorId: c.staffId,
        collected: 10_000,
        handedOver: 0,
        outstanding: 10_000,
      }),
    ]);
    expect(
      (await get(c.auth, '/store-cash/mine').expect(200)).body,
    ).toMatchObject({ collected: 10_000, outstanding: 10_000 });

    // The owner receives Rp8.000 of it into the drawer: Rp2.000 is still with the collector.
    await post(
      k.auth,
      '/store-cash/deposits',
      { collectorId: c.staffId, amount: 8000 },
      randomUUID(),
    ).expect(201);
    const refused = await correct(
      k.auth,
      k,
      big.id,
      body(k, { amount: 9000 }),
    ).expect(422);
    expect(refused.body).toMatchObject({
      code: 'REVERSAL_EXCEEDS_HELD',
      outstanding: 2000,
    });
    expect(refused.body.message).toMatch(/sudah disetor/);
    // Refused before the PIN: a wrong PIN gets the same answer and counts nowhere.
    const again = await correct(
      k.auth,
      k,
      big.id,
      body(k, null, { pin: '000000' }),
    ).expect(422);
    expect(again.body.code).toBe('REVERSAL_EXCEEDS_HELD');
    expect(await pinFailures(k)).toBe(0);
    expect(await bookRows(k.tenantId)).toHaveLength(3);
    expect((await held()).summary).toMatchObject({
      balance: 2000,
      outstanding: 2000,
    });
    expect((await receivable(k.auth, k)).rest).toBe(30_000 - 10_000);
  });

  it('writes one Log aktivitas row per correction (ids, amounts, reason, approver; no note, no customer); a refused one writes none', async () => {
    const k = await kasbonStore();
    const p = await pay(k.auth, k, 2500);
    const note = 'Siti 081234567890 bayar dobel';
    const res = await correct(
      k.auth,
      k,
      p.id,
      body(k, { amount: 3000 }, { reasonCode: 'other', note }),
    ).expect(201);
    const c = res.body.correction;
    const rows = await auditRows(k.tenantId);
    expect(rows).toEqual([
      {
        actor_id: k.userId,
        target_type: 'receivable',
        target_id: k.rid,
        target_label: expect.stringMatching(/^Kasbon struk #\d+$/),
        details: {
          receivableId: k.rid,
          paymentId: p.id,
          reversalId: c.id,
          newPaymentId: c.newPaymentId,
          oldAmount: 2500,
          newAmount: 3000,
          reasonCode: 'other',
          approvedBy: k.userId,
        },
      },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/Siti|0812|dobel|482913/);
    // Shown in the money group of the screen's API.
    const log = await get(k.auth, '/audit-log?group=money').expect(200);
    expect(log.body.data[0]).toMatchObject({
      event: 'kasbon_correction',
      group: 'money',
    });

    // Refused before the PIN (twice), at the PIN, and "Batalkan saja" of the new payment with a wrong PIN: no row.
    await correct(k.auth, k, p.id, body(k, null)).expect(422);
    await correct(
      k.auth,
      k,
      c.newPaymentId,
      body(k, null, { pin: '000000' }),
    ).expect(422);
    expect(await auditRows(k.tenantId)).toHaveLength(1);
    // A replay of the first request answers it again and writes nothing more.
    expect(await bookRows(k.tenantId)).toHaveLength(3);
  });

  it('a collector instalment whose cash was already deposited in full is not correctable (REVERSAL_EXCEEDS_HELD, Rp0 held), whatever the fix', async () => {
    // The rule as built (review of PR 65 asks the owner): a deposit moved the cash into a drawer, so a correction
    // that would take it back out of the collector's hands has no cash to take. Pinned here so a change is deliberate.
    const k = await kasbonStore();
    const c = await createCashier(app, k, ['receivables.manage']);
    const p = await pay(c.auth, k, 5000);
    await post(
      k.auth,
      '/store-cash/deposits',
      { collectorId: c.staffId, amount: 5000 },
      randomUUID(),
    ).expect(201);
    for (const fix of [
      body(k, null, { reasonCode: 'wrong_customer' }),
      body(
        k,
        { amount: 5000, paymentMethodId: k.transferId },
        { reasonCode: 'wrong_method' },
      ),
      body(k, { amount: 4000 }),
    ]) {
      const refused = await correct(k.auth, k, p.id, fix).expect(422);
      expect(refused.body).toMatchObject({
        code: 'REVERSAL_EXCEEDS_HELD',
        outstanding: 0,
      });
    }
    expect(await pinFailures(k)).toBe(0);
    expect(await bookRows(k.tenantId)).toHaveLength(1);
    expect(await auditRows(k.tenantId)).toEqual([]);
    expect((await receivable(k.auth, k)).rest).toBe(1000);
  });

  describe('at the same time', () => {
    it('two corrections of one payment with different keys: one is written, the other is ALREADY_REVERSED', async () => {
      const k = await kasbonStore();
      const p = await pay(k.auth, k, 2500);
      const [a, b] = await holdingReceivable(k.rid, async () => {
        const both = [
          send(correct(k.auth, k, p.id, body(k, { amount: 3000 }))),
          send(
            correct(
              k.auth,
              k,
              p.id,
              body(k, null, { reasonCode: 'duplicate' }),
            ),
          ),
        ];
        await untilWaiting(2);
        return both;
      }).then((x) => Promise.all(x));
      const ok = [a, b].filter((r) => r.status === 201);
      const refused = [a, b].filter((r) => r.status !== 201);
      expect(ok).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0].status).toBe(422);
      expect(refused[0].body.code).toBe('ALREADY_REVERSED');
      const r = await receivable(k.auth, k);
      expect(r.payments.filter((x) => x.status === 'reversal')).toHaveLength(1);
      expect(r.rest).toBe(6000 - (ok[0].body.correction.newAmount ?? 0));
      expect(r.rest).toBe(6000 - r.payments.reduce((n, x) => n + x.amount, 0));
      expect(await auditRows(k.tenantId)).toHaveLength(1);
    });

    it('two cashiers correcting each other’s cash instalments: both drawers are locked in one order, no deadlock', async () => {
      const k = await kasbonStore();
      const sale2 = await post(
        k.auth,
        '/sales',
        {
          lines: [{ productId: k.productId, qty: 1 }],
          memberId: k.memberId,
          paymentMethodId: k.kasbonId,
          paid: 0,
        },
        randomUUID(),
      ).expect(201);
      const k2 = { ...k, rid: sale2.body.receivableId as string };
      const perms = [
        'sales.create',
        'receivables.manage',
        'sales.void',
      ] as const;
      const x = await createCashier(app, k, [...perms]);
      const y = await createCashier(app, k, [...perms]);
      const sx = (
        await post(x.auth, '/shifts/open', { openingCash: 0 }).expect(201)
      ).body.id as string;
      const sy = (
        await post(y.auth, '/shifts/open', { openingCash: 0 }).expect(201)
      ).body.id as string;
      const byX = await pay(x.auth, k, 2500);
      const byY = await pay(y.auth, k2, 2500);
      // Both drawers held: each request passes its checks and PIN, then waits on its first drawer. Released at once,
      // a correction that locked "its instalment's drawer, then its own" would hold one each and wait for the other.
      const done = await locker
        .begin(async (sql) => {
          await sql`select id from pos.shifts where id in (${sx}, ${sy}) for update`;
          const both = [
            send(correct(y.auth, k, byX.id, body(k, { amount: 3000 }))),
            send(correct(x.auth, k2, byY.id, body(k, { amount: 3000 }))),
          ];
          await untilWaiting(2);
          // An array, not the promises: the locks are released before the answers are awaited.
          return [both];
        })
        .then(([both]) => Promise.all(both as Promise<request.Response>[]));
      expect(done.map((r) => r.status)).toEqual([201, 201]);
      // Each drawer: its own instalment in, taken back out by the colleague's correction, the new payment in.
      for (const who of [x, y])
        expect(await currentShift(who.auth)).toMatchObject({
          cashIn: 5500,
          cashOut: 2500,
          expectedCash: 3000,
        });
    });

    it('a correction and the collector’s deposit at once: one of them is refused, the collector never holds less than Rp0', async () => {
      const k = await kasbonStore(2);
      const c = await createCashier(app, k, ['receivables.manage']);
      const p = await pay(c.auth, k, 10_000);
      const [corr, dep] = await locker
        .begin(async (sql) => {
          await sql`select id from pos.staff where id = ${c.staffId} for update`;
          const both = [
            send(
              correct(
                k.auth,
                k,
                p.id,
                body(k, null, { reasonCode: 'duplicate' }),
              ),
            ),
            send(
              post(
                k.auth,
                '/store-cash/deposits',
                { collectorId: c.staffId, amount: 10_000 },
                randomUUID(),
              ),
            ),
          ];
          await untilWaiting(2);
          return [both];
        })
        .then(([both]) => Promise.all(both as Promise<request.Response>[]));
      expect([corr.status, dep.status].sort()).toEqual([201, 422]);
      if (corr.status === 201)
        expect(dep.body.code).toMatch(
          /^(NOTHING_OUTSTANDING|DEPOSIT_EXCEEDS_OUTSTANDING)$/,
        );
      else expect(corr.body).toMatchObject({ code: 'REVERSAL_EXCEEDS_HELD' });
      const store = (await get(k.auth, '/store-cash').expect(200)).body;
      expect(store.summary).toMatchObject({ outstanding: 0 });
      expect((await receivable(k.auth, k)).rest).toBe(
        corr.status === 201 ? 12_000 : 2000,
      );
    });

    it('a correction and a new payment on the same kasbon at once: applied one after the other, never paid beyond the total', async () => {
      const k = await kasbonStore();
      const p = await pay(k.auth, k, 2500);
      // Alone, each fits: Rp3.500 pays the rest off; Rp2.500 -> Rp4.000 leaves Rp2.000. Together they do not.
      const [corr, paid] = await holdingReceivable(k.rid, async () => {
        const both = [
          send(correct(k.auth, k, p.id, body(k, { amount: 4000 }))),
          send(
            post(
              k.auth,
              `/receivables/${k.rid}/payments`,
              { amount: 3500 },
              randomUUID(),
            ),
          ),
        ];
        await untilWaiting(2);
        return both;
      }).then((x) => Promise.all(x));
      expect([corr.status, paid.status].sort()).toEqual([201, 422]);
      if (paid.status === 201)
        expect(corr.body.code).toBe('AMOUNT_EXCEEDS_REST');
      const r = await receivable(k.auth, k);
      expect(r.rest).toBe(corr.status === 201 ? 2000 : 0);
      expect(r.rest).toBe(6000 - r.payments.reduce((n, x) => n + x.amount, 0));
      expect(await currentShift(k.auth)).toMatchObject({
        expectedCash: 6000 - r.rest,
      });
    });

    it('a correction and a void of the receipt at once: the void gives back exactly the payments standing when it runs', async () => {
      const k = await kasbonStore();
      const p = await pay(k.auth, k, 2500);
      const [corr, voided] = await holdingReceivable(k.rid, async () => {
        const both = [
          send(correct(k.auth, k, p.id, body(k, { amount: 3000 }))),
          send(
            post(
              k.auth,
              `/sales/${k.saleId}/void`,
              {
                reasonCode: 'customer_cancelled',
                approverId: k.userId,
                pin: OWNER_PIN,
              },
              randomUUID(),
            ),
          ),
        ];
        await untilWaiting(2);
        return both;
      }).then((x) => Promise.all(x));
      expect(voided.status).toBe(201);
      if (corr.status === 201) expect(voided.body.cashReturned).toBe(3000);
      else {
        expect([corr.status, corr.body.code]).toEqual([
          422,
          'RECEIVABLE_CANCELLED',
        ]);
        expect(voided.body.cashReturned).toBe(2500);
      }
      // Whatever the order, the drawer ends where it began.
      expect(await currentShift(k.auth)).toMatchObject({ expectedCash: 0 });
    });
  });

  it('a voided kasbon gives back only the payments that still stand, and its payments are no longer correctable', async () => {
    const k = await kasbonStore();
    const transfer = await pay(k.auth, k, 1000, k.transferId);
    await correct(k.auth, k, transfer.id, body(k, null)).expect(201);
    const cash = await pay(k.auth, k, 2500);
    const fixed = await correct(
      k.auth,
      k,
      cash.id,
      body(k, { amount: 3000 }),
    ).expect(201);
    const voided = await post(
      k.auth,
      `/sales/${k.saleId}/void`,
      {
        reasonCode: 'customer_cancelled',
        approverId: k.userId,
        pin: OWNER_PIN,
      },
      randomUUID(),
    ).expect(201);
    expect(voided.body).toMatchObject({
      cashReturned: 3000,
      transferReturned: 0,
      receivableCancelled: 3000,
    });
    expect(voided.body.returns).toEqual([
      expect.objectContaining({
        amount: 3000,
        receivablePaymentId: fixed.body.correction.newPaymentId,
      }),
    ]);
    // +2.500 −2.500 +3.000 −3.000 (the void): the drawer is back to its opening cash.
    expect(await currentShift(k.auth)).toMatchObject({ expectedCash: 0 });

    const r = await receivable(k.auth, k);
    expect(r.payments.every((p) => !p.correctable)).toBe(true);
    const late = await correct(
      k.auth,
      k,
      fixed.body.correction.newPaymentId,
      body(k, null, { pin: '000000' }),
    ).expect(422);
    expect(late.body.code).toBe('RECEIVABLE_CANCELLED');
  });

  it('needs sales.void and receivables.manage, a reason and a valid PIN; an agent never corrects', async () => {
    const k = await kasbonStore();
    const p = await pay(k.auth, k, 2500);
    const collector = await createCashier(app, k, ['receivables.manage']);
    const voider = await createCashier(app, k, ['sales.void']);
    await correct(collector.auth, k, p.id, body(k, null)).expect(403);
    await correct(voider.auth, k, p.id, body(k, null)).expect(403);

    // An admin (both permissions) may correct, approved by another person's PIN (here the owner's).
    const adm = await createCashier(app, k, [
      'sales.create',
      'receivables.manage',
      'sales.void',
    ]);

    const bad = async (b: object, field: string) => {
      const res = await correct(k.auth, k, p.id, b).expect(422);
      expect(res.body.errors[field]).toBeDefined();
      return res;
    };
    const wrongPin = await bad(body(k, null, { pin: '000000' }), 'pin');
    expect(wrongPin.body.errors.pin).toBe('PIN salah');
    expect(await pinFailures(k)).toBe(1);
    await bad(body(k, null, { reasonCode: undefined }), 'reasonCode');
    await bad(body(k, null, { reasonCode: 'oops' }), 'reasonCode');
    await bad(body(k, null, { reasonCode: 'other' }), 'note');
    await bad(body(k, null, { pin: '12345' }), 'pin');
    await bad({ ...body(k, null), replacement: undefined }, 'replacement');
    await bad(body(k, { amount: 0 }), 'replacement.amount');
    await bad(body(k, { amount: 1.5 }), 'replacement.amount');
    await bad(body(k, null, { tenantId: randomUUID() }), 'tenantId');
    // An approver without `sales.void` gets the wrong-PIN answer.
    const plain = await createCashier(app, k, ['sales.create'], '246810');
    await bad(
      body(k, null, { approverId: plain.staffId, pin: '246810' }),
      'pin',
    );
    await correct(k.auth, k, p.id, body(k, null), 'bad key!').expect(422);
    await post(
      k.auth,
      `/receivables/${k.rid}/payments/${p.id}/correction`,
      body(k, null),
    ).expect(422);
    expect(await bookRows(k.tenantId)).toHaveLength(1);

    const ok = await correct(
      adm.auth,
      k,
      p.id,
      body(k, { amount: 2000, paymentMethodId: k.transferId }),
    ).expect(201);
    expect(ok.body.correction.restAfter).toBe(4000);
  });

  it('a second person approves: staff naming themself is refused before the PIN (CORRECTION_SELF_APPROVAL) and is not offered; the owner may approve their own', async () => {
    const k = await kasbonStore();
    const p = await pay(k.auth, k, 2500);
    const perms = ['sales.create', 'receivables.manage', 'sales.void'] as const;
    const adm = await createCashier(app, k, [...perms]);
    const adm2 = await createCashier(app, k, [...perms]);
    for (const a of [adm, adm2])
      await http()
        .put('/void-pin')
        .set('Authorization', a.auth)
        .send({ pin: a === adm ? '715064' : '135790' })
        .expect(200);
    const failures = async (actorId: string) =>
      (
        await admin<{ failures: number }[]>`
          select failures from pos.void_pins
          where tenant_id = ${k.tenantId} and actor_id = ${actorId}`
      )[0]?.failures ?? 0;

    // The picker leaves the asking staff member out; the owner sees themself.
    const ids = async (auth: string) =>
      (
        (await get(auth, '/receivables/correction-approvers').expect(200))
          .body as { id: string }[]
      ).map((a) => a.id);
    const forAdm = await ids(adm.auth);
    expect(forAdm).toEqual(expect.arrayContaining([k.userId, adm2.staffId]));
    expect(forAdm).not.toContain(adm.staffId);
    expect(await ids(k.auth)).toEqual(
      expect.arrayContaining([k.userId, adm.staffId, adm2.staffId]),
    );
    // Only for someone who may correct.
    const collector = await createCashier(app, k, ['receivables.manage']);
    await get(collector.auth, '/receivables/correction-approvers').expect(403);

    // Naming themself: refused, with the right PIN too, also in other letter case; no attempt counted, nothing written.
    for (const approverId of [adm.staffId, adm.staffId.toUpperCase()])
      for (const pin of ['000000', '715064']) {
        const self = await correct(
          adm.auth,
          k,
          p.id,
          body(k, null, { approverId, pin }),
        ).expect(422);
        expect(self.body).toMatchObject({ code: 'CORRECTION_SELF_APPROVAL' });
        expect(self.body.errors.approverId).toMatch(/admin lain atau pemilik/);
      }
    expect(await failures(adm.staffId)).toBe(0);
    expect(await bookRows(k.tenantId)).toHaveLength(1);
    expect(await auditRows(k.tenantId)).toEqual([]);

    // Another admin approves.
    const ok = await correct(
      adm.auth,
      k,
      p.id,
      body(
        k,
        // A transfer: the admin has no shift open for cash.
        { amount: 3000, paymentMethodId: k.transferId },
        { approverId: adm2.staffId, pin: '135790' },
      ),
    ).expect(201);
    expect((await auditRows(k.tenantId))[0]).toMatchObject({
      actor_id: adm.staffId,
      details: { approvedBy: adm2.staffId },
    });
    // The owner approves their own correction with their PIN.
    await correct(
      k.auth,
      k,
      ok.body.correction.newPaymentId,
      body(k, null),
    ).expect(201);
  });

  it('cross-tenant: store B gets 404 on store A’s receivable and payment, for the correction and the read; A is unchanged', async () => {
    const a = await kasbonStore();
    const b = await kasbonStore();
    const pa = await pay(a.auth, a, 2500);
    const pb = await pay(b.auth, b, 1000);
    const asB = { ...b, rid: a.rid };
    // B's own PIN, A's receivable and payment.
    await correct(b.auth, asB, pa.id, body(b, null)).expect(404);
    // B's receivable, A's payment.
    await correct(b.auth, b, pa.id, body(b, null)).expect(404);
    // A's receivable, B's payment.
    await correct(b.auth, asB, pb.id, body(b, null)).expect(404);
    await get(b.auth, `/receivables/${a.rid}`).expect(404);
    // A's owner as approver from store B: wrong PIN, never A's PIN row.
    await correct(
      b.auth,
      b,
      pb.id,
      body(b, null, { approverId: a.userId }),
    ).expect(422);
    expect(await pinFailures(a)).toBe(0);
    const ra = await receivable(a.auth, a);
    expect(ra.rest).toBe(3500);
    expect(ra.payments).toHaveLength(1);
    expect(await bookRows(a.tenantId)).toHaveLength(1);
  });

  it('a store’s book with corrections is deleted in one statement, as the purge deletes it (the links are checked at the end)', async () => {
    const k = await kasbonStore();
    const p = await pay(k.auth, k, 2500);
    await correct(k.auth, k, p.id, body(k, { amount: 3000 })).expect(201);
    await admin
      .begin(async (sql) => {
        const gone = await sql`
        delete from pos.receivable_payments where tenant_id = ${k.tenantId}`;
        expect(gone.count).toBe(3);
        throw new Error('rollback');
      })
      .catch((e: Error) => expect(e.message).toBe('rollback'));
  });
});
