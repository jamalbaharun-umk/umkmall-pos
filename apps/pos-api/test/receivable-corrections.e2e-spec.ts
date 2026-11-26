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
    const r = await receivable(k.auth, k);
    expect(r.rest).toBe(5000);
    expect(r.payments[0]).toMatchObject({
      status: 'active',
      correctable: true,
    });
  });

  it('cash of a shift still open goes out of THAT shift (also another cashier’s); a closed shift never changes and the cash goes through the shift open now', async () => {
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

    // A cash instalment in the owner's shift, which is then closed (counted Rp2.500).
    const p = await pay(k.auth, k, 2500);
    await post(k.auth, '/shifts/current/close', { countedCash: 2500 }).expect(
      200,
    );
    const closedBefore = await shiftOf(k.auth, k.ownerShiftId);
    expect(closedBefore).toMatchObject({ expectedCash: 2500, cashOut: 0 });
    expect(
      (await receivable(k.auth, k)).payments.find((x) => x.id === p.id),
    ).toMatchObject({ shiftId: k.ownerShiftId, shiftClosed: true });

    // No open shift: refused before the PIN (design: "Belum ada shift buka").
    const none = await correct(
      k.auth,
      k,
      p.id,
      body(k, { amount: 3000 }, { pin: '000000' }),
    ).expect(422);
    expect(none.body).toMatchObject({ code: 'SHIFT_REQUIRED' });
    expect(none.body.message).toMatch(/Belum ada shift buka/);
    expect(await pinFailures(k)).toBe(0);

    const next = await post(k.auth, '/shifts/open', { openingCash: 0 }).expect(
      201,
    );
    await correct(k.auth, k, p.id, body(k, { amount: 3000 })).expect(201);
    // The closed shift's report is unchanged; the open one takes −2.500 and +3.000: "Selisih tunai +Rp500".
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
    expect(await currentShift(k.auth)).toMatchObject({
      id: next.body.id,
      cashIn: 3000,
      cashOut: 2500,
      receivableReversals: 2500,
      expectedCash: 500,
    });
    expect((await receivable(k.auth, k)).rest).toBe(18000 - 2500 - 3000);
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

    // An admin (both permissions) with an own PIN may correct, approved by that PIN.
    const adm = await createCashier(app, k, [
      'sales.create',
      'receivables.manage',
      'sales.void',
    ]);
    await http()
      .put('/void-pin')
      .set('Authorization', adm.auth)
      .send({ pin: '715064' })
      .expect(200);

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
      body(
        k,
        { amount: 2000, paymentMethodId: k.transferId },
        { approverId: adm.staffId, pin: '715064' },
      ),
    ).expect(201);
    expect(ok.body.correction.restAfter).toBe(4000);
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
