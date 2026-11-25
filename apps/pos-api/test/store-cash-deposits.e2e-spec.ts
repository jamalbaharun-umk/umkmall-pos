import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

describe('setoran penagih: a collector’s outside-shift cash into a shift drawer (UMK-1924 U3)', () => {
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

  const post = (auth: string, url: string, body: object) =>
    http().post(url).set('Authorization', auth).send(body);
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);
  const deposit = (auth: string, body: unknown, key: string = randomUUID()) =>
    http()
      .post('/store-cash/deposits')
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body as object);
  const storeCash = async (auth: string) =>
    (await get(auth, '/store-cash').expect(200)).body as {
      data: Record<string, unknown>[];
      total: number;
      summary: Record<string, number>;
      collectors: Record<string, unknown>[];
    };

  /** Row counts of what a deposit writes, read as the database owner. */
  const written = async (tenantId: string) => {
    const [r] = await admin<
      {
        deposits: number;
        storeOut: number;
        transfers: number;
        drawerIn: number;
      }[]
    >`
      select (select count(*)::int from pos.store_cash_deposits where tenant_id = ${tenantId}) as deposits,
             (select count(*)::int from pos.store_cash_entries
               where tenant_id = ${tenantId} and direction = 'out' and kind = 'collector_deposit') as "storeOut",
             (select count(*)::int from pos.store_cash_entries
               where tenant_id = ${tenantId} and direction = 'transfer') as transfers,
             (select count(*)::int from pos.shift_cash_entries
               where tenant_id = ${tenantId} and direction = 'in' and kind = 'collector_deposit') as "drawerIn"`;
    return r;
  };
  /** `n` deposits: one audit row, one store ledger `out` and one drawer `in` each, never a `transfer`. */
  const deposits = (n: number) => ({
    deposits: n,
    storeOut: n,
    transfers: 0,
    drawerIn: n,
  });
  const openShift = async (auth: string, openingCash = 0) =>
    (await post(auth, '/shifts/open', { openingCash }).expect(201)).body as {
      id: string;
      number: number;
    };
  const currentShift = async (auth: string) =>
    (await get(auth, '/shifts/current').expect(200)).body.shift as Record<
      string,
      number
    >;
  /** May open a shift and receive a deposit into it. */
  const receiverOf = (s: Awaited<ReturnType<typeof createStore>>) =>
    createCashier(app, s, ['sales.create', 'store_cash.manage']);

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
  const send = (req: request.Test) => req.then((res) => res);
  /** Holds one staff row's lock while `during` starts requests and waits until they queue behind it. */
  const holdingStaff = <T>(id: string, during: () => Promise<T>) =>
    locker.begin(async (sql) => {
      await sql`select id from pos.staff where id = ${id} for update`;
      return during();
    }) as Promise<T>;

  /**
   * A store with a kasbon receivable of Rp60.000 (rung up in an owner shift that is closed again) and
   * `collect(auth, amount)`: a cash instalment taken with that session. The owner then has a new open
   * shift (`shiftId`, opening cash 0) to receive deposits into, unless `ownerShift` is false.
   */
  async function storeWithKasbon(ownerShift = true) {
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
    await post(s.auth, '/stock/opening', {
      productId: p.body.id,
      qty: 50,
    }).expect(201);
    const kasbon = await post(s.auth, '/payment-methods', {
      name: 'Kasbon',
      kind: 'credit',
    }).expect(201);
    const member = await post(s.auth, '/members', {
      name: 'Bu Sari',
      code: `M${randomUUID().slice(0, 6)}`,
      phone: '081234567890',
    }).expect(201);
    await post(s.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    const sale = await http()
      .post('/sales')
      .set('Authorization', s.auth)
      .set('Idempotency-Key', randomUUID())
      .send({
        lines: [{ productId: p.body.id, qty: 10 }],
        memberId: member.body.id,
        paymentMethodId: kasbon.body.id,
        paid: 0,
      })
      .expect(201);
    await post(s.auth, '/shifts/current/close', { countedCash: 0 }).expect(200);
    const rid = sale.body.receivableId as string;
    const collect = (auth: string, amount: number) =>
      http()
        .post(`/receivables/${rid}/payments`)
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({ amount })
        .expect(201);
    const shift = ownerShift ? await openShift(s.auth) : null;
    return {
      ...s,
      rid,
      collect,
      shiftId: shift?.id as string,
      shiftNumber: shift?.number as number,
    };
  }
  /** `receivables.manage` only: may not sell, so collects outside every shift. */
  const collector = (s: Awaited<ReturnType<typeof createStore>>) =>
    createCashier(app, s, ['receivables.manage']);

  it('a deposit lowers the collector’s outstanding, is audited, and moves the cash from the store’s cash into the drawer', async () => {
    const s = await storeWithKasbon();
    const c = await collector(s);
    await s.collect(c.auth, 10_000);
    await s.collect(c.auth, 5000);

    const before = await storeCash(s.auth);
    expect(before.summary).toEqual({
      cashIn: 15_000,
      cashOut: 0,
      balance: 15_000,
      outstanding: 15_000,
      handedOver: 0,
    });
    expect(before.collectors).toEqual([
      {
        collectorId: c.staffId,
        collectorKind: 'cashier',
        collectorName: 'Sari',
        collected: 15_000,
        handedOver: 0,
        outstanding: 15_000,
        active: true,
      },
    ]);
    expect(await currentShift(s.auth)).toMatchObject({
      expectedCash: 0,
      cashIn: 0,
      collectorDeposits: 0,
    });

    const started = Date.now();
    const done = await deposit(s.auth, {
      collectorId: c.staffId,
      amount: 6000,
      note: '  setoran sore  ',
    }).expect(201);
    expect(done.body).toEqual({
      id: expect.any(String),
      collectorId: c.staffId,
      collectorName: 'Sari',
      amount: 6000,
      note: 'setoran sore',
      outstandingBefore: 15_000,
      outstandingAfter: 9000,
      receivedById: s.userId,
      receivedByKind: 'owner',
      receivedByName: 'Pemilik',
      shiftId: s.shiftId,
      shiftNumber: s.shiftNumber,
      shiftActorName: 'Pemilik',
      createdAt: expect.any(String),
    });
    // The store's second shift (the first rang up the kasbon).
    expect(s.shiftNumber).toBe(2);
    expect(Date.parse(done.body.createdAt)).toBeGreaterThan(started - 5000);

    const after = await storeCash(s.auth);
    // Never counted twice: the cash left the store's cash (outside every drawer) and is in the drawer.
    expect(after.summary).toEqual({
      cashIn: 15_000,
      cashOut: 6000,
      balance: 9000,
      outstanding: 9000,
      handedOver: 6000,
    });
    const drawer = await currentShift(s.auth);
    expect(drawer).toMatchObject({
      expectedCash: 6000,
      cashIn: 6000,
      collectorDeposits: 6000,
      receivablePayments: 0,
      manualIn: 0,
    });
    // Store cash + drawer is what it was before the deposit (15.000 + 0).
    expect(after.summary.balance + drawer.expectedCash).toBe(
      before.summary.balance + 0,
    );
    expect(await written(s.tenantId)).toEqual(deposits(1));
    expect(after.collectors).toEqual([
      {
        collectorId: c.staffId,
        collectorKind: 'cashier',
        collectorName: 'Sari',
        collected: 15_000,
        handedOver: 6000,
        outstanding: 9000,
        active: true,
      },
    ]);
    // The store ledger has the handover as an `out` by the receiver, with the deposit as its source.
    expect(after.total).toBe(3);
    expect(after.data[0]).toEqual({
      id: expect.any(String),
      direction: 'out',
      kind: 'collector_deposit',
      amount: 6000,
      refId: done.body.id,
      note: 'setoran sore',
      actorId: s.userId,
      actorKind: 'owner',
      actorName: 'Pemilik',
      createdAt: expect.any(String),
    });

    const audit = await get(s.auth, '/store-cash/deposits').expect(200);
    expect(audit.body).toEqual({
      data: [done.body],
      total: 1,
      page: 1,
      perPage: 20,
    });
    await get(s.auth, '/store-cash/deposits?page=0').expect(422);
    const [row] = await admin`
      select collector_id, received_by_id, received_by_kind, amount, outstanding_before
      from pos.store_cash_deposits where id = ${done.body.id}`;
    expect(row).toMatchObject({
      collector_id: c.staffId,
      received_by_id: s.userId,
      received_by_kind: 'owner',
      amount: '6000',
      outstanding_before: '15000',
    });

    // The drawer list of the shift: "Setoran penagih · Sari · diterima Pemilik".
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body).toMatchObject({
      number: 2,
      actorName: 'Pemilik',
      collectorDeposits: 6000,
      cashIn: 6000,
    });
    expect(detail.body.cashEntries).toEqual([
      {
        id: expect.any(String),
        direction: 'in',
        kind: 'collector_deposit',
        amount: 6000,
        refId: done.body.id,
        note: 'setoran sore',
        reason: null,
        reasonLabel: null,
        actorId: s.userId,
        actorKind: 'owner',
        actorName: 'Pemilik',
        collectorId: c.staffId,
        collectorName: 'Sari',
        reversed: false,
        reversalOf: null,
        createdAt: expect.any(String),
      },
    ]);
    // At close the count is reconciled against it, and the closed shift keeps the line.
    const closed = await post(s.auth, '/shifts/current/close', {
      countedCash: 6000,
    }).expect(200);
    expect(closed.body).toMatchObject({
      expectedCash: 6000,
      difference: 0,
      collectorDeposits: 6000,
      number: 2,
      actorName: 'Pemilik',
    });
    // The shift report row carries the same figure.
    const day = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const report = await get(
      s.auth,
      `/reports/shifts?from=${day}&to=${day}`,
    ).expect(200);
    expect(
      (report.body.rows as { shiftId: string }[]).find(
        (r) => r.shiftId === s.shiftId,
      ),
    ).toMatchObject({ collectorDeposits: 6000, cashIn: 6000 });
  });

  it('needs an open shift: 422 SHIFT_REQUIRED, nothing written, the key not claimed', async () => {
    const s = await storeWithKasbon(false);
    const c = await collector(s);
    await s.collect(c.auth, 7000);
    const key = randomUUID();
    const body = { collectorId: c.staffId, amount: 4000 };

    // The owner's only shift is closed: a closed shift is not a drawer.
    const refused = await deposit(s.auth, body, key).expect(422);
    expect(refused.body).toEqual({
      message: 'Buka shift dulu agar uang setoran masuk laci',
      errors: { _: 'Buka shift dulu agar uang setoran masuk laci' },
      code: 'SHIFT_REQUIRED',
    });
    expect(await written(s.tenantId)).toEqual(deposits(0));
    expect((await storeCash(s.auth)).summary).toMatchObject({
      cashOut: 0,
      balance: 7000,
      outstanding: 7000,
      handedOver: 0,
    });
    // A receiver who could open a shift but has not: the same.
    const receiver = await receiverOf(s);
    const idle = await deposit(receiver.auth, body).expect(422);
    expect(idle.body.code).toBe('SHIFT_REQUIRED');
    expect(await written(s.tenantId)).toEqual(deposits(0));

    // The refused key was not claimed: the same request works once a shift is open.
    const shift = await openShift(s.auth, 1000);
    const done = await deposit(s.auth, body, key).expect(201);
    expect(done.body).toMatchObject({ shiftId: shift.id, amount: 4000 });
    expect(await written(s.tenantId)).toEqual(deposits(1));
    expect((await currentShift(s.auth)).expectedCash).toBe(5000);
  });

  it('an owner may name the open shift that takes the cash; a cashier only ever receives into their own', async () => {
    const s = await storeWithKasbon(false);
    const c = await collector(s);
    await s.collect(c.auth, 10_000);
    const rina = await receiverOf(s);
    const other = await receiverOf(s);
    const rinaShift = await openShift(rina.auth, 2000);
    const otherShift = await openShift(other.auth, 300);
    const body = { collectorId: c.staffId, amount: 1000 };

    // The owner has no shift of their own and names none: no drawer.
    const none = await deposit(s.auth, body).expect(422);
    expect(none.body.code).toBe('SHIFT_REQUIRED');
    // The owner receives into Rina's drawer: the audit names the owner as receiver and Rina's shift.
    const ownerKey = randomUUID();
    const ownerBody = { ...body, shiftId: rinaShift.id.toUpperCase() };
    const done = await deposit(s.auth, ownerBody, ownerKey).expect(201);
    // A key answers only the actor who sent it: Rina replaying the owner's key and body is refused.
    const borrowed = await deposit(rina.auth, ownerBody, ownerKey).expect(422);
    expect(borrowed.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await written(s.tenantId)).toEqual(deposits(1));
    expect(done.body).toMatchObject({
      receivedById: s.userId,
      receivedByKind: 'owner',
      receivedByName: 'Pemilik',
      shiftId: rinaShift.id,
      shiftNumber: 2,
      shiftActorName: 'Sari 2',
    });
    expect((await currentShift(rina.auth)).expectedCash).toBe(3000);
    expect((await currentShift(other.auth)).expectedCash).toBe(300);
    const drawer = await get(rina.auth, `/shifts/${rinaShift.id}`).expect(200);
    expect(drawer.body.cashEntries).toMatchObject([
      {
        kind: 'collector_deposit',
        amount: 1000,
        actorKind: 'owner',
        actorName: 'Pemilik',
        collectorName: 'Sari',
      },
    ]);

    const notYours = {
      code: 'SHIFT_NOT_YOURS',
      errors: { shiftId: expect.any(String) },
    };
    // Rina cannot put the cash into a colleague's drawer; her own shift by id is her own.
    const colleague = await deposit(rina.auth, {
      ...body,
      shiftId: otherShift.id,
    }).expect(422);
    expect(colleague.body).toMatchObject(notYours);
    expect(await written(s.tenantId)).toEqual(deposits(1));
    await deposit(rina.auth, { ...body, shiftId: rinaShift.id }).expect(201);
    expect((await currentShift(rina.auth)).expectedCash).toBe(4000);
    // An unknown shift and a closed one are not drawers for the owner either.
    await post(other.auth, '/shifts/current/close', {
      countedCash: 300,
    }).expect(200);
    for (const shiftId of [randomUUID(), otherShift.id]) {
      const res = await deposit(s.auth, { ...body, shiftId }).expect(422);
      expect(res.body).toMatchObject(notYours);
    }
    expect(await written(s.tenantId)).toEqual(deposits(2));
    expect((await storeCash(s.auth)).summary).toMatchObject({
      balance: 8000,
      outstanding: 8000,
      handedOver: 2000,
    });
    // The named shift closes: the owner's retry still answers the first deposit, and writes nothing.
    await post(rina.auth, '/shifts/current/close', {
      countedCash: 4000,
    }).expect(200);
    const late = await deposit(s.auth, ownerBody, ownerKey).expect(201);
    expect(late.body).toEqual(done.body);
    expect(await written(s.tenantId)).toEqual(deposits(2));
  });

  it('“Setoran saya”: a collector reads their own figures and deposits, and nobody else’s', async () => {
    const s = await storeWithKasbon();
    const dedi = await collector(s);
    const tono = await collector(s);
    const receiver = await receiverOf(s);
    await openShift(receiver.auth);
    await s.collect(dedi.auth, 9000);
    await s.collect(tono.auth, 4000);
    const first = await deposit(s.auth, {
      collectorId: dedi.staffId,
      amount: 3500,
      note: 'tagihan Rabu',
    }).expect(201);
    const second = await deposit(receiver.auth, {
      collectorId: dedi.staffId,
      amount: 1800,
    }).expect(201);
    const tonos = await deposit(s.auth, {
      collectorId: tono.staffId,
      amount: 4000,
    }).expect(201);

    // No permission beyond the session: Dedi holds `receivables.manage` only.
    const mine = await get(dedi.auth, '/store-cash/mine').expect(200);
    expect(mine.body).toEqual({
      collectorId: dedi.staffId,
      collected: 9000,
      handedOver: 5300,
      outstanding: 3700,
      data: [
        {
          id: second.body.id,
          amount: 1800,
          note: null,
          receivedByKind: 'cashier',
          receivedByName: 'Sari 3',
          shiftId: second.body.shiftId,
          shiftNumber: 3,
          createdAt: second.body.createdAt,
        },
        {
          id: first.body.id,
          amount: 3500,
          note: 'tagihan Rabu',
          receivedByKind: 'owner',
          receivedByName: 'Pemilik',
          shiftId: s.shiftId,
          shiftNumber: 2,
          createdAt: first.body.createdAt,
        },
      ],
      total: 2,
      page: 1,
      perPage: 20,
    });
    // Nothing of Tono's, and no other staff member's id.
    const text = JSON.stringify(mine.body);
    for (const foreign of [tono.staffId, tonos.body.id, receiver.staffId])
      expect(text).not.toContain(foreign);
    // Paged like the audit list; the figures are of every deposit, not of the page.
    const page2 = await get(
      dedi.auth,
      '/store-cash/mine?page=2&perPage=1',
    ).expect(200);
    expect(page2.body).toMatchObject({
      handedOver: 5300,
      data: [{ id: first.body.id }],
      total: 2,
      page: 2,
      perPage: 1,
    });
    await get(dedi.auth, '/store-cash/mine?page=0').expect(422);
    // The actor is the session's: a collector id in the query changes nothing.
    const spoofed = await get(
      dedi.auth,
      `/store-cash/mine?collectorId=${tono.staffId}`,
    ).expect(200);
    expect(spoofed.body).toEqual(mine.body);

    // Tono sees only his own; someone who never collected (the receiver, the owner) sees zeros.
    const his = await get(tono.auth, '/store-cash/mine').expect(200);
    expect(his.body).toMatchObject({
      collected: 4000,
      handedOver: 4000,
      outstanding: 0,
      data: [{ id: tonos.body.id }],
      total: 1,
    });
    for (const auth of [receiver.auth, s.auth]) {
      const zero = await get(auth, '/store-cash/mine').expect(200);
      expect(zero.body).toMatchObject({
        collected: 0,
        handedOver: 0,
        outstanding: 0,
        data: [],
        total: 0,
      });
    }
    await http().get('/store-cash/mine').expect(401);
    // Read only: the collector still cannot record a deposit.
    await deposit(dedi.auth, { collectorId: tono.staffId, amount: 1 }).expect(
      403,
    );
  });

  it('refuses more than the outstanding, takes exactly the outstanding, and nothing after', async () => {
    const s = await storeWithKasbon();
    const c = await collector(s);
    await s.collect(c.auth, 12_500);

    const over = await deposit(s.auth, {
      collectorId: c.staffId,
      amount: 12_501,
    }).expect(422);
    expect(over.body).toEqual({
      message: 'Jumlah melebihi uang yang belum disetor (Rp12.500)',
      errors: { amount: 'Jumlah melebihi uang yang belum disetor (Rp12.500)' },
      code: 'DEPOSIT_EXCEEDS_OUTSTANDING',
      outstanding: 12_500,
    });
    // Refused after the drawer line was written: it rolled back with the rest.
    expect((await currentShift(s.auth)).expectedCash).toBe(0);
    expect(await written(s.tenantId)).toEqual(deposits(0));

    await deposit(s.auth, { collectorId: c.staffId, amount: 2500 }).expect(201);
    await deposit(s.auth, { collectorId: c.staffId, amount: 10_001 }).expect(
      422,
    );
    const rest = await deposit(s.auth, {
      collectorId: c.staffId,
      amount: 10_000,
    }).expect(201);
    expect(rest.body).toMatchObject({
      outstandingBefore: 10_000,
      outstandingAfter: 0,
    });
    const none = await deposit(s.auth, {
      collectorId: c.staffId,
      amount: 1,
    }).expect(422);
    expect(none.body).toEqual({
      message: 'Tidak ada uang yang belum disetor oleh staf ini',
      errors: { amount: 'Tidak ada uang yang belum disetor oleh staf ini' },
      code: 'NOTHING_OUTSTANDING',
      outstanding: 0,
    });
    expect(await written(s.tenantId)).toEqual(deposits(2));
    expect((await storeCash(s.auth)).summary).toMatchObject({
      cashIn: 12_500,
      cashOut: 12_500,
      balance: 0,
      outstanding: 0,
      handedOver: 12_500,
    });
    expect((await currentShift(s.auth)).expectedCash).toBe(12_500);

    // A new collection is outstanding again.
    await s.collect(c.auth, 700);
    await deposit(s.auth, { collectorId: c.staffId, amount: 701 }).expect(422);
    await deposit(s.auth, { collectorId: c.staffId, amount: 700 }).expect(201);
  });

  it('two concurrent deposits cannot together hand over more than the outstanding', async () => {
    const s = await storeWithKasbon();
    const c = await collector(s);
    await s.collect(c.auth, 15_000);
    const [a, b] = await holdingStaff(c.staffId, async () => {
      const first = send(
        deposit(s.auth, { collectorId: c.staffId, amount: 10_000 }),
      );
      const second = send(
        deposit(s.auth, { collectorId: c.staffId, amount: 10_000 }),
      );
      await untilWaiting(2);
      return [first, second];
    }).then((pending) => Promise.all(pending));
    expect([a.status, b.status].sort()).toEqual([201, 422]);
    expect(await written(s.tenantId)).toEqual(deposits(1));
    expect((await storeCash(s.auth)).collectors).toMatchObject([
      { collected: 15_000, handedOver: 10_000, outstanding: 5000 },
    ]);
    // One of the two reached the drawer.
    expect((await currentShift(s.auth)).expectedCash).toBe(10_000);
    expect((await storeCash(s.auth)).summary.balance).toBe(5000);
  });

  it('needs store_cash.manage, and the receiver is never the collector', async () => {
    const s = await storeWithKasbon();
    const c = await collector(s);
    await s.collect(c.auth, 9000);
    const body = { collectorId: c.staffId, amount: 1000 };

    // Neither the collector, nor a report reader, nor a seller may record a handover.
    const reader = await createCashier(app, s, ['reports.view']);
    const seller = await createCashier(app, s, ['sales.create']);
    for (const auth of [c.auth, reader.auth, seller.auth]) {
      await deposit(auth, body).expect(403);
      await get(auth, '/store-cash/collectors').expect(403);
    }
    await http()
      .post('/store-cash/deposits')
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(401);
    expect(await written(s.tenantId)).toEqual(deposits(0));

    // `store_cash.manage` alone reaches everything the deposit form shows (collectors, history), but has
    // no drawer: it cannot open a shift, so it cannot receive.
    const formOnly = await createCashier(app, s, ['store_cash.manage']);
    await get(formOnly.auth, '/store-cash/collectors').expect(200);
    await get(formOnly.auth, '/store-cash/deposits').expect(200);
    await get(formOnly.auth, '/store-cash').expect(403);
    const noDrawer = await deposit(formOnly.auth, body).expect(422);
    expect(noDrawer.body.code).toBe('SHIFT_REQUIRED');
    // A report reader sees the history too; a seller and a collector see neither.
    await get(reader.auth, '/store-cash/deposits').expect(200);
    for (const auth of [c.auth, seller.auth])
      await get(auth, '/store-cash/deposits').expect(403);
    await http().get('/store-cash/deposits').expect(401);
    expect(await written(s.tenantId)).toEqual(deposits(0));

    // A receiver: may open a shift and holds the permission; sees the collectors, not the store's reports.
    const receiver = await receiverOf(s);
    const receiverShift = await openShift(receiver.auth, 500);
    const list = await get(receiver.auth, '/store-cash/collectors').expect(200);
    expect(list.body).toEqual({
      data: [
        {
          collectorId: c.staffId,
          collectorKind: 'cashier',
          collectorName: 'Sari',
          collected: 9000,
          handedOver: 0,
          outstanding: 9000,
          active: true,
        },
      ],
    });
    const done = await deposit(receiver.auth, body).expect(201);
    expect(done.body).toMatchObject({
      collectorId: c.staffId,
      receivedById: receiver.staffId,
      receivedByKind: 'cashier',
      receivedByName: 'Sari 5',
      outstandingAfter: 8000,
      // Into the receiver's own drawer, not the owner's (whose shift is open too).
      shiftId: receiverShift.id,
      shiftNumber: 3,
      shiftActorName: 'Sari 5',
    });
    expect((await currentShift(receiver.auth)).expectedCash).toBe(1500);
    expect((await currentShift(s.auth)).expectedCash).toBe(0);
    await get(receiver.auth, '/store-cash').expect(403);
    const history = await get(receiver.auth, '/store-cash/deposits').expect(
      200,
    );
    expect(history.body.data).toEqual([done.body]);
    // The receiver reads their own shift's drawer list, with who handed over.
    const own = await get(receiver.auth, `/shifts/${receiverShift.id}`).expect(
      200,
    );
    expect(own.body.cashEntries).toMatchObject([
      {
        kind: 'collector_deposit',
        amount: 1000,
        actorId: receiver.staffId,
        actorKind: 'cashier',
        actorName: 'Sari 5',
        collectorId: c.staffId,
        collectorName: 'Sari',
      },
    ]);

    // A collector who also holds the permission cannot receive their own cash; someone else can.
    const both = await createCashier(app, s, [
      'receivables.manage',
      'store_cash.manage',
    ]);
    await s.collect(both.auth, 2000);
    const self = await deposit(both.auth, {
      collectorId: both.staffId,
      amount: 2000,
    }).expect(422);
    expect(Object.keys(self.body.errors)).toEqual(['collectorId']);
    expect(self.body.code).toBe('SELF_DEPOSIT');
    // The same id in upper case is the same person: still refused.
    const upper = await deposit(both.auth, {
      collectorId: both.staffId.toUpperCase(),
      amount: 2000,
    }).expect(422);
    expect(Object.keys(upper.body.errors)).toEqual(['collectorId']);
    expect(upper.body.code).toBe('SELF_DEPOSIT');
    expect(await written(s.tenantId)).toEqual(deposits(1));
    await deposit(s.auth, { collectorId: both.staffId, amount: 2000 }).expect(
      201,
    );
    // A colleague's cash they could receive only into a drawer, and a collector has none.
    const colleague = await deposit(both.auth, {
      collectorId: c.staffId,
      amount: 8000,
    }).expect(422);
    expect(colleague.body.code).toBe('SHIFT_REQUIRED');
    expect(await written(s.tenantId)).toEqual(deposits(2));
  });

  it('is idempotent: a replay returns the first deposit; another body with the key is refused', async () => {
    const s = await storeWithKasbon();
    const c = await collector(s);
    await s.collect(c.auth, 10_000);
    const key = randomUUID();
    const body = { collectorId: c.staffId, amount: 6000 };
    const first = await deposit(s.auth, body, key).expect(201);
    // 6.000 twice would exceed the outstanding: the replay is recognised, not judged again.
    const again = await deposit(s.auth, body, key).expect(201);
    expect(again.body).toEqual(first.body);
    expect(await written(s.tenantId)).toEqual(deposits(1));

    for (const other of [
      { ...body, amount: 4000 },
      { ...body, note: 'lain' },
    ]) {
      const res = await deposit(s.auth, other, key).expect(422);
      expect(res.body.errors).toEqual({
        idempotencyKey: 'Kunci ini sudah dipakai untuk setoran lain',
      });
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    }
    // Naming the shift is another request too, also when it is the shift the first one used.
    const named = await deposit(
      s.auth,
      { ...body, shiftId: s.shiftId },
      key,
    ).expect(422);
    expect(named.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await written(s.tenantId)).toEqual(deposits(1));
    expect((await storeCash(s.auth)).summary).toMatchObject({
      outstanding: 4000,
      handedOver: 6000,
    });

    // Two requests in flight with one key: one deposit, both answer it.
    const key2 = randomUUID();
    const rest = { collectorId: c.staffId, amount: 3000 };
    const [a, b] = await holdingStaff(c.staffId, async () => {
      const one = send(deposit(s.auth, rest, key2));
      const two = send(deposit(s.auth, rest, key2));
      await untilWaiting(2);
      return [one, two];
    }).then((pending) => Promise.all(pending));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body).toEqual(a.body);
    expect(await written(s.tenantId)).toEqual(deposits(2));
    expect((await storeCash(s.auth)).summary).toMatchObject({
      outstanding: 1000,
      balance: 1000,
    });
    expect((await currentShift(s.auth)).expectedCash).toBe(9000);

    // A replay after the shift closed still answers the first deposit and writes nothing.
    await post(s.auth, '/shifts/current/close', { countedCash: 9000 }).expect(
      200,
    );
    const late = await deposit(s.auth, body, key).expect(201);
    expect(late.body).toEqual(first.body);
    expect(await written(s.tenantId)).toEqual(deposits(2));
  });

  it('refuses bad input with 422 and writes nothing', async () => {
    const s = await storeWithKasbon();
    const c = await collector(s);
    await s.collect(c.auth, 10_000);
    const ok = { collectorId: c.staffId, amount: 1000 };
    const bad: [unknown, string][] = [
      [{ ...ok, amount: 0 }, 'amount'],
      [{ ...ok, amount: -1 }, 'amount'],
      [{ ...ok, amount: 10.5 }, 'amount'],
      [{ ...ok, amount: '1000' }, 'amount'],
      [{ collectorId: c.staffId }, 'amount'],
      [{ ...ok, collectorId: 'sari' }, 'collectorId'],
      [{ amount: 1000 }, 'collectorId'],
      [{ ...ok, note: 'x'.repeat(201) }, 'note'],
      [{ ...ok, tenantId: randomUUID() }, 'tenantId'],
      [{ ...ok, receivedById: randomUUID() }, 'receivedById'],
      [{ ...ok, shiftId: 'laci' }, 'shiftId'],
    ];
    for (const [body, field] of bad) {
      const res = await deposit(s.auth, body);
      expect([JSON.stringify(body), res.status]).toEqual([
        JSON.stringify(body),
        422,
      ]);
      expect(Object.keys(res.body.errors)).toEqual([field]);
    }
    const noKey = await post(s.auth, '/store-cash/deposits', ok).expect(422);
    expect(Object.keys(noKey.body.errors)).toEqual(['idempotencyKey']);
    await deposit(s.auth, ok, 'short').expect(422);
    expect(await written(s.tenantId)).toEqual(deposits(0));

    // An unknown staff id is 404; a staff member who collected nothing has nothing to hand over.
    await deposit(s.auth, { ...ok, collectorId: randomUUID() }).expect(404);
    const idle = await createCashier(app, s, ['sales.create']);
    const nothing = await deposit(s.auth, {
      ...ok,
      collectorId: idle.staffId,
    }).expect(422);
    expect(Object.keys(nothing.body.errors)).toEqual(['amount']);
    expect(nothing.body.code).toBe('NOTHING_OUTSTANDING');
    expect(await written(s.tenantId)).toEqual(deposits(0));
  });

  it('cross-tenant: store B cannot hand over, see or lower store A’s outstanding', async () => {
    const a = await storeWithKasbon();
    const b = await storeWithKasbon();
    const ca = await collector(a);
    const cb = await collector(b);
    await a.collect(ca.auth, 8000);
    await b.collect(cb.auth, 300);

    // B's owner and B's receiver name A's collector: 404, with or without a fitting amount.
    const bReceiver = await receiverOf(b);
    await openShift(bReceiver.auth);
    for (const auth of [b.auth, bReceiver.auth]) {
      await deposit(auth, { collectorId: ca.staffId, amount: 100 }).expect(404);
      await deposit(auth, { collectorId: ca.staffId, amount: 8000 }).expect(
        404,
      );
    }
    expect(await written(a.tenantId)).toEqual(deposits(0));
    expect(await written(b.tenantId)).toEqual(deposits(0));

    // A deposit in A, with a key B then replays: B gets its own refusal, never A's deposit.
    const key = randomUUID();
    const mine = await deposit(
      a.auth,
      { collectorId: ca.staffId, amount: 5000 },
      key,
    ).expect(201);
    await deposit(
      b.auth,
      { collectorId: ca.staffId, amount: 5000 },
      key,
    ).expect(404);
    const theirs = await deposit(
      b.auth,
      { collectorId: cb.staffId, amount: 300 },
      key,
    ).expect(201);
    expect(theirs.body.id).not.toBe(mine.body.id);
    expect(theirs.body.shiftId).toBe(b.shiftId);

    // B's owner names A's open shift as the drawer: not a shift of B's store. Nothing is written, and
    // A's drawer does not move.
    await b.collect(cb.auth, 200);
    const foreign = await deposit(b.auth, {
      collectorId: cb.staffId,
      amount: 200,
      shiftId: a.shiftId,
    }).expect(422);
    expect(foreign.body).toMatchObject({
      code: 'SHIFT_NOT_YOURS',
      errors: { shiftId: 'Shift ini sudah ditutup atau tidak ditemukan' },
    });
    expect(await written(b.tenantId)).toEqual(deposits(1));
    expect((await currentShift(a.auth)).expectedCash).toBe(5000);
    await get(b.auth, `/shifts/${a.shiftId}`).expect(404);

    // Each store sees only its own collectors, deposits and ledger.
    const cashA = await storeCash(a.auth);
    const cashB = await storeCash(b.auth);
    expect(cashA.collectors).toMatchObject([
      { collectorId: ca.staffId, collected: 8000, outstanding: 3000 },
    ]);
    expect(cashB.collectors).toMatchObject([
      { collectorId: cb.staffId, collected: 500, outstanding: 200 },
    ]);
    expect(cashA.summary).toMatchObject({ balance: 3000, handedOver: 5000 });
    expect(cashB.summary).toMatchObject({ balance: 200, handedOver: 300 });
    const forB = [
      cashB,
      (await get(b.auth, '/store-cash/deposits').expect(200)).body,
      (await get(bReceiver.auth, '/store-cash/collectors').expect(200)).body,
      (await get(bReceiver.auth, '/store-cash/deposits').expect(200)).body,
      (await get(cb.auth, '/store-cash/mine').expect(200)).body,
      (await get(b.auth, '/store-cash/mine').expect(200)).body,
    ];
    for (const body of forB) {
      expect(JSON.stringify(body)).not.toContain(ca.staffId);
      expect(JSON.stringify(body)).not.toContain(mine.body.id);
    }
    const depositsA = await get(a.auth, '/store-cash/deposits').expect(200);
    expect(depositsA.body.data).toMatchObject([{ id: mine.body.id }]);
    expect(depositsA.body.total).toBe(1);
  });

  it('lists every collector with collected, handed over and outstanding, most outstanding first', async () => {
    const s = await storeWithKasbon();
    const one = await collector(s);
    const two = await collector(s);
    await s.collect(one.auth, 4000);
    await s.collect(two.auth, 9000);
    await s.collect(one.auth, 1000);
    await deposit(s.auth, { collectorId: two.staffId, amount: 8500 }).expect(
      201,
    );
    // A staff member who never collected is not listed; a deposit names one collector only.
    await createCashier(app, s, ['sales.create']);
    const cash = await storeCash(s.auth);
    expect(cash.collectors).toEqual([
      {
        collectorId: one.staffId,
        collectorKind: 'cashier',
        collectorName: 'Sari',
        collected: 5000,
        handedOver: 0,
        outstanding: 5000,
        active: true,
      },
      {
        collectorId: two.staffId,
        collectorKind: 'cashier',
        collectorName: 'Sari 2',
        collected: 9000,
        handedOver: 8500,
        outstanding: 500,
        active: true,
      },
    ]);
    expect(cash.summary).toEqual({
      cashIn: 14_000,
      cashOut: 8500,
      balance: 5500,
      outstanding: 5500,
      handedOver: 8500,
    });

    // A removed collector keeps their outstanding and can still hand it over.
    await http()
      .delete(`/staff/${one.staffId}`)
      .set('Authorization', s.auth)
      .expect(204);
    expect((await storeCash(s.auth)).summary.outstanding).toBe(5500);
    // No longer on the staff list: the form's "Diserahkan oleh" can leave them out.
    expect((await storeCash(s.auth)).collectors).toMatchObject([
      { collectorId: one.staffId, active: false },
      { collectorId: two.staffId, active: true },
    ]);
    await deposit(s.auth, { collectorId: one.staffId, amount: 5000 }).expect(
      201,
    );
    expect((await storeCash(s.auth)).summary.outstanding).toBe(500);
  });
});
