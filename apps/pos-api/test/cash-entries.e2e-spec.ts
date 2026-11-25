import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

describe('manual drawer cash in/out (UMK-1924 U3)', () => {
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
  const open = (auth: string, openingCash = 100_000) =>
    post(auth, '/shifts/open', { openingCash }).expect(201);
  const close = (auth: string, countedCash: number) =>
    post(auth, '/shifts/current/close', { countedCash });
  const current = async (auth: string) =>
    (await get(auth, '/shifts/current').expect(200)).body.shift as Record<
      string,
      unknown
    >;
  const entry = (auth: string, body: unknown, key: string = randomUUID()) =>
    http()
      .post('/shifts/current/cash-entries')
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body as object);
  const cashIn = (amount: number, extra: object = {}) => ({
    direction: 'in',
    amount,
    reason: 'tambah_modal',
    ...extra,
  });
  const cashOut = (amount: number, extra: object = {}) => ({
    direction: 'out',
    amount,
    reason: 'setor_bank',
    ...extra,
  });

  /** Row counts of the two tables a manual entry writes, read as the database owner. */
  const written = async (tenantId: string) => {
    const [r] = await admin<{ manual: number; ledger: number }[]>`
      select (select count(*)::int from pos.manual_cash_entries where tenant_id = ${tenantId}) as manual,
             (select count(*)::int from pos.shift_cash_entries where tenant_id = ${tenantId}) as ledger`;
    return r;
  };

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
  /** Sends the request now (supertest sends on `then`) and returns its pending response. */
  const send = (req: request.Test) => req.then((res) => res);
  /** Holds one shift's row lock while `during` starts requests and waits until they queue behind it. */
  const holdingShift = <T>(id: string, during: () => Promise<T>) =>
    locker.begin(async (sql) => {
      await sql`select id from pos.shifts where id = ${id} for update`;
      return during();
    }) as Promise<T>;

  it('lists the reasons per direction', async () => {
    const s = await createStore();
    const res = await get(s.auth, '/shifts/cash-entry-reasons').expect(200);
    expect(res.body).toEqual({
      in: [
        {
          reason: 'tambah_modal',
          label: 'Tambah modal laci',
          noteRequired: false,
        },
        { reason: 'lainnya', label: 'Lainnya', noteRequired: true },
      ],
      out: [
        { reason: 'setor_bank', label: 'Setor ke bank', noteRequired: false },
        {
          reason: 'ambil_pemilik',
          label: 'Diambil pemilik',
          noteRequired: false,
        },
        { reason: 'lainnya', label: 'Lainnya', noteRequired: true },
      ],
    });
  });

  it('cash in and cash out move the open shift, live, in its detail and at close', async () => {
    const s = await createStore();
    const shift = await open(s.auth);
    const shiftId = shift.body.id as string;

    const added = await entry(s.auth, cashIn(50_000)).expect(201);
    expect(added.body).toEqual({
      id: expect.any(String),
      shiftId,
      direction: 'in',
      reason: 'tambah_modal',
      reasonLabel: 'Tambah modal laci',
      amount: 50_000,
      note: null,
      drawerCashBefore: 100_000,
      drawerCashAfter: 150_000,
      actorId: s.userId,
      actorKind: 'owner',
      actorName: 'Pemilik',
      createdAt: expect.any(String),
    });
    expect(await current(s.auth)).toMatchObject({
      expectedCash: 150_000,
      cashIn: 50_000,
      cashOut: 0,
      manualIn: 50_000,
      manualOut: 0,
    });

    const taken = await entry(
      s.auth,
      cashOut(30_000, { note: '  BCA siang  ' }),
    ).expect(201);
    expect(taken.body).toMatchObject({
      direction: 'out',
      reason: 'setor_bank',
      reasonLabel: 'Setor ke bank',
      amount: 30_000,
      note: 'BCA siang',
      drawerCashBefore: 150_000,
      drawerCashAfter: 120_000,
    });
    expect(await current(s.auth)).toMatchObject({
      expectedCash: 120_000,
      cashIn: 50_000,
      cashOut: 30_000,
      manualIn: 50_000,
      manualOut: 30_000,
    });

    const detail = await get(s.auth, `/shifts/${shiftId}`).expect(200);
    expect(detail.body).toMatchObject({ manualIn: 50_000, manualOut: 30_000 });
    expect(detail.body.cashEntries).toEqual([
      {
        id: expect.any(String),
        direction: 'in',
        kind: 'manual_in',
        amount: 50_000,
        refId: added.body.id,
        note: null,
        reason: 'tambah_modal',
        reasonLabel: 'Tambah modal laci',
        createdAt: expect.any(String),
      },
      {
        id: expect.any(String),
        direction: 'out',
        kind: 'manual_out',
        amount: 30_000,
        refId: taken.body.id,
        note: 'BCA siang',
        reason: 'setor_bank',
        reasonLabel: 'Setor ke bank',
        createdAt: expect.any(String),
      },
    ]);

    const closed = await close(s.auth, 119_000).expect(200);
    expect(closed.body).toMatchObject({
      expectedCash: 120_000,
      countedCash: 119_000,
      difference: -1000,
      cashIn: 50_000,
      cashOut: 30_000,
      manualIn: 50_000,
      manualOut: 30_000,
    });
    const list = await get(s.auth, '/shifts').expect(200);
    expect(list.body.data[0]).toMatchObject({
      id: shiftId,
      manualIn: 50_000,
      manualOut: 30_000,
    });
    // The shift report row carries the same two figures.
    const day = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const report = await get(
      s.auth,
      `/reports/shifts?from=${day}&to=${day}`,
    ).expect(200);
    expect(report.body.rows[0]).toMatchObject({
      shiftId,
      manualIn: 50_000,
      manualOut: 30_000,
      cashIn: 50_000,
      cashOut: 30_000,
    });
  });

  it('needs an open shift (422, nothing written, the key is not claimed) and sales.create (403)', async () => {
    const s = await createStore();
    const key = randomUUID();
    const refused = await entry(s.auth, cashIn(10_000), key).expect(422);
    expect(refused.body.message).toBe(
      'Buka shift dulu untuk mencatat kas masuk atau keluar',
    );
    await entry(s.auth, cashOut(1), randomUUID()).expect(422);
    expect(await written(s.tenantId)).toEqual({ manual: 0, ledger: 0 });

    // The refused key was not claimed: it works once a shift is open.
    await open(s.auth);
    await entry(s.auth, cashIn(10_000), key).expect(201);
    expect(await written(s.tenantId)).toEqual({ manual: 1, ledger: 1 });

    // A staff member who may not sell may not move drawer cash (nor read the reasons).
    const collector = await createCashier(app, s, [
      'receivables.manage',
      'reports.view',
      'expenses.manage',
    ]);
    await entry(collector.auth, cashIn(1000)).expect(403);
    await entry(collector.auth, cashOut(1000)).expect(403);
    await get(collector.auth, '/shifts/cash-entry-reasons').expect(403);
    await http()
      .post('/shifts/current/cash-entries')
      .set('Idempotency-Key', randomUUID())
      .send(cashIn(1000))
      .expect(401);
    expect(await written(s.tenantId)).toEqual({ manual: 1, ledger: 1 });
  });

  it('refuses a cash-out above the drawer and lets exactly the drawer out', async () => {
    const s = await createStore();
    await open(s.auth, 100_000);
    await entry(s.auth, cashIn(500)).expect(201); // drawer: Rp100.500

    const over = await entry(s.auth, cashOut(100_501)).expect(422);
    expect(over.body.errors).toEqual({
      amount: 'Jumlah lebih besar dari uang di laci (Rp100.500)',
    });
    expect(await written(s.tenantId)).toEqual({ manual: 1, ledger: 1 });
    expect(await current(s.auth)).toMatchObject({
      expectedCash: 100_500,
      cashOut: 0,
    });

    const all = await entry(
      s.auth,
      cashOut(100_500, { reason: 'ambil_pemilik' }),
    ).expect(201);
    expect(all.body).toMatchObject({
      drawerCashBefore: 100_500,
      drawerCashAfter: 0,
    });
    // An empty drawer gives nothing.
    await entry(s.auth, cashOut(1)).expect(422);
    expect(await current(s.auth)).toMatchObject({
      expectedCash: 0,
      manualOut: 100_500,
    });
  });

  it('two concurrent cash-outs cannot together overdraw the drawer', async () => {
    const s = await createStore();
    const shift = await open(s.auth, 100_000);
    const [a, b] = await holdingShift(shift.body.id as string, async () => {
      const first = send(entry(s.auth, cashOut(60_000)));
      const second = send(entry(s.auth, cashOut(60_000)));
      await untilWaiting(2);
      return [first, second];
    }).then((pending) => Promise.all(pending));
    expect([a.status, b.status].sort()).toEqual([201, 422]);
    expect(await current(s.auth)).toMatchObject({
      expectedCash: 40_000,
      manualOut: 60_000,
    });
    expect(await written(s.tenantId)).toEqual({ manual: 1, ledger: 1 });
  });

  it('refuses bad input with 422 and writes nothing', async () => {
    const s = await createStore();
    await open(s.auth);
    const bad: [unknown, string][] = [
      [cashIn(0), 'amount'],
      [cashIn(-5), 'amount'],
      [cashIn(10.5), 'amount'],
      [{ ...cashIn(1), amount: '1000' }, 'amount'],
      [{ direction: 'in', reason: 'tambah_modal' }, 'amount'],
      [cashIn(1_000_000_000_001), 'amount'],
      [{ ...cashIn(1000), direction: 'sideways' }, 'direction'],
      [{ amount: 1000, reason: 'tambah_modal' }, 'direction'],
      [{ ...cashIn(1000), reason: 'iseng' }, 'reason'],
      [{ direction: 'in', amount: 1000 }, 'reason'],
      // A reason of the other direction.
      [cashIn(1000, { reason: 'setor_bank' }), 'reason'],
      [cashOut(1000, { reason: 'tambah_modal' }), 'reason'],
      // "Lainnya" needs a note; blanks are no note.
      [cashIn(1000, { reason: 'lainnya' }), 'note'],
      [cashOut(1000, { reason: 'lainnya', note: '   ' }), 'note'],
      [cashIn(1000, { note: 'x'.repeat(201) }), 'note'],
      [cashIn(1000, { note: 5 }), 'note'],
      [cashIn(1000, { tenantId: randomUUID() }), 'tenantId'],
      [cashIn(1000, { shiftId: randomUUID() }), 'shiftId'],
    ];
    for (const [body, field] of bad) {
      const res = await entry(s.auth, body);
      expect([JSON.stringify(body), res.status]).toEqual([
        JSON.stringify(body),
        422,
      ]);
      expect(Object.keys(res.body.errors)).toEqual([field]);
    }
    // The key: required, and well-formed.
    const noKey = await post(
      s.auth,
      '/shifts/current/cash-entries',
      cashIn(1000),
    ).expect(422);
    expect(Object.keys(noKey.body.errors)).toEqual(['idempotencyKey']);
    await entry(s.auth, cashIn(1000), 'short').expect(422);
    await entry(s.auth, cashIn(1000), 'has spaces in the key').expect(422);
    expect(await written(s.tenantId)).toEqual({ manual: 0, ledger: 0 });

    // "Lainnya" with a note is accepted.
    const other = await entry(
      s.auth,
      cashOut(1000, { reason: 'lainnya', note: 'tukar receh' }),
    ).expect(201);
    expect(other.body).toMatchObject({
      reason: 'lainnya',
      reasonLabel: 'Lainnya',
      note: 'tukar receh',
    });
  });

  it('is idempotent: a replay returns the first entry, also after the close; another body is refused', async () => {
    const s = await createStore();
    await open(s.auth);
    const key = randomUUID();
    const first = await entry(s.auth, cashOut(25_000), key).expect(201);
    const again = await entry(s.auth, cashOut(25_000), key).expect(201);
    expect(again.body).toEqual(first.body);
    expect(await written(s.tenantId)).toEqual({ manual: 1, ledger: 1 });
    expect(await current(s.auth)).toMatchObject({
      expectedCash: 75_000,
      manualOut: 25_000,
    });

    // The same key for another movement is refused, and nothing moves.
    for (const other of [
      cashOut(25_001),
      cashIn(25_000),
      cashOut(25_000, { reason: 'ambil_pemilik' }),
      cashOut(25_000, { note: 'lain' }),
    ]) {
      const res = await entry(s.auth, other, key).expect(422);
      expect(res.body.errors).toEqual({
        idempotencyKey: 'Kunci ini sudah dipakai untuk catatan kas lain',
      });
    }
    expect(await written(s.tenantId)).toEqual({ manual: 1, ledger: 1 });

    // After the close the replay still answers the first entry and the closed shift is unchanged.
    const closed = await close(s.auth, 75_000).expect(200);
    const late = await entry(s.auth, cashOut(25_000), key).expect(201);
    expect(late.body).toEqual(first.body);
    const detail = await get(s.auth, `/shifts/${closed.body.id}`).expect(200);
    expect(detail.body).toMatchObject({
      expectedCash: 75_000,
      manualOut: 25_000,
    });
    expect(detail.body.cashEntries).toHaveLength(1);
    // A new shift does not get it either.
    await open(s.auth, 10_000);
    await entry(s.auth, cashOut(25_000), key).expect(201);
    expect(await current(s.auth)).toMatchObject({
      expectedCash: 10_000,
      manualOut: 0,
    });
    expect(await written(s.tenantId)).toEqual({ manual: 1, ledger: 1 });
  });

  it('two concurrent requests with one key write one entry and both answer it', async () => {
    const s = await createStore();
    const shift = await open(s.auth, 100_000);
    const key = randomUUID();
    // 60.000 twice would overdraw: the duplicate must be recognised, not judged as a second cash-out.
    const [a, b] = await holdingShift(shift.body.id as string, async () => {
      const first = send(entry(s.auth, cashOut(60_000), key));
      const second = send(entry(s.auth, cashOut(60_000), key));
      await untilWaiting(2);
      return [first, second];
    }).then((pending) => Promise.all(pending));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body).toEqual(a.body);
    expect(await written(s.tenantId)).toEqual({ manual: 1, ledger: 1 });
    expect(await current(s.auth)).toMatchObject({ expectedCash: 40_000 });
  });

  it('cross-tenant and cross-actor: an entry lands only in the actor’s own shift of their own store', async () => {
    const a = await createStore();
    const b = await createStore();
    const aShift = await open(a.auth, 100_000);
    await open(b.auth, 7000);
    const key = randomUUID();
    const mine = await entry(a.auth, cashOut(40_000), key).expect(201);

    // Store B with the same key and body gets its own entry in its own shift, never A's.
    const theirs = await entry(b.auth, cashOut(4000), key).expect(201);
    expect(theirs.body.id).not.toBe(mine.body.id);
    expect(theirs.body).toMatchObject({
      drawerCashBefore: 7000,
      drawerCashAfter: 3000,
      actorId: b.userId,
    });
    // B cannot reach more than its own drawer holds, whatever A's drawer has.
    await entry(b.auth, cashOut(3001)).expect(422);
    expect(await current(a.auth)).toMatchObject({
      expectedCash: 60_000,
      manualOut: 40_000,
    });
    expect(await current(b.auth)).toMatchObject({
      expectedCash: 3000,
      manualOut: 4000,
    });
    // B gets 404 on A's shift and never sees A's entries.
    await get(b.auth, `/shifts/${aShift.body.id}`).expect(404);
    const bList = await get(b.auth, '/shifts').expect(200);
    expect(JSON.stringify(bList.body)).not.toContain(aShift.body.id);
    const rows = await admin<{ tenant_id: string; shift_id: string }[]>`
      select tenant_id, shift_id from pos.manual_cash_entries
      where id in (${mine.body.id}, ${theirs.body.id}) order by amount desc`;
    expect(rows.map((r) => r.tenant_id)).toEqual([a.tenantId, b.tenantId]);
    expect(rows[0].shift_id).toBe(aShift.body.id);

    // A cashier of store A: their entry goes to their own shift, not the owner's.
    const cashier = await createCashier(app, a, ['sales.create']);
    await entry(cashier.auth, cashIn(1000)).expect(422); // no shift of their own
    const cShift = await open(cashier.auth, 5000);
    const theirOwn = await entry(cashier.auth, cashIn(1000)).expect(201);
    expect(theirOwn.body).toMatchObject({
      shiftId: cShift.body.id,
      actorId: cashier.staffId,
      actorKind: 'cashier',
      actorName: 'Sari',
      drawerCashBefore: 5000,
    });
    expect(await current(a.auth)).toMatchObject({ expectedCash: 60_000 });
    // Without reports.view the cashier gets 404 on the owner's shift; the owner sees the cashier's.
    await get(cashier.auth, `/shifts/${aShift.body.id}`).expect(404);
    const seen = await get(a.auth, `/shifts/${cShift.body.id}`).expect(200);
    expect(seen.body.cashEntries).toMatchObject([
      { kind: 'manual_in', amount: 1000, refId: theirOwn.body.id },
    ]);
  });
});
