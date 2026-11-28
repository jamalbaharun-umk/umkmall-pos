import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';
import { hashSecret } from '../src/staff/secrets';
import { signSession } from '../src/tenancy/session';

// UMK-2124 "Serahkan ke pembantu" (design 42, plan 2026-11-28-015): the owner parks the session behind the owner
// PIN and a helper sells on the same device, nothing else; the owner comes back with the PIN.

const OWNER_PIN = '135790';

describe('Serahkan ke pembantu: a sales-only till behind the owner PIN (UMK-2124)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const http = () => request(app.getHttpServer());
  let savedUmkmall: string | undefined;

  beforeAll(async () => {
    // The refresh route exists only with UMKMall's native auth configured. Nothing listens here: a refresh that
    // gets past the parked check answers 503, one refused for being parked answers 403 before any call.
    savedUmkmall = process.env.UMKMALL_API_URL;
    process.env.UMKMALL_API_URL = 'http://127.0.0.1:9';
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
    if (savedUmkmall === undefined) delete process.env.UMKMALL_API_URL;
    else process.env.UMKMALL_API_URL = savedUmkmall;
  });

  const post = (auth: string, url: string, body: object) =>
    http().post(url).set('Authorization', auth).send(body);
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);
  const bearer = (token: string) => `Bearer ${token}`;
  const audits = (tenantId: string, event: string) =>
    admin<{ actor_kind: string; details: Record<string, unknown> }[]>`
      select actor_kind, details from pos.audit_log
       where tenant_id = ${tenantId} and event = ${event} order by occurred_at, id`;

  /**
   * The owner's session after a WhatsApp sign-in or its refresh: it names the native session it came from (`nsh`),
   * the one a handover parks. Sids of this file are random (the parked lookup names no store).
   */
  const nativeOwner = async (
    s: { tenantId: string; userId: string },
    sid: string,
    signedInAt?: number,
  ) =>
    bearer(
      await signSession(
        {
          tenantId: s.tenantId,
          actorId: s.userId,
          kind: 'owner',
          nativeSidHash: hashSecret(sid),
          ...(signedInAt && { signedInAt }),
        },
        process.env.POS_SESSION_SECRET!,
      ),
    );

  /** A store without staff, with the owner's PIN and Es Teh at Rp5.000. */
  async function shop() {
    const s = await createStore();
    const sid = randomUUID();
    const owner = await nativeOwner(s, sid);
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: OWNER_PIN })
      .expect(200);
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
    const sell = (auth: string, body: object = {}) =>
      http()
        .post('/sales')
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({ lines: [{ productId, qty: 1 }], paid: 5000, ...body });
    const start = (body: object = {}, auth = owner) =>
      post(auth, '/helper/start', { pin: OWNER_PIN, parkedSid: sid, ...body });
    return { ...s, sid, owner, productId, sell, start };
  }

  it('hands over with the owner PIN: the shift opens, the helper sells into it as "Pembantu"', async () => {
    const s = await shop();
    const started = await s.start({ name: 'Dina' }).expect(201);
    expect(started.body.helper).toMatchObject({ name: 'Dina' });
    const helper = bearer(started.body.sessionToken);
    const me = await get(helper, '/tenant/me').expect(200);
    expect(me.body.actor).toMatchObject({
      kind: 'helper',
      permissions: ['sales.create'],
    });
    expect(me.body.helper).toMatchObject({ name: 'Dina' });

    // the shift is open, and nothing of its money reaches the helper (review of PR 109)
    const current = await get(helper, '/shifts/current').expect(200);
    const shift = current.body.shift as { id: string };
    expect(Object.keys(shift).sort()).toEqual(['id', 'openedAt']);
    expect(current.body).toEqual({
      shift,
      autoOpen: false,
      discountPinRequired: true,
    });
    const sale = await s.sell(helper).expect(201);
    const [row] = await admin<
      {
        actor_kind: string;
        actor_id: string;
        shift_id: string;
        helper_session_id: string;
      }[]
    >`select actor_kind, actor_id, shift_id, helper_session_id from pos.sales where id = ${sale.body.id}`;
    expect(row).toEqual({
      actor_kind: 'helper',
      actor_id: s.userId,
      shift_id: shift.id,
      helper_session_id: started.body.helper.id,
    });
    const receipt = await get(helper, `/sales/${sale.body.id}/receipt`).expect(
      200,
    );
    expect(receipt.body.cashier).toBe('Pembantu');
    // the owner's history names the helper's sale
    const list = await get(s.auth, '/sales').expect(200);
    expect(list.body.data[0]).toMatchObject({ cashier: 'Pembantu' });

    expect(await audits(s.tenantId, 'helper_start')).toEqual([
      {
        actor_kind: 'owner',
        details: expect.objectContaining({
          helperSessionId: started.body.helper.id,
          shiftId: shift.id,
        }),
      },
    ]);
    // never the helper's name
    expect(
      JSON.stringify(await audits(s.tenantId, 'helper_start')),
    ).not.toMatch(/Dina/);
  });

  it('start needs the owner, the owner PIN, and one handover at a time', async () => {
    const s = await shop();
    const wrong = await s.start({ pin: '000000' }).expect(422);
    expect(wrong.body.errors.pin).toBe('PIN salah');
    await s.start().expect(201);
    const again = await s.start().expect(409);
    expect(again.body.code).toBe('helper_active');

    const noPin = await createStore();
    const noPinSid = randomUUID();
    const missing = await post(
      await nativeOwner(noPin, noPinSid),
      '/helper/start',
      { pin: OWNER_PIN, parkedSid: noPinSid },
    ).expect(422);
    expect(missing.body.code).toBe('owner_pin_missing');

    const withStaff = await shop();
    const cashier = await createCashier(app, withStaff);
    await post(cashier.auth, '/helper/start', { pin: OWNER_PIN }).expect(403);
    // a store with staff opens no shift by itself
    const noShift = await withStaff.start().expect(409);
    expect(noShift.body.code).toBe('shift_required');
    await post(withStaff.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    await withStaff.start().expect(201);
  });

  it('the helper only sells: no discount, price, voucher, kasbon or online method, and no other route', async () => {
    const s = await shop();
    const helper = bearer((await s.start().expect(201)).body.sessionToken);
    for (const extra of [
      { discount: 500 },
      { voucherCode: 'HEMAT' },
      { memberId: randomUUID() },
    ])
      await s.sell(helper, extra).expect(422);
    await http()
      .post('/sales')
      .set('Authorization', helper)
      .set('Idempotency-Key', randomUUID())
      .send({
        lines: [{ productId: s.productId, qty: 1, price: 1000 }],
        paid: 1000,
      })
      .expect(422);
    await http()
      .post('/sales')
      .set('Authorization', helper)
      .set('Idempotency-Key', randomUUID())
      .send({
        lines: [{ productId: s.productId, qty: 1, discountAmount: 1000 }],
        paid: 4000,
      })
      .expect(422);
    const kasbon = await post(s.auth, '/payment-methods', {
      name: 'Kasbon',
      kind: 'credit',
    }).expect(201);
    const refused = await s
      .sell(helper, { paymentMethodId: kasbon.body.id, paid: 0 })
      .expect(403);
    expect(refused.body.code).toBe('helper_not_allowed');
    const debit = await post(s.auth, '/payment-methods', {
      name: 'Debit',
      kind: 'debit',
    }).expect(201);
    await s.sell(helper, { paymentMethodId: debit.body.id }).expect(201);
    const sale = await s.sell(helper).expect(201);

    // every route outside the restricted till answers 403, whatever its permission
    for (const [method, url, body] of [
      ['post', `/sales/${sale.body.id}/void`, {}],
      ['post', '/shifts/current/cash-entries', {}],
      ['post', '/shifts/current/close', { countedCash: 0 }],
      ['post', '/catalog/products', {}],
      ['get', '/sales', undefined],
      ['get', `/sales/${sale.body.id}`, undefined],
      ['get', '/reports/dashboard', undefined],
      ['get', '/staff', undefined],
      ['get', '/audit-log', undefined],
      ['post', '/helper/start', { pin: OWNER_PIN }],
      ['get', '/sales/discount-approvers', undefined],
    ] as const) {
      const req = http()
        [method](url)
        .set('Authorization', helper)
        .set('Idempotency-Key', randomUUID());
      await (body ? req.send(body) : req).expect(403);
    }
    // its receipts only: the owner's own sale is not one of them
    const owners = await s.sell(s.auth).expect(201);
    await get(helper, `/sales/${owners.body.id}/receipt`).expect(404);
  });

  it('comes back with the owner PIN: wrong 422, 5 wrong lock 5 minutes, right one hands back an owner token', async () => {
    const s = await shop();
    const helper = bearer((await s.start().expect(201)).body.sessionToken);
    const wrong = await post(helper, '/helper/end', { pin: '000000' }).expect(
      422,
    );
    expect(wrong.body.errors.pin).toBe('PIN salah');
    await admin`update pos.void_pins set failures = 0 where tenant_id = ${s.tenantId}`;
    for (let i = 0; i < 4; i++)
      await post(helper, '/helper/end', { pin: '000000' }).expect(422);
    // the fifth wrong PIN locks the owner PIN (the void's rule: 5 wrong, 5 minutes)
    await post(helper, '/helper/end', { pin: '000000' });
    const locked = await post(helper, '/helper/end', {
      pin: OWNER_PIN,
    }).expect(429);
    expect(locked.body.code).toBe('owner_pin_locked');
    expect(locked.body.retryAfter).toBeGreaterThan(240);
    await admin`update pos.void_pins set failures = 0, locked_until = null where tenant_id = ${s.tenantId}`;

    const ended = await post(helper, '/helper/end', { pin: OWNER_PIN }).expect(
      200,
    );
    const owner = bearer(ended.body.sessionToken);
    expect((await get(owner, '/tenant/me').expect(200)).body.actor.kind).toBe(
      'owner',
    );
    // the helper token is dead, and the owner may hand over again
    await get(helper, '/shifts/current').expect(401);
    await post(helper, '/helper/end', { pin: OWNER_PIN }).expect(401);
    expect(await audits(s.tenantId, 'helper_end')).toEqual([
      {
        actor_kind: 'helper',
        details: expect.objectContaining({ reason: 'owner' }),
      },
    ]);
    await s.start().expect(201);
  });

  it('keeps the parked native session asleep until the PIN, and after the 12 hours', async () => {
    const s = await shop();
    // The sid hash is looked up before the store is known (the refresh names no store): sids of this test are
    // its own, so a suite sharing the database never collides with them.
    const parkedSid = s.sid;
    const [otherSid, laterSid] = [randomUUID(), randomUUID()];
    const refresh = (sid: string) =>
      http()
        .post('/auth/umkmall/refresh')
        .send({ sid, refreshToken: 'r'.repeat(20) });
    const helper = bearer((await s.start().expect(201)).body.sessionToken);
    const parked = await refresh(parkedSid).expect(403);
    expect(parked.body.code).toBe('session_parked');
    // another sid is not parked: it gets past the check (and UMKMall cannot be reached here)
    await refresh(otherSid).expect(503);
    await post(helper, '/helper/end', { pin: OWNER_PIN }).expect(200);
    await refresh(parkedSid).expect(503);

    // a handover that ran out: its token is refused, its sid stays parked, the next start ends it as expired
    const second = bearer(
      (
        await s
          .start({ parkedSid: laterSid }, await nativeOwner(s, laterSid))
          .expect(201)
      ).body.sessionToken,
    );
    await admin`update pos.helper_sessions set expires_at = now() - interval '1 second'
                where tenant_id = ${s.tenantId} and ended_at is null`;
    await get(second, '/shifts/current').expect(401);
    await refresh(laterSid).expect(403);
    await s.start().expect(201);
    const [expired] = await admin<{ ended_reason: string }[]>`
      select ended_reason from pos.helper_sessions
       where tenant_id = ${s.tenantId} and parked_sid_hash is not null and ended_reason = 'expired'`;
    expect(expired).toBeDefined();
    await refresh(laterSid).expect(403);
  });

  it('store B can neither use nor end store A’s handover', async () => {
    const a = await shop();
    const b = await shop();
    const started = await a.start().expect(201);
    // B's helper token cannot be pointed at A's row: the token is signed, and the row must match B's store
    const bHelper = bearer((await b.start().expect(201)).body.sessionToken);
    await post(bHelper, '/helper/end', { pin: OWNER_PIN }).expect(200);
    await get(bearer(started.body.sessionToken), '/shifts/current').expect(200);
    const [row] = await admin<{ ended_at: Date | null }[]>`
      select ended_at from pos.helper_sessions where id = ${started.body.helper.id}`;
    expect(row.ended_at).toBeNull();
    // a sale of store B can never name store A's handover (the foreign key carries the store)
    const bSale = await b.sell(b.auth).expect(201);
    await expect(
      admin`update pos.sales set helper_session_id = ${started.body.helper.id} where id = ${bSale.body.id}`,
    ).rejects.toThrow(/foreign key/);
    // A's helper sees only A's shift and products
    const products = await get(
      bearer(started.body.sessionToken),
      '/catalog/products?use=sale',
    ).expect(200);
    const ids = (products.body as { data: { id: string }[] }).data.map(
      (p) => p.id,
    );
    expect(ids).toEqual([a.productId]);
  });
  it('parks exactly the native session the owner signed in with (review of PR 109)', async () => {
    const s = await shop();
    // none named, or another one: nothing would be parked, so nothing is handed over (and no PIN is counted)
    const none = await s.start({ parkedSid: undefined }).expect(422);
    expect(none.body.errors.parkedSid).toBeDefined();
    await s.start({ parkedSid: randomUUID() }).expect(422);
    // an owner session that names no native session, where WhatsApp sign-in exists, signs in again first
    const unnamed = await s.start({}, s.auth).expect(403);
    expect(unnamed.body.code).toBe('sign_in_again');
    const [pin] = await admin<{ failures: number }[]>`
      select failures from pos.void_pins where tenant_id = ${s.tenantId}`;
    expect(pin.failures).toBe(0);
    await s.start().expect(201);
  });

  it('a helper token names a live handover of its store: a forged one is 401', async () => {
    const s = await shop();
    await s.start().expect(201);
    const forged = await signSession(
      {
        tenantId: s.tenantId,
        actorId: s.userId,
        kind: 'helper',
        helperSessionId: randomUUID(),
      },
      process.env.POS_SESSION_SECRET!,
    );
    await get(bearer(forged), '/shifts/current').expect(401);
    await post(bearer(forged), '/helper/end', { pin: OWNER_PIN }).expect(401);
  });

  it('the helper quote takes no voucher, discount or price, and an online method is refused', async () => {
    const s = await shop();
    const helper = bearer((await s.start().expect(201)).body.sessionToken);
    await post(helper, '/sales/quote', {
      lines: [{ productId: s.productId, qty: 1 }],
    }).expect(200);
    for (const body of [
      { lines: [{ productId: s.productId, qty: 1 }], voucherCode: 'HEMAT' },
      { lines: [{ productId: s.productId, qty: 1, discountAmount: 500 }] },
      { lines: [{ productId: s.productId, qty: 1, discountPercent: 10 }] },
      { lines: [{ productId: s.productId, qty: 1, price: 1000 }] },
      { lines: [{ productId: s.productId, qty: 1 }], discount: 500 },
    ])
      await post(helper, '/sales/quote', body).expect(422);
    const [online] = await admin<{ id: string }[]>`
      insert into pos.payment_methods (tenant_id, name, is_online, gateway_method)
      values (${s.tenantId}, 'QRIS online', true, 'fake_qris') returning id`;
    const refused = await s
      .sell(helper, { paymentMethodId: online.id })
      .expect(403);
    expect(refused.body.code).toBe('helper_not_allowed');
  });

  it('after a handover the owner PIN changes only after a fresh WhatsApp sign-in; the token handed back is not fresh', async () => {
    const s = await shop();
    const helper = bearer((await s.start().expect(201)).body.sessionToken);
    // wrong PINs at "Kembali ke pemilik" are audited, never the PIN
    await post(helper, '/helper/end', { pin: '000000' }).expect(422);
    const refused = await audits(s.tenantId, 'helper_end_refused');
    expect(refused).toEqual([
      {
        actor_kind: 'helper',
        details: expect.objectContaining({ reason: 'wrong_pin' }),
      },
    ]);
    expect(JSON.stringify(refused)).not.toMatch(/000000|135790/);
    const owner = bearer(
      (await post(helper, '/helper/end', { pin: OWNER_PIN }).expect(200)).body
        .sessionToken,
    );
    const forgotten = await http()
      .put('/void-pin/forgotten')
      .set('Authorization', owner)
      .send({ pin: '246810' })
      .expect(403);
    expect(forgotten.body.code).toBe('fresh_sign_in_required');
    // a helper who saw the PIN cannot change it with that PIN, from this token or a refreshed one
    for (const auth of [owner, s.owner, s.auth]) {
      const change = await http()
        .put('/void-pin')
        .set('Authorization', auth)
        .send({ pin: '246810', currentPin: OWNER_PIN })
        .expect(403);
      expect(change.body.code).toBe('fresh_sign_in_required');
    }
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: '246810', currentPin: OWNER_PIN })
      .expect(200);
    // changed after the handover: the usual rule is back (the current PIN is enough)
    await http()
      .put('/void-pin')
      .set('Authorization', s.auth)
      .send({ pin: OWNER_PIN, currentPin: '246810' })
      .expect(200);
  });

  it('the owner ends a handover from a fresh WhatsApp sign-in when the helper device is gone', async () => {
    const s = await shop();
    const other = await shop();
    const helper = bearer((await s.start().expect(201)).body.sessionToken);
    const otherHelper = bearer(
      (await other.start().expect(201)).body.sessionToken,
    );
    const stale = await post(s.auth, '/helper/close', {}).expect(403);
    expect(stale.body.code).toBe('fresh_sign_in_required');
    await post(helper, '/helper/close', {}).expect(403);
    await post(s.freshAuth, '/helper/close', {}).expect(200);
    await get(helper, '/shifts/current').expect(401);
    // the parked native session stays asleep: the sign-in made a new one
    const parked = await http()
      .post('/auth/umkmall/refresh')
      .send({ sid: s.sid, refreshToken: 'r'.repeat(20) })
      .expect(403);
    expect(parked.body.code).toBe('session_parked');
    expect(await audits(s.tenantId, 'helper_end')).toEqual([
      {
        actor_kind: 'owner',
        details: expect.objectContaining({ reason: 'signin' }),
      },
    ]);
    const none = await post(s.freshAuth, '/helper/close', {}).expect(409);
    expect(none.body.code).toBe('helper_not_active');
    // another store's handover is untouched
    await get(otherHelper, '/shifts/current').expect(200);
    // and a new handover may start
    await s.start({}, await nativeOwner(s, randomUUID())).expect(422);
    const sid = randomUUID();
    await s.start({ parkedSid: sid }, await nativeOwner(s, sid)).expect(201);
  });
});
