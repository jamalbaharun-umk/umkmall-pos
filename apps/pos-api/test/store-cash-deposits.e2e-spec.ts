import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

describe('store cash handover: a collector’s outside-shift cash into the safe (UMK-1924 U3)', () => {
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
    const [r] = await admin<{ deposits: number; transfers: number }[]>`
      select (select count(*)::int from pos.store_cash_deposits where tenant_id = ${tenantId}) as deposits,
             (select count(*)::int from pos.store_cash_entries
               where tenant_id = ${tenantId} and direction = 'transfer') as transfers`;
    return r;
  };

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
   * `collect(auth, amount)`: a cash instalment taken with that session.
   */
  async function storeWithKasbon() {
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
    return { ...s, rid, collect };
  }
  /** `receivables.manage` only: may not sell, so collects outside every shift. */
  const collector = (s: Awaited<ReturnType<typeof createStore>>) =>
    createCashier(app, s, ['receivables.manage']);

  it('a deposit lowers the collector’s outstanding, is audited, and leaves the store’s balance alone', async () => {
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
      },
    ]);

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
      createdAt: expect.any(String),
    });
    expect(Date.parse(done.body.createdAt)).toBeGreaterThan(started - 5000);

    const after = await storeCash(s.auth);
    // The money was already the store's: only who holds it changed.
    expect(after.summary).toEqual({
      cashIn: 15_000,
      cashOut: 0,
      balance: 15_000,
      outstanding: 9000,
      handedOver: 6000,
    });
    expect(after.collectors).toEqual([
      {
        collectorId: c.staffId,
        collectorKind: 'cashier',
        collectorName: 'Sari',
        collected: 15_000,
        handedOver: 6000,
        outstanding: 9000,
      },
    ]);
    // The ledger has the handover as a transfer by the receiver, with the deposit as its source.
    expect(after.total).toBe(3);
    expect(after.data[0]).toEqual({
      id: expect.any(String),
      direction: 'transfer',
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
  });

  it('refuses more than the outstanding, takes exactly the outstanding, and nothing after', async () => {
    const s = await storeWithKasbon();
    const c = await collector(s);
    await s.collect(c.auth, 12_500);

    const over = await deposit(s.auth, {
      collectorId: c.staffId,
      amount: 12_501,
    }).expect(422);
    expect(over.body.errors).toEqual({
      amount: 'Jumlah melebihi uang yang belum disetor (Rp12.500)',
    });
    expect(await written(s.tenantId)).toEqual({ deposits: 0, transfers: 0 });

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
    expect(none.body.errors).toEqual({
      amount: 'Tidak ada uang yang belum disetor oleh staf ini',
    });
    expect(await written(s.tenantId)).toEqual({ deposits: 2, transfers: 2 });
    expect((await storeCash(s.auth)).summary).toMatchObject({
      balance: 12_500,
      outstanding: 0,
      handedOver: 12_500,
    });

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
    expect(await written(s.tenantId)).toEqual({ deposits: 1, transfers: 1 });
    expect((await storeCash(s.auth)).collectors).toMatchObject([
      { collected: 15_000, handedOver: 10_000, outstanding: 5000 },
    ]);
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
    expect(await written(s.tenantId)).toEqual({ deposits: 0, transfers: 0 });

    // A receiver with the permission alone: records and sees the collectors, not the store's reports.
    const receiver = await createCashier(app, s, ['store_cash.manage']);
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
        },
      ],
    });
    const done = await deposit(receiver.auth, body).expect(201);
    expect(done.body).toMatchObject({
      collectorId: c.staffId,
      receivedById: receiver.staffId,
      receivedByKind: 'cashier',
      receivedByName: 'Sari 4',
      outstandingAfter: 8000,
    });
    await get(receiver.auth, '/store-cash').expect(403);
    await get(receiver.auth, '/store-cash/deposits').expect(403);

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
    // The same id in upper case is the same person: still refused.
    const upper = await deposit(both.auth, {
      collectorId: both.staffId.toUpperCase(),
      amount: 2000,
    }).expect(422);
    expect(Object.keys(upper.body.errors)).toEqual(['collectorId']);
    expect(await written(s.tenantId)).toEqual({ deposits: 1, transfers: 1 });
    await deposit(s.auth, { collectorId: both.staffId, amount: 2000 }).expect(
      201,
    );
    // And they may receive a colleague's.
    await deposit(both.auth, { collectorId: c.staffId, amount: 8000 }).expect(
      201,
    );
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
    expect(await written(s.tenantId)).toEqual({ deposits: 1, transfers: 1 });

    for (const other of [
      { ...body, amount: 4000 },
      { ...body, note: 'lain' },
    ]) {
      const res = await deposit(s.auth, other, key).expect(422);
      expect(res.body.errors).toEqual({
        idempotencyKey: 'Kunci ini sudah dipakai untuk setoran lain',
      });
    }
    expect(await written(s.tenantId)).toEqual({ deposits: 1, transfers: 1 });
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
    expect(await written(s.tenantId)).toEqual({ deposits: 2, transfers: 2 });
    expect((await storeCash(s.auth)).summary).toMatchObject({
      outstanding: 1000,
    });
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
    expect(await written(s.tenantId)).toEqual({ deposits: 0, transfers: 0 });

    // An unknown staff id is 404; a staff member who collected nothing has nothing to hand over.
    await deposit(s.auth, { ...ok, collectorId: randomUUID() }).expect(404);
    const idle = await createCashier(app, s, ['sales.create']);
    const nothing = await deposit(s.auth, {
      ...ok,
      collectorId: idle.staffId,
    }).expect(422);
    expect(Object.keys(nothing.body.errors)).toEqual(['amount']);
    expect(await written(s.tenantId)).toEqual({ deposits: 0, transfers: 0 });
  });

  it('cross-tenant: store B cannot hand over, see or lower store A’s outstanding', async () => {
    const a = await storeWithKasbon();
    const b = await storeWithKasbon();
    const ca = await collector(a);
    const cb = await collector(b);
    await a.collect(ca.auth, 8000);
    await b.collect(cb.auth, 300);

    // B's owner and B's receiver name A's collector: 404, with or without a fitting amount.
    const bReceiver = await createCashier(app, b, ['store_cash.manage']);
    for (const auth of [b.auth, bReceiver.auth]) {
      await deposit(auth, { collectorId: ca.staffId, amount: 100 }).expect(404);
      await deposit(auth, { collectorId: ca.staffId, amount: 8000 }).expect(
        404,
      );
    }
    expect(await written(a.tenantId)).toEqual({ deposits: 0, transfers: 0 });
    expect(await written(b.tenantId)).toEqual({ deposits: 0, transfers: 0 });

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

    // Each store sees only its own collectors, deposits and ledger.
    const cashA = await storeCash(a.auth);
    const cashB = await storeCash(b.auth);
    expect(cashA.collectors).toMatchObject([
      { collectorId: ca.staffId, collected: 8000, outstanding: 3000 },
    ]);
    expect(cashB.collectors).toMatchObject([
      { collectorId: cb.staffId, collected: 300, outstanding: 0 },
    ]);
    expect(cashA.summary).toMatchObject({ balance: 8000, handedOver: 5000 });
    expect(cashB.summary).toMatchObject({ balance: 300, handedOver: 300 });
    const forB = [
      cashB,
      (await get(b.auth, '/store-cash/deposits').expect(200)).body,
      (await get(bReceiver.auth, '/store-cash/collectors').expect(200)).body,
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
      },
      {
        collectorId: two.staffId,
        collectorKind: 'cashier',
        collectorName: 'Sari 2',
        collected: 9000,
        handedOver: 8500,
        outstanding: 500,
      },
    ]);
    expect(cash.summary).toEqual({
      cashIn: 14_000,
      cashOut: 0,
      balance: 14_000,
      outstanding: 5500,
      handedOver: 8500,
    });

    // A removed collector keeps their outstanding and can still hand it over.
    await http()
      .delete(`/staff/${one.staffId}`)
      .set('Authorization', s.auth)
      .expect(204);
    expect((await storeCash(s.auth)).summary.outstanding).toBe(5500);
    await deposit(s.auth, { collectorId: one.staffId, amount: 5000 }).expect(
      201,
    );
    expect((await storeCash(s.auth)).summary.outstanding).toBe(500);
  });
});
