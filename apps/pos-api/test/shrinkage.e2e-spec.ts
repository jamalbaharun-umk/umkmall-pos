import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { pdfText } from './support/pdf-text';

const OWNER_PIN = '482913';
/** A store day in Asia/Jakarta (the default report timezone), `offset` days from today. */
const day = (offset = 0) =>
  new Date(Date.now() + 7 * 3_600_000 + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);

/**
 * UMK-2072, owner ruling 2026-11-26: units an approved stock opname took out ("Susut stok") reduce profit at the
 * cost of the batches they came from, as their own line between gross profit and net profit; a surplus is netted
 * against it within the period, never below 0 (ruling on PR 72); dated by the opname's approval in the store's
 * timezone.
 *
 * The store (tax 0): Teh Rp5.000 (10 at cost 3.000), Kopi (2 at cost 2.000, then a purchase of 5 at 2.500), Gula
 * (10 at cost 1.000). Teh 2 sold → revenue 10.000, cost 6.000, gross profit 4.000; a Kopi sold and voided the same
 * day nets to 0. Expense Rp1.000. Opname: Teh 8 → 6 (−2 × 3.000 = 6.000), Kopi 7 → 4 (FIFO: 2 × 2.000 + 1 × 2.500 =
 * 6.500), Gula 10 → 15 (+5 × 1.000 = 5.000 surplus). Shrinkage 12.500 − 5.000 = 7.500; net profit 4.000 − 7.500 −
 * 1.000 = −4.500.
 */
describe('stock shrinkage in profit and loss (UMK-2072)', () => {
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

  const post = (auth: string, url: string, body: object = {}) =>
    http()
      .post(url)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);

  async function shop() {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Toko',
    }).expect(201);
    const product = async (
      name: string,
      sellingPrice: number,
      costPrice: number,
      qty: number,
    ) => {
      const p = await post(s.auth, '/catalog/products', {
        categoryId: cat.body.id,
        name,
        sellingPrice,
        costPrice,
      }).expect(201);
      await post(s.auth, '/stock/opening', {
        productId: p.body.id,
        qty,
        unitCost: costPrice,
      }).expect(201);
      return p.body.id as string;
    };
    const teh = await product('Teh Botol', 5000, 3000, 10);
    const kopi = await product('Kopi Bubuk', 4000, 2000, 2);
    const gula = await product('Gula 1kg', 15_000, 1000, 10);
    const supplier = await post(s.auth, '/suppliers', {
      name: 'CV Sumber Rejeki',
      phone: '081234567890',
      address: 'Jl. Pasar 1',
    }).expect(201);
    const order = await post(s.auth, '/purchasing/orders', {
      supplierId: supplier.body.id,
      paymentMethod: 'Tunai',
      lines: [{ productId: kopi, qty: 5, unitCost: 2500 }],
    }).expect(201);
    await post(s.auth, `/purchasing/orders/${order.body.id}/approve`).expect(
      200,
    );
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: OWNER_PIN })
      .expect(200);
    await post(s.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    return { ...s, teh, kopi, gula };
  }
  type Shop = Awaited<ReturnType<typeof shop>>;

  const opname = async (
    s: Shop,
    lines: { productId: string; countedQty: number }[],
    approve = true,
  ) => {
    const o = await post(s.auth, '/stock-opnames', { lines }).expect(201);
    if (approve)
      await post(s.auth, `/stock-opnames/${o.body.id}/approve`).expect(200);
    return o.body.id as string;
  };
  const profitLoss = async (s: { auth: string }, q = '') =>
    (await get(s.auth, `/reports/profit-loss${q}`).expect(200)).body as {
      labels: Record<string, string>;
      current: Record<string, number>;
      previous: Record<string, number>;
    };

  /** The day's trade: Teh 2 sold, a Kopi sold and voided, a Rp1.000 expense. */
  async function trade(s: Shop) {
    await post(s.auth, '/sales', {
      lines: [{ productId: s.teh, qty: 2 }],
      paid: 10_000,
    }).expect(201);
    const kopiSale = await post(s.auth, '/sales', {
      lines: [{ productId: s.kopi, qty: 1 }],
      paid: 4000,
    }).expect(201);
    await post(s.auth, `/sales/${kopiSale.body.id}/void`, {
      reasonCode: 'wrong_item_or_qty',
      approverId: s.userId,
      pin: OWNER_PIN,
    }).expect(201);
    await post(s.auth, '/expenses', {
      amount: 1000,
      category: 'transport',
      source: 'outside',
    }).expect(201);
  }

  it('an approved opname takes the batch cost of the missing units, less the surplus, off net profit, not gross profit; CSV and dashboard agree', async () => {
    const s = await shop();
    await trade(s);
    const before = await profitLoss(s);
    expect(before.current).toMatchObject({
      revenue: 10_000,
      cost: 6000,
      grossProfit: 4000,
      shrinkage: 0,
      expenses: 1000,
      netProfit: 3000,
    });
    // A draft counts nothing.
    await opname(s, [{ productId: s.teh, countedQty: 0 }], false);
    expect((await profitLoss(s)).current.shrinkage).toBe(0);

    await opname(s, [
      { productId: s.teh, countedQty: 6 },
      { productId: s.kopi, countedQty: 4 },
      { productId: s.gula, countedQty: 15 },
    ]);
    const pl = await profitLoss(s);
    expect(pl.labels.shrinkage).toBe('Susut stok (selisih stok opname)');
    expect(pl.current).toMatchObject({
      revenue: 10_000,
      cost: 6000,
      grossProfit: 4000,
      shrinkage: 7500,
      expenses: 1000,
      netProfit: -4500,
    });
    const csv = await get(s.auth, '/reports/profit-loss/csv').expect(200);
    const rows = csv.text.split('\r\n');
    const at = (label: string) => rows.findIndex((r) => r.startsWith(label));
    expect(rows[at('Susut stok')]).toBe(
      'Susut stok (selisih stok opname),7500,0',
    );
    // Between gross profit and expenses.
    expect(at('Untung kotor')).toBe(at('Susut stok') - 1);
    expect(at('Pengeluaran,')).toBe(at('Susut stok') + 1);
    expect(rows[at('Untung bersih')]).toBe(
      'Untung bersih (tanpa pajak),-4500,0',
    );
    // The dashboard shows gross profit: the same number, the opname not in it.
    const dash = await get(s.auth, '/reports/dashboard?period=today').expect(
      200,
    );
    expect(dash.body.current.grossProfit).toBe(4000);
  });

  it('the sales and expenses report, the profit bridge and the PDF carry the shrinkage, so net profit equals the profit and loss', async () => {
    const s = await shop();
    await trade(s);
    await opname(s, [
      { productId: s.teh, countedQty: 6 },
      { productId: s.kopi, countedQty: 4 },
      { productId: s.gula, countedQty: 15 },
    ]);
    const pl = await profitLoss(s, `?from=${day()}&to=${day()}`);
    expect(pl.current).toMatchObject({ shrinkage: 7500, netProfit: -4500 });
    const trend = await get(
      s.auth,
      `/reports/sales-expenses?scale=day&to=${day()}`,
    ).expect(200);
    expect(trend.body.totals).toMatchObject({
      grossProfit: 4000,
      shrinkage: 7500,
      expenses: 1000,
      netProfit: -4500,
    });
    const bridge = await get(
      s.auth,
      `/reports/visuals/profit-loss?from=${day()}&to=${day()}`,
    ).expect(200);
    const b = (bridge.body.visuals ?? bridge.body)[0];
    expect(b.categories).toContain('Susut stok');
    expect(b.series[0].values).toEqual([
      10_000, -6000, 4000, -7500, -1000, -4500,
    ]);
    const pdf = await get(s.auth, `/reports/pdf/profit-loss?period=today`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const text = pdfText(pdf.body as Buffer).text;
    expect(text).toContain('Susut stok');
    expect(text).toContain('Rp7.500');
  });

  it("dated by the opname's approval in the store's timezone: an opname approved yesterday is yesterday's", async () => {
    const s = await shop();
    const id = await opname(s, [{ productId: s.teh, countedQty: 9 }]);
    await admin`update pos.stock_opnames set approved_at = now() - interval '1 day' where id = ${id}`;
    await opname(s, [{ productId: s.gula, countedQty: 7 }]);
    expect((await profitLoss(s)).current.shrinkage).toBe(3000);
    const yesterday = await profitLoss(s, `?from=${day(-1)}&to=${day(-1)}`);
    expect(yesterday.current).toMatchObject({
      shrinkage: 3000,
      netProfit: -3000,
    });
    const both = await profitLoss(s, `?from=${day(-1)}&to=${day()}`);
    expect(both.current.shrinkage).toBe(6000);
    // The store's timezone decides the day: in UTC−11 "today" may be another date, but the sum over both days holds.
    await http()
      .put('/reports/settings')
      .set('Authorization', s.auth)
      .send({ timezone: 'Pacific/Pago_Pago' })
      .expect(200);
    const wide = await profitLoss(s, `?from=${day(-2)}&to=${day(1)}`);
    expect(wide.current.shrinkage).toBe(6000);
  });

  it('a surplus larger than the shrinkage of the period leaves Rp0, never a gain; another period keeps its own', async () => {
    const s = await shop();
    // Teh 10 → 9 (−1 × 3.000) and Gula 10 → 20 (+10 × 1.000 = 10.000) in one opname: max(0, 3.000 − 10.000) = 0.
    await opname(s, [
      { productId: s.teh, countedQty: 9 },
      { productId: s.gula, countedQty: 20 },
    ]);
    expect((await profitLoss(s)).current).toMatchObject({
      grossProfit: 0,
      shrinkage: 0,
      netProfit: 0,
    });
    // A shrinkage yesterday is not netted with today's surplus. Kopi 7 → 5: FIFO 2 × 2.000 = 4.000.
    const id = await opname(s, [{ productId: s.kopi, countedQty: 5 }]);
    await admin`update pos.stock_opnames set approved_at = now() - interval '1 day' where id = ${id}`;
    expect(
      (await profitLoss(s, `?from=${day(-1)}&to=${day(-1)}`)).current.shrinkage,
    ).toBe(4000);
    expect((await profitLoss(s)).current.shrinkage).toBe(0);
  });

  it("cross-tenant: store B's report holds none of store A's shrinkage", async () => {
    const a = await shop();
    await opname(a, [{ productId: a.teh, countedQty: 0 }]);
    expect((await profitLoss(a)).current.shrinkage).toBe(30_000);
    const b = await createStore();
    const pl = await profitLoss(b);
    expect(pl.current).toMatchObject({ shrinkage: 0, netProfit: 0 });
  });
});
