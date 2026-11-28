import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';

// Design 40 screen 7 (UMK-2120 follow-up, owner decision 2026-11-28, option A): a shift opened by the owner's
// first cash action keeps the last count as its opening cash, and the till shows it so the owner can check it or
// correct it once.

describe('Modal awal of an automatically opened shift (design 40 screen 7)', () => {
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
  const opening = (auth: string, body: object) =>
    post(auth, '/shifts/current/opening', body);
  type Shift = {
    id: string;
    openingCash: number;
    expectedCash: number;
    openedAutomatically: boolean;
    openingCheckedAt: string | null;
  };
  const current = async (auth: string) =>
    (await http().get('/shifts/current').set('Authorization', auth).expect(200))
      .body.shift as Shift | null;
  const audits = (tenantId: string) =>
    admin<{ details: Record<string, unknown> }[]>`
      select details from pos.audit_log
       where tenant_id = ${tenantId} and event = 'shift_opening_correct' order by occurred_at, id`;

  /** A store without staff whose last closed shift counted Rp50.000, then a sale opened today's shift. */
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
    await post(s.auth, '/shifts/open', { openingCash: 50_000 }).expect(201);
    await post(s.auth, '/shifts/current/close', {
      countedCash: 50_000,
    }).expect(200);
    const sell = () =>
      http()
        .post('/sales')
        .set('Authorization', s.auth)
        .set('Idempotency-Key', randomUUID())
        .send({ lines: [{ productId, qty: 1 }], paid: 5000 });
    return { ...s, sell };
  }

  it('marks the shift a sale opened, and not one opened by hand', async () => {
    const s = await shop();
    await s.sell().expect(201);
    expect(await current(s.auth)).toMatchObject({
      openingCash: 50_000,
      expectedCash: 55_000,
      openedAutomatically: true,
      openingCheckedAt: null,
    });

    const other = await createStore();
    await post(other.auth, '/shifts/open', { openingCash: 10_000 }).expect(201);
    const byHand = (await current(other.auth))!;
    expect(byHand.openedAutomatically).toBe(false);
    const res = await opening(other.auth, {
      shiftId: byHand.id,
      openingCash: 5000,
    }).expect(409);
    expect(res.body.code).toBe('opening_not_automatic');
    expect((await current(other.auth))!.openingCash).toBe(10_000);
  });

  it('"Sudah benar" checks it, a repeat is fine, and a later correction is refused', async () => {
    const s = await shop();
    await s.sell().expect(201);
    const shift = (await current(s.auth))!;
    const res = await opening(s.auth, { shiftId: shift.id }).expect(200);
    expect(res.body).toMatchObject({ id: shift.id, openingCash: 50_000 });
    expect(res.body.openingCheckedAt).not.toBeNull();
    await opening(s.auth, { shiftId: shift.id }).expect(200);
    await opening(s.auth, { shiftId: shift.id, openingCash: 50_000 }).expect(
      200,
    );
    const late = await opening(s.auth, {
      shiftId: shift.id,
      openingCash: 40_000,
    }).expect(409);
    expect(late.body.code).toBe('opening_checked');
    expect((await current(s.auth))!.openingCash).toBe(50_000);
    expect(await audits(s.tenantId)).toEqual([]);
  });

  it('a correction changes the opening and the expected cash, and is audited', async () => {
    const s = await shop();
    await s.sell().expect(201);
    const shift = (await current(s.auth))!;
    const res = await opening(s.auth, {
      shiftId: shift.id,
      openingCash: 30_000,
    }).expect(200);
    expect(res.body).toMatchObject({
      openingCash: 30_000,
      expectedCash: 35_000,
    });
    expect(res.body.openingCheckedAt).not.toBeNull();
    expect(await audits(s.tenantId)).toEqual([
      {
        details: {
          shiftId: shift.id,
          openingCashBefore: 50_000,
          openingCash: 30_000,
        },
      },
    ]);
    // the close counts against the corrected figure
    const closed = await post(s.auth, '/shifts/current/close', {
      countedCash: 35_000,
    }).expect(200);
    expect(closed.body).toMatchObject({ expectedCash: 35_000, difference: 0 });
  });

  it('refuses an opening that would leave the drawer below nothing, and a negative amount', async () => {
    const s = await shop();
    await s.sell().expect(201);
    const shift = (await current(s.auth))!;
    // Rp45.000 already taken out: the drawer is 50.000 + 5.000 − 45.000 = 10.000
    await http()
      .post('/shifts/current/cash-entries')
      .set('Authorization', s.auth)
      .set('Idempotency-Key', randomUUID())
      .send({ direction: 'out', amount: 45_000, reason: 'setor_bank' })
      .expect(201);
    const low = await opening(s.auth, {
      shiftId: shift.id,
      openingCash: 30_000,
    }).expect(422);
    expect(low.body.code).toBe('OPENING_TOO_LOW');
    expect(low.body.errors.openingCash).toMatch(/minimal Rp40\.000/);
    await opening(s.auth, { shiftId: shift.id, openingCash: -1 }).expect(422);
    expect((await current(s.auth))!).toMatchObject({
      openingCash: 50_000,
      openingCheckedAt: null,
    });
    // exactly what went out is fine
    const ok = await opening(s.auth, {
      shiftId: shift.id,
      openingCash: 40_000,
    }).expect(200);
    expect(ok.body.expectedCash).toBe(0);
  });

  it('is tied to the shift on the screen: another or none answers 409 shift_changed', async () => {
    const s = await shop();
    await s.sell().expect(201);
    const first = (await current(s.auth))!;
    await post(s.auth, '/shifts/current/close', {
      countedCash: 55_000,
    }).expect(200);
    const none = await opening(s.auth, {
      shiftId: first.id,
      openingCash: 1000,
    }).expect(409);
    expect(none.body.code).toBe('shift_changed');
    await s.sell().expect(201);
    const second = (await current(s.auth))!;
    expect(second.openingCash).toBe(55_000);
    const stale = await opening(s.auth, {
      shiftId: first.id,
      openingCash: 1000,
    }).expect(409);
    expect(stale.body.code).toBe('shift_changed');
    expect((await current(s.auth))!.openingCash).toBe(55_000);
    await opening(s.auth, { openingCash: 1000 }).expect(422);
  });

  it('store B cannot touch store A’s shift', async () => {
    const a = await shop();
    const b = await shop();
    await a.sell().expect(201);
    await b.sell().expect(201);
    const shiftA = (await current(a.auth))!;
    const res = await opening(b.auth, {
      shiftId: shiftA.id,
      openingCash: 1000,
    }).expect(409);
    expect(res.body.code).toBe('shift_changed');
    expect((await current(a.auth))!).toMatchObject({
      openingCash: 50_000,
      openingCheckedAt: null,
    });
    expect(await audits(a.tenantId)).toEqual([]);
  });
});
