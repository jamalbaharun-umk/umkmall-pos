import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { AUDIT_EVENT_CODES } from '../src/audit/events';
import { ADMIN_DATABASE_URL, APP_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Row = {
  id: string;
  event: string;
  actor_id: string;
  actor_kind: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  details: Record<string, unknown>;
  occurred_at: Date;
};

const OWNER_PIN = '482913';

describe('staff audit log (UMK-1969, design 32)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const appDb = postgres(APP_DATABASE_URL, { max: 1 });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
    await appDb.end();
  });

  const rows = (tenantId: string, event?: string) =>
    event
      ? admin<Row[]>`select * from pos.audit_log where tenant_id = ${tenantId}
          and event = ${event} order by seq`
      : admin<
          Row[]
        >`select * from pos.audit_log where tenant_id = ${tenantId} order by seq`;
  const post = (auth: string, url: string, body: object = {}) =>
    http().post(url).set('Authorization', auth).send(body);
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);
  const keyed = (auth: string, url: string, body: object) =>
    http()
      .post(url)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  /** A store with one product (5.000, 50 on hand) and two (for the rollback case). */
  async function shop() {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Minuman',
    }).expect(201);
    const product = async (name: string, qty: number) => {
      const p = await post(s.auth, '/catalog/products', {
        categoryId: cat.body.id,
        name,
        costPrice: 2000,
        sellingPrice: 5000,
      }).expect(201);
      await post(s.auth, '/stock/opening', {
        productId: p.body.id,
        qty,
      }).expect(201);
      return p.body.id as string;
    };
    return { ...s, product };
  }
  it('records exactly one row per event, with who, what and no sensitive data', async () => {
    const s = await shop();
    const productId = await s.product('Teh Botol', 50);
    const owner = { actor_id: s.userId, actor_kind: 'owner' };

    // Access: staff, role, device, sign-in (createCashier) - each once, by the owner.
    const c = await createCashier(app, s, [
      'sales.create',
      'sales.price_override',
      'sales.void',
    ]);
    const one = async (event: string) => {
      const found = await rows(s.tenantId, event);
      expect(found).toHaveLength(1);
      return found[0];
    };
    const role = await one('role_create');
    expect(role).toMatchObject({
      ...owner,
      target_type: 'role',
      target_id: c.roleId,
    });
    expect(role.details).toMatchObject({
      roleId: c.roleId,
      added: ['sales.create', 'sales.price_override', 'sales.void'],
    });
    const created = await one('staff_create');
    expect(created).toMatchObject({
      ...owner,
      target_type: 'staff',
      target_id: c.staffId,
      target_label: 'Sari',
    });
    const bound = await one('device_bind');
    expect(bound).toMatchObject({
      ...owner,
      target_type: 'device',
      target_id: c.deviceId,
      target_label: 'Kasir depan',
    });
    const signIn = await one('sign_in');
    expect(signIn).toMatchObject({
      actor_id: c.staffId,
      actor_kind: 'cashier',
      target_type: null,
    });
    expect(signIn.details).toEqual({ deviceId: c.deviceId });

    // A wrong PIN is not a recorded event.
    await c.signIn('000000').expect(401);
    expect(await rows(s.tenantId, 'sign_in')).toHaveLength(1);

    // Shift open and close by the cashier.
    const opened = await post(c.auth, '/shifts/open', {
      openingCash: 100_000,
    }).expect(201);
    const open = await one('shift_open');
    expect(open).toMatchObject({
      actor_id: c.staffId,
      actor_kind: 'cashier',
      target_type: 'shift',
      target_id: opened.body.id,
    });
    expect(open.target_label).toMatch(/^Shift #\d+$/);
    expect(open.details).toEqual({
      shiftId: opened.body.id,
      openingCash: 100_000,
    });

    // Price override: one row per overridden line, none for a list-price line.
    const sale = await keyed(c.auth, '/sales', {
      lines: [{ productId, qty: 2, price: 4500 }],
      paid: 20_000,
    }).expect(201);
    const priced = await one('price_override');
    expect(priced).toMatchObject({
      actor_id: c.staffId,
      target_type: 'product',
      target_id: productId,
      target_label: 'Teh Botol',
    });
    expect(priced.details).toEqual({
      saleId: sale.body.id,
      productId,
      qty: 2,
      listPrice: 5000,
      unitPrice: 4500,
    });
    await keyed(c.auth, '/sales', {
      lines: [{ productId, qty: 1 }],
      paid: 5000,
    }).expect(201);
    expect(await rows(s.tenantId, 'price_override')).toHaveLength(1);

    // Drawer cash, by hand.
    await keyed(c.auth, '/shifts/current/cash-entries', {
      direction: 'in',
      amount: 20_000,
      reason: 'tambah_modal',
      note: 'dari Bu Ani 081234567890',
    }).expect(201);
    await keyed(c.auth, '/shifts/current/cash-entries', {
      direction: 'out',
      amount: 10_000,
      reason: 'setor_bank',
    }).expect(201);
    const cashIn = await one('drawer_cash_in');
    expect(cashIn.details).toMatchObject({
      amount: 20_000,
      reason: 'tambah_modal',
      shiftId: opened.body.id,
      drawerCashBefore: expect.any(Number),
    });
    expect(JSON.stringify(cashIn)).not.toContain('Bu Ani');
    expect((await one('drawer_cash_out')).details).toMatchObject({
      amount: 10_000,
      reason: 'setor_bank',
    });

    // Void, approved by the owner's PIN.
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: OWNER_PIN })
      .expect(200);
    await keyed(c.auth, `/sales/${sale.body.id}/void`, {
      reasonCode: 'wrong_item_or_qty',
      note: 'pelanggan Pak Budi',
      approverId: s.userId,
      pin: OWNER_PIN,
    }).expect(201);
    const voided = await one('void');
    expect(voided).toMatchObject({
      actor_id: c.staffId,
      target_type: 'sale',
      target_id: sale.body.id,
    });
    expect(voided.target_label).toMatch(/^#\d+$/);
    expect(voided.details).toEqual({
      saleId: sale.body.id,
      reasonCode: 'wrong_item_or_qty',
      total: 9000,
      approvedBy: s.userId,
    });
    expect(JSON.stringify(voided)).not.toContain('Pak Budi');
    expect(JSON.stringify(voided)).not.toContain(OWNER_PIN);
    expect(await rows(s.tenantId, 'refund')).toHaveLength(0);

    const closed = await post(c.auth, '/shifts/current/close', {
      countedCash: 90_000,
    }).expect(200);
    const close = await one('shift_close');
    expect(close).toMatchObject({
      actor_id: c.staffId,
      target_type: 'shift',
      target_id: opened.body.id,
    });
    expect(close.details).toMatchObject({
      openedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
      shiftId: opened.body.id,
      openingCash: 100_000,
      countedCash: 90_000,
      expectedCash: closed.body.expectedCash,
      difference: closed.body.difference,
    });

    // Staff, role, device and session changes by the owner.
    await http()
      .patch(`/staff/${c.staffId}`)
      .set('Authorization', s.auth)
      .send({ name: 'Rina', pin: '654321' })
      .expect(200);
    const updated = await one('staff_update');
    expect(updated).toMatchObject({
      ...owner,
      target_id: c.staffId,
      target_label: 'Rina',
    });
    expect(updated.details).toEqual({
      staffId: c.staffId,
      changed: ['name', 'credential'],
    });
    await http()
      .patch(`/roles/${c.roleId}`)
      .set('Authorization', s.auth)
      .send({
        name: 'Kasir senior',
        permissions: ['sales.create', 'sales.price_override', 'reports.view'],
      })
      .expect(200);
    const roleUpdated = await one('role_update');
    expect(roleUpdated).toMatchObject({
      ...owner,
      target_id: c.roleId,
      target_label: 'Kasir senior',
    });
    expect(roleUpdated.details).toEqual({
      roleId: c.roleId,
      renamed: true,
      added: ['reports.view'],
      removed: ['sales.void'],
    });
    await http()
      .post(`/staff/devices/${c.deviceId}/revoke`)
      .set('Authorization', s.auth)
      .expect(204);
    expect(await one('device_revoke')).toMatchObject({
      ...owner,
      target_id: c.deviceId,
      target_label: 'Kasir depan',
    });

    const c2 = await createCashier(app, s);
    const sessions = (await get(s.auth, '/staff/sessions').expect(200))
      .body as { id: string; staff: { id: string } }[];
    const live = sessions.find(
      (x: { staff: { id: string } }) => x.staff.id === c2.staffId,
    );
    await http()
      .post(`/staff/sessions/${live!.id}/revoke`)
      .set('Authorization', s.auth)
      .expect(204);
    const sessionRevoked = await one('session_revoke');
    expect(sessionRevoked).toMatchObject({
      ...owner,
      target_type: 'staff',
      target_id: c2.staffId,
    });
    await http()
      .delete(`/staff/${c2.staffId}`)
      .set('Authorization', s.auth)
      .expect(204);
    expect(await one('staff_delete')).toMatchObject({
      ...owner,
      target_id: c2.staffId,
      target_label: 'Sari 2',
    });
    await http()
      .delete(`/roles/${c2.roleId}`)
      .set('Authorization', s.auth)
      .expect(204);
    expect(await one('role_delete')).toMatchObject({
      ...owner,
      target_id: c2.roleId,
    });

    // Every row: a known event, nothing sensitive anywhere in it.
    const all = await rows(s.tenantId);
    expect(all.length).toBeGreaterThan(15);
    const text = all
      .map((r) => JSON.stringify([r.details, r.target_label]))
      .join('\n')
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        '',
      );
    expect(text).not.toMatch(/pin|token|phone|telp|password|secret|hash/i);
    expect(text).not.toMatch(/\d{8,}/);
    for (const secret of [
      '123456',
      '654321',
      OWNER_PIN,
      c.deviceToken,
      'Bu Ani',
      'Pak Budi',
    ])
      expect(text).not.toContain(secret);
    for (const r of all) expect(AUDIT_EVENT_CODES).toContain(r.event);
  });

  it('records approval PIN changes and a discount approved by PIN', async () => {
    const s = await shop();
    const productId = await s.product('Teh Botol', 50);
    const put = (auth: string, body: object) =>
      http().put('/void-pin').set('Authorization', auth).send(body);
    await put(s.freshAuth, { pin: '482913' }).expect(200);
    await put(s.freshAuth, { pin: '913482', currentPin: '482913' }).expect(200);
    await put(s.freshAuth, { pin: '111222', currentPin: 'wrong1' }).expect(422); // refused: no row
    const sets = await rows(s.tenantId, 'approval_pin_set');
    expect(sets.map((r) => r.details)).toEqual([
      { first: true },
      { first: false },
    ]);
    expect(sets[0]).toMatchObject({
      actor_id: s.userId,
      actor_kind: 'owner',
      target_type: 'approver',
      target_id: s.userId,
    });

    const c = await createCashier(app, s, ['sales.create', 'sales.void']);
    await put(c.auth, { pin: '555666' }).expect(200);
    await http()
      .post(`/void-pin/${c.staffId}/unlock`)
      .set('Authorization', s.auth)
      .expect(200);
    await http()
      .delete(`/void-pin/${c.staffId}`)
      .set('Authorization', s.auth)
      .expect(200);
    expect(await rows(s.tenantId, 'approval_pin_set')).toHaveLength(3);
    expect((await rows(s.tenantId, 'approval_pin_unlock'))[0]).toMatchObject({
      actor_id: s.userId,
      target_id: c.staffId,
    });
    expect((await rows(s.tenantId, 'approval_pin_reset'))[0]).toMatchObject({
      actor_id: s.userId,
      target_id: c.staffId,
    });
    await http()
      .post(`/void-pin/${randomUUID()}/unlock`)
      .set('Authorization', s.auth)
      .expect(404);
    expect(await rows(s.tenantId, 'approval_pin_unlock')).toHaveLength(1);

    // A 40% line discount, approved by the owner's PIN.
    await post(s.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    const approval = await post(s.auth, '/sales/discount-approvals', {
      approverId: s.userId,
      pin: '913482',
      productId,
      maxBps: 4000,
      maxAmount: 8000,
    }).expect(201);
    expect(await rows(s.tenantId, 'discount_approval')).toHaveLength(0); // the grant alone is not the discount
    const sale = await keyed(s.auth, '/sales', {
      lines: [
        {
          productId,
          qty: 4,
          discountPercent: 40,
          discountApprovalId: approval.body.id,
        },
      ],
      paid: 12_000,
    }).expect(201);
    const [row] = await rows(s.tenantId, 'discount_approval');
    expect(row).toMatchObject({
      target_type: 'product',
      target_id: productId,
      target_label: 'Teh Botol',
    });
    expect(row.details).toMatchObject({
      saleId: sale.body.id,
      productId,
      discount: 8000,
      approvedBy: s.userId,
    });
    const text = JSON.stringify((await rows(s.tenantId)).map((r) => r.details));
    for (const pin of ['482913', '913482', '555666', '111222'])
      expect(text).not.toContain(pin);
  });

  it('records a device paired by code', async () => {
    const s = await createStore();
    const started = await http()
      .post('/auth/device/pairing')
      .set('X-Forwarded-For', '10.77.0.1')
      .expect(201);
    await post(s.auth, '/staff/devices/pair', {
      code: started.body.code,
      name: 'Tablet lama',
    }).expect(201);
    const [row] = await rows(s.tenantId, 'device_pair');
    expect(row).toMatchObject({
      actor_id: s.userId,
      actor_kind: 'owner',
      target_type: 'device',
      target_label: 'Tablet lama',
    });
    // A wrong code writes nothing.
    await post(s.auth, '/staff/devices/pair', {
      code: '000000',
      name: 'X',
    }).expect(422);
    expect(await rows(s.tenantId, 'device_pair')).toHaveLength(1);
  });

  it('writes no row for an action that rolls back (same transaction)', async () => {
    const s = await shop();
    const a = await s.product('Aqua', 3);
    const b = await s.product('Kopi', 3);
    const c = await createCashier(app, s, [
      'sales.create',
      'sales.price_override',
    ]);
    await post(c.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    // Lines draw stock in product-id order: the second one in that order is short, after the first one's log row.
    const [first, second] = [a, b].sort();
    const qty = (id: string) => (id === second ? 5 : 1);
    const res = await keyed(c.auth, '/sales', {
      lines: [first, second].map((productId) => ({
        productId,
        qty: qty(productId),
        price: 100,
      })),
      paid: 1_000_000,
    });
    expect([409, 422]).toContain(res.status);
    expect(await rows(s.tenantId, 'price_override')).toHaveLength(0);
    // A refused staff update (unknown role) writes none either.
    await http()
      .patch(`/staff/${c.staffId}`)
      .set('Authorization', s.auth)
      .send({ roleIds: [randomUUID()] })
      .expect(422);
    expect(await rows(s.tenantId, 'staff_update')).toHaveLength(0);
  });

  describe('list', () => {
    const insert = (
      tenantId: string,
      actorId: string,
      actorKind: string,
      event: string,
      at: string,
      label: string | null = null,
    ) => admin`insert into pos.audit_log (tenant_id, actor_id, actor_kind, event, occurred_at, target_type, target_label)
      values (${tenantId}, ${actorId}, ${actorKind}, ${event}, ${at}, ${label ? 'device' : null}, ${label})`;

    it('pages newest first, filters, and answers in the store timezone', async () => {
      const s = await createStore();
      const c = await createCashier(app, s);
      // The cashier's own setup rows predate everything below.
      await admin.begin(async (tx) => {
        await tx`select set_config('pos.purging', ${s.tenantId}, true)`;
        await tx`delete from pos.audit_log where tenant_id = ${s.tenantId}`;
      });
      for (let i = 0; i < 45; i++)
        await insert(
          s.tenantId,
          c.staffId,
          'cashier',
          i % 3 === 0 ? 'void' : i % 3 === 1 ? 'shift_open' : 'sign_in',
          `2026-11-${String(1 + (i % 20)).padStart(2, '0')}T0${i % 9}:00:00Z`,
          `t${i}`,
        );
      await insert(
        s.tenantId,
        s.userId,
        'owner',
        'device_revoke',
        '2026-11-25T17:30:00Z',
        'Tablet lama',
      );
      const list = (q = '') => get(s.auth, `/audit-log${q}`).expect(200);

      const p1 = await list();
      expect(p1.body).toMatchObject({
        total: 46,
        page: 1,
        perPage: 20,
        timezone: 'Asia/Jakarta',
      });
      expect(p1.body.data).toHaveLength(20);
      expect(p1.body.data[0]).toMatchObject({
        event: 'device_revoke',
        group: 'access',
        actor: { kind: 'owner', name: null },
        target: { label: 'Tablet lama' },
      });
      expect(p1.body.data[1].actor).toMatchObject({
        id: c.staffId,
        kind: 'cashier',
        name: 'Sari',
      });
      const times = (p1.body.data as { occurredAt: string }[]).map(
        (r: { occurredAt: string }) => r.occurredAt,
      );
      expect([...times].sort().reverse()).toEqual(times);
      const p3 = await list('?page=3');
      expect(p3.body.data).toHaveLength(6);
      const ids = new Set(
        [
          ...p1.body.data,
          ...(await list('?page=2')).body.data,
          ...p3.body.data,
        ].map((r: { id: string }) => r.id),
      );
      expect(ids.size).toBe(46);

      expect((await list('?group=money')).body.total).toBe(15);
      expect((await list('?group=shift')).body.total).toBe(15);
      expect((await list('?event=sign_in')).body.total).toBe(15);
      expect((await list('?group=money&event=sign_in')).body.total).toBe(15); // the event wins
      expect((await list('?actor=owner')).body.total).toBe(1);
      expect((await list(`?actor=${c.staffId}`)).body.total).toBe(45);
      // 25 Nov 17:30 UTC is 26 Nov 00:30 in Jakarta.
      expect((await list('?from=2026-11-26')).body.total).toBe(1);
      expect((await list('?to=2026-11-25')).body.total).toBe(45);
      expect((await list('?from=2026-11-26&to=2026-11-26')).body.total).toBe(1);
      expect((await list('?perPage=5&page=2')).body.data).toHaveLength(5);
      expect((await list('?actor=owner&group=money')).body.total).toBe(0);

      // The last N store days, today included: a row from now is in 1 day, one 3 days back is in 4 not in 3.
      await insert(
        s.tenantId,
        s.userId,
        'owner',
        'device_bind',
        new Date().toISOString(),
        'Baru',
      );
      await insert(
        s.tenantId,
        s.userId,
        'owner',
        'device_bind',
        new Date(Date.now() - 3 * 86_400_000).toISOString(),
        'Lama',
      );
      expect((await list('?days=1&event=device_bind')).body.total).toBe(1);
      expect((await list('?days=3&event=device_bind')).body.total).toBe(1);
      expect((await list('?days=5&event=device_bind')).body.total).toBe(2);
      for (const bad of [
        '?days=0',
        '?days=7&from=2026-11-01',
        '?from=2026-02-30',
        '?event=drop_table',
        '?group=x',
        '?page=0',
        '?perPage=101',
        '?actor=bob',
        '?x=1',
      ])
        await get(s.auth, `/audit-log${bad}`).expect(422);
      const one = await get(s.auth, `/audit-log/${p1.body.data[0].id}`).expect(
        200,
      );
      expect(one.body).toEqual(p1.body.data[0]);
      await get(s.auth, '/audit-log/not-a-uuid').expect(404);
    });

    it('uses the timezone of the store', async () => {
      const s = await createStore();
      await admin`insert into pos.report_settings (tenant_id, timezone) values (${s.tenantId}, 'Asia/Jayapura') on conflict (tenant_id) do update set timezone = excluded.timezone`;
      await insert(
        s.tenantId,
        s.userId,
        'owner',
        'device_revoke',
        '2026-11-25T15:30:00Z',
      );
      const res = await get(
        s.auth,
        '/audit-log?from=2026-11-26&to=2026-11-26',
      ).expect(200);
      expect(res.body).toMatchObject({ timezone: 'Asia/Jayapura', total: 1 }); // 00:30 on 26 Nov at +9
    });
  });

  it('answers 403 to anyone without staff.manage, and 401 without a session', async () => {
    const s = await createStore();
    const cashier = await createCashier(app, s, [
      'sales.create',
      'reports.view',
      'sales.void',
    ]);
    await get(cashier.auth, '/audit-log').expect(403);
    await get(cashier.auth, `/audit-log/${randomUUID()}`).expect(403);
    await http().get('/audit-log').expect(401);
    const manager = await createCashier(app, s, ['staff.manage']);
    await get(manager.auth, '/audit-log').expect(200);
  });

  it('keeps stores apart: store B sees none of A, and 404 on its ids', async () => {
    const a = await createStore();
    const b = await createStore();
    await createCashier(app, a);
    const [rowOfA] = await rows(a.tenantId);
    expect(rowOfA).toBeDefined();
    const seenByB = await get(b.auth, '/audit-log').expect(200);
    expect(seenByB.body).toMatchObject({ total: 0, data: [] });
    await get(b.auth, `/audit-log/${rowOfA.id}`).expect(404);
    await get(a.auth, `/audit-log/${rowOfA.id}`).expect(200);
    // B's own activity never shows in A's list.
    await createCashier(app, b);
    const seenByA = await get(a.auth, '/audit-log?perPage=100').expect(200);
    expect(seenByA.body.total).toBe((await rows(a.tenantId)).length);
    for (const r of seenByA.body.data)
      expect((await rows(b.tenantId)).map((x) => x.id)).not.toContain(r.id);
  });

  describe('append only', () => {
    it('has no route that changes or deletes a row', async () => {
      const s = await createStore();
      await createCashier(app, s);
      const [row] = await rows(s.tenantId);
      for (const url of ['/audit-log', `/audit-log/${row.id}`]) {
        for (const verb of ['post', 'put', 'patch', 'delete'] as const)
          await http()
            [verb](url)
            .set('Authorization', s.auth)
            .send({ event: 'void' })
            .expect(404);
      }
      expect((await rows(s.tenantId)).length).toBeGreaterThan(0);
    });

    it('refuses an UPDATE in the database, also by the app role', async () => {
      const s = await createStore();
      await createCashier(app, s);
      const [row] = await rows(s.tenantId);
      await expect(
        admin`update pos.audit_log set event = 'void' where id = ${row.id}`,
      ).rejects.toThrow(/append only/);
      await expect(
        appDb`update pos.audit_log set details = '{}' where id = ${row.id}`,
      ).rejects.toThrow(/append only/);
      const [still] = await rows(s.tenantId);
      expect(still.event).toBe(row.event);
    });

    it('is written and read only by src/audit (guard)', () => {
      const root = path.join(__dirname, '..', 'src');
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((f) => {
          const p = path.join(dir, f);
          return statSync(p).isDirectory()
            ? walk(p)
            : p.endsWith('.ts')
              ? [p]
              : [];
        });
      for (const file of walk(root)) {
        const rel = path.relative(root, file);
        if (
          rel.startsWith('audit/') ||
          rel.startsWith('db/schema/') ||
          rel.endsWith('.spec.ts')
        )
          continue;
        const text = readFileSync(file, 'utf8');
        expect({ file: rel, hit: /\bauditLog\b/.test(text) }).toEqual({
          file: rel,
          hit: false,
        });
        expect({ file: rel, hit: /audit_log/.test(text) }).toEqual({
          file: rel,
          hit: false,
        });
      }
      // Inside src/audit only the list controller reads; nothing but `record.ts` writes.
      for (const file of walk(path.join(root, 'audit'))) {
        if (file.endsWith('.spec.ts')) continue;
        const text = readFileSync(file, 'utf8');
        const writes = /\.(update|delete)\(\s*auditLog/.test(text);
        expect({ file: path.basename(file), writes }).toEqual({
          file: path.basename(file),
          writes: false,
        });
        if (/\.insert\(\s*auditLog/.test(text))
          expect(path.basename(file)).toBe('record.ts');
      }
    });
  });

  describe('delete and truncate', () => {
    it('refuses a plain DELETE and a TRUNCATE, also by the app role', async () => {
      const s = await createStore();
      await createCashier(app, s);
      const before = (await rows(s.tenantId)).length;
      expect(before).toBeGreaterThan(0);
      await expect(
        admin`delete from pos.audit_log where tenant_id = ${s.tenantId}`,
      ).rejects.toThrow(/append only/);
      await expect(
        appDb`delete from pos.audit_log where tenant_id = ${s.tenantId}`,
      ).rejects.toThrow(/append only/);
      await expect(appDb`truncate pos.audit_log`).rejects.toThrow(
        /append only/,
      );
      // The purge's setting is for ITS tenant only, and not for TRUNCATE.
      await expect(
        appDb.begin(async (tx) => {
          await tx`select set_config('pos.purging', ${randomUUID()}, true)`;
          await tx`delete from pos.audit_log where tenant_id = ${s.tenantId}`;
        }),
      ).rejects.toThrow(/append only/);
      await expect(
        appDb.begin(async (tx) => {
          await tx`select set_config('pos.purging', ${s.tenantId}, true)`;
          await tx`truncate pos.audit_log`;
        }),
      ).rejects.toThrow(/append only/);
      expect(await rows(s.tenantId)).toHaveLength(before);
    });

    it('lets the purge delete a store log and no other', async () => {
      const a = await createStore();
      const b = await createStore();
      await createCashier(app, a);
      await createCashier(app, b);
      const kept = (await rows(b.tenantId)).length;
      expect((await rows(a.tenantId)).length).toBeGreaterThan(0);
      await admin`update public.users set delete_status_flag = 'to_delete',
        delete_date = now() - make_interval(days => 31) where id = ${a.userId}`;
      await http()
        .post('/internal/tenants/purge')
        .set('x-pos-service-key', process.env.POS_SERVICE_KEY!)
        .send({ userId: a.userId })
        .expect(200, { purged: true });
      expect(await rows(a.tenantId)).toHaveLength(0);
      expect(await rows(b.tenantId)).toHaveLength(kept);
    });

    it('answers the default timezone when the stored one is unknown', async () => {
      const s = await createStore();
      await admin`insert into pos.report_settings (tenant_id, timezone) values (${s.tenantId}, 'Bukan/Zona')
        on conflict (tenant_id) do update set timezone = excluded.timezone`;
      const res = await get(s.auth, '/audit-log?days=7').expect(200);
      expect(res.body.timezone).toBe('Asia/Jakarta');
    });
  });

  it('has the table with RLS and a tenant_id column (the purge finds it)', async () => {
    const [col] = await admin`select 1 from information_schema.columns
      where table_schema = 'pos' and table_name = 'audit_log' and column_name = 'tenant_id'`;
    expect(col).toBeDefined();
    const [rls] =
      await admin`select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pos' and c.relname = 'audit_log'`;
    expect(rls.relrowsecurity).toBe(true);
  });
});
