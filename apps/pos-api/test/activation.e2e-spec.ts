import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { activationReport } from '../src/onboarding/activation';
import { ADMIN_DATABASE_URL, APP_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';

type Store = Awaited<ReturnType<typeof createStore>>;

/**
 * UMK-2131 activation metrics: per store, no personal data. Each store's history is built through the API, then
 * moved back in time with the admin role (creation, sales' paid_at, products' created_at / cost_set_at).
 */
describe('activation metrics (UMK-2131)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  const appDb = postgres(APP_DATABASE_URL, { max: 1 });
  const http = () => request(app.getHttpServer());
  const post = (auth: string, path: string, body: object) =>
    http()
      .post(path)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
    await appDb.end();
  });

  const product = async (s: Store, cost: number) => {
    const cat = await post(s.auth, '/catalog/categories', {
      name: `K${randomUUID().slice(0, 6)}`,
    }).expect(201);
    return (
      await post(s.auth, '/catalog/products', {
        categoryId: cat.body.id,
        name: `P${randomUUID().slice(0, 6)}`,
        costPrice: cost,
        sellingPrice: 1000,
        type: 'service',
      }).expect(201)
    ).body.id as string;
  };
  const sell = async (s: Store, productId: string) =>
    (
      await post(s.auth, '/sales', {
        lines: [{ productId, qty: 1 }],
        paid: 1000,
      }).expect(201)
    ).body.id as string;

  it('the trigger stamps cost_set_at when a cost first goes above 0, keeps it, and clears it at 0', async () => {
    const s = await createStore();
    const id = await product(s, 0);
    const at = async () =>
      (
        await admin<{ at: Date | null }[]>`
          select cost_set_at as at from pos.products where id = ${id}`
      )[0].at;
    expect(await at()).toBeNull();
    const patch = (costPrice: number) =>
      http()
        .patch(`/catalog/products/${id}`)
        .set('Authorization', s.auth)
        .send({ costPrice })
        .expect(200);
    await patch(500);
    const first = await at();
    expect(first).not.toBeNull();
    await patch(700);
    expect(await at()).toEqual(first);
    await patch(0);
    expect(await at()).toBeNull();
  });

  it('per store: minutes to first sale, sales days in week one, day-7 cost share; null while a window is open', async () => {
    // Store "old": created 10 days ago; first sale 3 minutes after creation; sales on store days 0, 0, 2 and 9
    // (day 9 is outside week one); 4 products live on day 7: 3 with a cost by then, one costed only on day 8,
    // plus one created on day 8 (not counted) and one deleted on day 5 (not counted). Share 3/4 = 75%.
    const old = await createStore();
    await post(old.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    const costed = [
      await product(old, 100),
      await product(old, 100),
      await product(old, 100),
    ];
    const late = await product(old, 0);
    const newer = await product(old, 100);
    const gone = await product(old, 100);
    const sales = [
      await sell(old, costed[0]),
      await sell(old, costed[0]),
      await sell(old, costed[0]),
      await sell(old, costed[0]),
    ];
    await http()
      .patch(`/catalog/products/${late}`)
      .set('Authorization', old.auth)
      .send({ costPrice: 50 })
      .expect(200);
    const created = await admin<{ at: Date }[]>`
      update pos.tenants set created_at = date_trunc('second', now()) - interval '10 days' where id = ${old.tenantId} returning created_at as at`;
    const t0 = created[0].at;
    const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
    const day = 24 * 60;
    for (const [i, m] of [3, 60, 2 * day + 5, 9 * day].entries())
      await admin`update pos.sales set paid_at = ${at(m)} where id = ${sales[i]}`;
    await admin`update pos.products set created_at = ${at(1)} where tenant_id = ${old.tenantId}`;
    await admin`update pos.products set created_at = ${at(8 * day)} where id = ${newer}`;
    await admin`update pos.products set deleted_at = ${at(5 * day)} where id = ${gone}`;
    await admin`update pos.products set cost_set_at = ${at(2)} where id = any(${[...costed, newer, gone]})`;
    await admin`update pos.products set cost_set_at = ${at(8 * day)} where id = ${late}`;

    // Store "young": 2 days old, one sale; week-one figures stay null.
    const young = await createStore();
    await post(young.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    const yp = await product(young, 0);
    await sell(young, yp);
    await admin`update pos.tenants set created_at = now() - interval '2 days' where id = ${young.tenantId}`;

    // Store "idle": no sale at all.
    await createStore();

    const report = await activationReport(appDb);
    // No personal data: only these four figures per store, never an id.
    for (const row of report.stores)
      expect(Object.keys(row).sort()).toEqual([
        'ageDays',
        'costSharePercentDay7',
        'minutesToFirstSale',
        'salesDaysFirstWeek',
      ]);
    expect(JSON.stringify(report)).not.toContain(old.tenantId);
    expect(JSON.stringify(report)).not.toContain(old.userId);
    expect(report.stores).toContainEqual({
      ageDays: 10,
      minutesToFirstSale: 3,
      salesDaysFirstWeek: 2,
      costSharePercentDay7: 75,
    });
    expect(report.stores).toContainEqual(
      expect.objectContaining({
        ageDays: 2,
        salesDaysFirstWeek: null,
        costSharePercentDay7: null,
      }),
    );
    expect(report.firstSaleWithin5Minutes).toBeGreaterThanOrEqual(1);
    expect(report.stores).toContainEqual({
      ageDays: 0,
      minutesToFirstSale: null,
      salesDaysFirstWeek: null,
      costSharePercentDay7: null,
    });
  });
});
