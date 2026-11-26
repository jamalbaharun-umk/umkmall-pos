import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { ADMIN_DATABASE_URL } from './support/env';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b50000000049454e44ae426082',
  'hex',
);
const jakartaDay = (days = 0) =>
  new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

// Tables without tenant_id, on purpose. Anything else in `pos` must carry tenant_id, or the purge's runtime
// discovery (src/purge/purge.service.ts) would miss it and leave a store's rows behind after erasure.
const GLOBAL_TABLES = ['tenants', '__drizzle_migrations'];

describe('store purge on UMKMall account erasure (U8)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const http = () => request(app.getHttpServer());
  const KEY = process.env.POS_SERVICE_KEY!;

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const purge = (body: unknown, key: string | null = KEY) => {
    const req = http().post('/internal/tenants/purge');
    if (key !== null) req.set('x-pos-service-key', key);
    return req.send(body as object);
  };

  /**
   * What UMKMall's self-service deletion sets (null = active account). The purge may act only once the 30-day
   * grace window since `delete_date` has passed (UMKMall's archiver cutoff), so the default is 31 days ago.
   */
  const markForDeletion = (
    userId: string,
    flag: 'to_delete' | 'archived' | null = 'to_delete',
    daysAgo = 31,
  ) =>
    admin`update public.users set delete_status_flag = ${flag},
      delete_date = now() - make_interval(days => ${daysAgo}) where id = ${userId}`;

  async function tenantTables(): Promise<string[]> {
    const rows = await admin<{ name: string }[]>`
      select c.relname as name from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'pos' and c.relkind = 'r' and a.attname = 'tenant_id' and not a.attisdropped
      order by 1`;
    return rows.map((r) => r.name);
  }

  async function rowCounts(tenantId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const t of await tenantTables()) {
      const [{ n }] = await admin.unsafe<{ n: number }[]>(
        `select count(*)::int as n from pos."${t}" where tenant_id = $1`,
        [tenantId],
      );
      counts[t] = n;
    }
    return counts;
  }

  const imageDir = (tenantId: string) =>
    path.join(process.env.POS_STORAGE_DIR!, 'tenants', tenantId);

  /** One store with data in every tenant table, through the real API. */
  async function seededStore(): Promise<Store> {
    const s = await createStore();
    const post = (url: string, body: object, key?: string) => {
      const r = http().post(url).set('Authorization', s.auth);
      if (key) r.set('Idempotency-Key', key);
      return r.send(body);
    };
    const put = (url: string, body: object) =>
      http().put(url).set('Authorization', s.auth).send(body);

    // UMK-2022: a wrong pairing code (device_pairing_attempts), then a device paired by code (device_pairings).
    const pairing = await http().post('/auth/device/pairing').expect(201);
    const code = pairing.body.code as string;
    await post('/staff/devices/pair', {
      code: code === '000000' ? '000001' : '000000',
      name: 'Tablet',
    }).expect(422);
    await post('/staff/devices/pair', { code, name: 'Tablet' }).expect(201);

    const cat = await post('/catalog/categories', { name: 'Minuman' }).expect(
      201,
    );
    const p = await post('/catalog/products', {
      categoryId: cat.body.id,
      name: 'Kopi Susu',
      costPrice: 1000,
      sellingPrice: 6000,
      barcodes: [`899${Math.floor(Math.random() * 1e9)}`],
      // UMK-1985: product_units, product_price_tiers.
      units: [{ name: 'dus', unitQty: 12, price: 66_000 }],
      priceTiers: [{ minQty: 6, price: 5800 }],
    }).expect(201);
    const productId = p.body.id as string;
    await http()
      .post(`/catalog/products/${productId}/images`)
      .set('Authorization', s.auth)
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    await post('/stock/opening', { productId, qty: 50 }).expect(201);
    await put('/sales/settings', { taxBps: 1000 }).expect(200);
    await put('/reports/settings', { timezone: 'UTC' }).expect(200);
    await put('/store/profile', {
      name: 'Toko',
      businessType: 'retail',
      address: 'Jl. 1',
    }).expect(200);
    await http()
      .post('/store/profile/logo')
      .set('Authorization', s.auth)
      .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    await http()
      .post('/store/profile/qris')
      .set('Authorization', s.auth)
      .attach('file', PNG, { filename: 'qris.png', contentType: 'image/png' })
      .expect(201);
    expect(
      readdirSync(path.join(imageDir(s.tenantId), 'store')).filter((f) =>
        f.startsWith('qris-'),
      ),
    ).toHaveLength(1); // the purge below must take it with the rest

    // Staff, role, device, PIN session, a failed PIN attempt.
    const cashier = await createCashier(app, s, ['sales.create']);
    await cashier.signIn('000000').expect(401);

    // Supplier + approved purchase order; stock opname approved.
    const sup = await post('/suppliers', {
      name: 'CV Sumber Rejeki',
      phone: '081234567890',
      address: 'Jl. Pasar 1',
    }).expect(201);
    const po = await post('/purchasing/orders', {
      supplierId: sup.body.id,
      paymentMethod: 'Tunai',
      lines: [{ productId, qty: 10, unitCost: 900 }],
    }).expect(201);
    await post(`/purchasing/orders/${po.body.id}/approve`, {}).expect(200);
    const so = await post('/stock-opnames', {
      note: 'Hitung',
      lines: [{ productId, countedQty: 58 }],
    }).expect(201);
    await post(`/stock-opnames/${so.body.id}/approve`, {}).expect(200);

    // Shift, a cash sale with a voucher, a kasbon sale to a member and a payment on it.
    await post('/shifts/open', { openingCash: 100_000 }).expect(201);
    const v = await post('/vouchers', {
      name: 'Hemat',
      code: `V${Math.random().toString(36).slice(2, 8)}`,
      type: 'percentage',
      nominal: 10,
      kuota: 10,
      startDate: jakartaDay(-1),
      expired: jakartaDay(1),
    }).expect(201);
    await post(
      '/sales',
      {
        lines: [{ productId, qty: 1 }],
        voucherCode: v.body.code,
        paid: 10_000,
      },
      randomUUID(),
    ).expect(201);
    const kasbon = await post('/payment-methods', {
      name: 'Kasbon',
      kind: 'credit',
    }).expect(201);
    const member = await post('/members', {
      name: 'Bu Sari',
      code: `M${Math.random().toString(36).slice(2, 8)}`,
      phone: '081234567890',
    }).expect(201);
    const credit = await post(
      '/sales',
      {
        lines: [{ productId, qty: 1 }],
        memberId: member.body.id,
        paymentMethodId: kasbon.body.id,
        paid: 0,
      },
      randomUUID(),
    ).expect(201);
    await post(
      `/receivables/${credit.body.receivableId}/payments`,
      { amount: 1000 },
      randomUUID(),
    ).expect(201);
    // A cash instalment taken by a collector who cannot open a shift (UMK-1963): store_cash_entries.
    const collector = await createCashier(app, s, ['receivables.manage']);
    await http()
      .post(`/receivables/${credit.body.receivableId}/payments`)
      .set('Authorization', collector.auth)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 500 })
      .expect(201);
    // That cash received into the open drawer (UMK-1924 U3): store_cash_deposits.
    await post(
      '/store-cash/deposits',
      { collectorId: collector.staffId, amount: 500 },
      randomUUID(),
    ).expect(201);
    // Cash put into the drawer by hand (UMK-1924 U3): manual_cash_entries.
    await post(
      '/shifts/current/cash-entries',
      { direction: 'in', amount: 1000, reason: 'tambah_modal' },
      randomUUID(),
    ).expect(201);

    // An expense paid from the drawer (UMK-1984): expenses, and its shift ledger entry.
    const expense = await post(
      '/expenses',
      { amount: 2000, category: 'transport', source: 'drawer' },
      randomUUID(),
    ).expect(201);
    // Its edit history: expense_edits.
    await http()
      .patch(`/expenses/${expense.body.id}`)
      .set('Authorization', s.auth)
      .send({ note: 'ojek' })
      .expect(200);

    // A void PIN and a voided cash sale (UMK-1962): void_pins, sale_voids, sale_void_returns.
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: '482913' })
      .expect(200);
    const voided = await post(
      '/sales',
      { lines: [{ productId, qty: 1 }], paid: 10_000 },
      randomUUID(),
    ).expect(201);
    await post(
      `/sales/${voided.body.id}/void`,
      { reasonCode: 'customer_cancelled', approverId: s.userId, pin: '482913' },
      randomUUID(),
    ).expect(201);
    // UMK-1991: a refusal payment-api gave for that sale (written by the job only with payment-api on).
    await admin`insert into pos.payment_sync_issues (tenant_id, kind, ref_id, attempts, last_error)
      values (${s.tenantId}, 'sale', ${voided.body.id}, 1, 'payment_mismatch')`;
    // UMK-1980: a write UMKMall's agent confirmed (its idempotency record).
    await admin`insert into pos.agent_requests (tenant_id, idempotency_key, tool, request_hash, answer)
      values (${s.tenantId}, ${randomUUID()}, 'create_category', 'h', '{}'::jsonb)`;
    // New Teman AI usage record and the owner's agent revocation.
    await admin`insert into pos.agent_tool_calls (tenant_id, tool, outcome, actor_id, duration_ms)
      values (${s.tenantId}, 'list_categories', 'ok', ${s.userId}, 3)`;
    await admin`insert into pos.agent_access (tenant_id, revoked_before) values (${s.tenantId}, now())`;
    return s;
  }

  it('guard: every pos table except the global ones carries tenant_id', async () => {
    const rows = await admin<{ name: string; has: boolean }[]>`
      select c.relname as name, exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as has
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pos' and c.relkind = 'r'`;
    expect(rows.length).toBeGreaterThan(GLOBAL_TABLES.length);
    expect(
      rows
        .filter((r) => !r.has && !GLOBAL_TABLES.includes(r.name))
        .map((r) => r.name),
    ).toEqual([]);
  });

  it('erases every row and image of one store, leaves another untouched, and frees the users row', async () => {
    const a = await seededStore();
    const b = await seededStore();

    const before = await rowCounts(a.tenantId);
    const empty = Object.entries(before)
      .filter(([, n]) => n === 0)
      .map(([t]) => t);
    expect(empty).toEqual([]); // the seed must reach every tenant table, or this test proves nothing
    expect(existsSync(imageDir(a.tenantId))).toBe(true);
    const bBefore = await rowCounts(b.tenantId);

    await markForDeletion(a.userId);
    await purge({ userId: a.userId }).expect(200, { purged: true });

    const after = await rowCounts(a.tenantId);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from pos.tenants where id = ${a.tenantId}`;
    expect(n).toBe(0);
    expect(existsSync(imageDir(a.tenantId))).toBe(false);

    expect(await rowCounts(b.tenantId)).toEqual(bBefore);
    expect(
      readdirSync(imageDir(b.tenantId), { recursive: true }).length,
    ).toBeGreaterThan(0);
    await http().get('/tenant/me').set('Authorization', b.auth).expect(200);

    // Idempotent: a retry finds nothing.
    await purge({ userId: a.userId }).expect(200, { purged: false });
    // The RESTRICT FK from pos.tenants no longer blocks UMKMall's own delete.
    await admin`delete from public.users where id = ${a.userId}`;
  }, 30_000); // seeds two full stores (PIN hashing included)

  it('answers 503 and keeps every row when the images cannot be deleted; a retry completes it', async () => {
    const s = await createStore();
    const cat = await http()
      .post('/catalog/categories')
      .set('Authorization', s.auth)
      .send({ name: 'Snack' })
      .expect(201);
    const p = await http()
      .post('/catalog/products')
      .set('Authorization', s.auth)
      .send({
        categoryId: cat.body.id,
        name: 'Keripik',
        costPrice: 1,
        sellingPrice: 2,
      })
      .expect(201);
    await http()
      .post(`/catalog/products/${p.body.id}/images`)
      .set('Authorization', s.auth)
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    const dir = imageDir(s.tenantId);
    const sub = path.join(dir, readdirSync(dir)[0]);
    await markForDeletion(s.userId);
    chmodSync(sub, 0o500); // its files cannot be unlinked
    try {
      await purge({ userId: s.userId }).expect(503);
    } finally {
      chmodSync(sub, 0o700);
    }
    expect((await rowCounts(s.tenantId)).products).toBe(1);
    await http().get('/tenant/me').set('Authorization', s.auth).expect(200);

    await purge({ userId: s.userId }).expect(200, { purged: true });
    expect(existsSync(dir)).toBe(false);
  });

  it.each([
    ['flag null', null, 31],
    ['flag archived', 'archived', 31],
    ['to_delete inside the 30-day grace window', 'to_delete', 29],
  ] as const)(
    'refuses with 409 and touches nothing when the account is not erasable (%s)',
    async (_, flag, daysAgo) => {
      const s = await createStore();
      const cat = await http()
        .post('/catalog/categories')
        .set('Authorization', s.auth)
        .send({ name: 'Snack' })
        .expect(201);
      const p = await http()
        .post('/catalog/products')
        .set('Authorization', s.auth)
        .send({
          categoryId: cat.body.id,
          name: 'Keripik',
          costPrice: 1,
          sellingPrice: 2,
        })
        .expect(201);
      await http()
        .post(`/catalog/products/${p.body.id}/images`)
        .set('Authorization', s.auth)
        .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
        .expect(201);
      await markForDeletion(s.userId, flag, daysAgo);

      const res = await purge({ userId: s.userId }).expect(409);
      expect(res.body).toEqual({
        message: 'Akun UMKMall tidak sedang dihapus',
      });
      expect((await rowCounts(s.tenantId)).products).toBe(1);
      expect(readdirSync(imageDir(s.tenantId)).length).toBeGreaterThan(0);
      await http().get('/tenant/me').set('Authorization', s.auth).expect(200);
    },
  );

  it('answers purged:false for a user who never had a store', async () => {
    await purge({ userId: randomUUID() }).expect(200, { purged: false });
  });

  it('refuses a wrong or missing service key with 401 and touches nothing', async () => {
    const s = await createStore();
    const wrong = await purge({ userId: s.userId }, 'x'.repeat(32)).expect(401);
    expect(wrong.body).toEqual({ message: 'Kunci layanan tidak valid' });
    await purge({ userId: s.userId }, null).expect(401);
    await purge({ userId: s.userId }, '').expect(401);
    await http().get('/tenant/me').set('Authorization', s.auth).expect(200);
  });

  it('answers 422 for a bad body', async () => {
    const res = await purge({ userId: 'not-a-uuid' }).expect(422);
    expect(res.body.errors).toHaveProperty('userId');
    await purge({}).expect(422);
  });
});
