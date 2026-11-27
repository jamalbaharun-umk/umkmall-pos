import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { pdfText } from './support/pdf-text';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

// Report PDFs and report visuals (design features 37 and 38): made on the server, from the report services'
// own figures, behind `reports.view`, for the session's tenant only.
describe('report PDFs and visuals', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const get = (auth: string, path: string) =>
    http().get(path).set('Authorization', auth);

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const today = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(
      new Date(),
    );

  const pdf = (auth: string, path: string) =>
    get(auth, path)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  const text = (bytes: Buffer): Promise<string> =>
    Promise.resolve(pdfText(bytes).text);

  async function product(
    store: Store,
    name: string,
    price: number,
    cost: number,
  ) {
    const cat = await http()
      .post('/catalog/categories')
      .set('Authorization', store.auth)
      .send({ name: `Kat ${randomUUID().slice(0, 8)}` })
      .expect(201);
    const p = await http()
      .post('/catalog/products')
      .set('Authorization', store.auth)
      .send({
        categoryId: cat.body.id,
        name,
        costPrice: cost,
        sellingPrice: price,
      })
      .expect(201);
    await http()
      .post('/stock/opening')
      .set('Authorization', store.auth)
      .send({ productId: p.body.id, qty: 100 })
      .expect(201);
    return p.body.id as string;
  }

  const sell = (store: Store, body: object) =>
    http()
      .post('/sales')
      .set('Authorization', store.auth)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(201);

  /**
   * The known sales of reports.e2e-spec: 3 × Es Teh 5.000 (cost 3.000); 2 × Kopi 8.000 (cost 4.000, discount 1.000);
   * then tax 10%: Es Teh + Kopi. Revenue 44.300, tax 1.300 → sales without tax 43.000, cost 24.000, gross profit
   * 19.000; plus an expense of Rp100.000 → net profit −81.000.
   */
  async function knownStore(name = 'Warung Bu Sari') {
    const store = await createStore();
    await http()
      .put('/store/profile')
      .set('Authorization', store.auth)
      .send({
        name,
        businessType: 'retail',
        address: 'Jl. Melati No. 12, Bandung',
      })
      .expect(200);
    const teh = await product(store, 'Es Teh', 5000, 3000);
    const kopi = await product(store, 'Kopi Susu', 8000, 4000);
    await http()
      .post('/shifts/open')
      .set('Authorization', store.auth)
      .send({ openingCash: 100_000 })
      .expect(201);
    await sell(store, { lines: [{ productId: teh, qty: 3 }], paid: 15_000 });
    await sell(store, {
      lines: [{ productId: kopi, qty: 2 }],
      discount: 1000,
      paid: 15_000,
    });
    await http()
      .put('/sales/settings')
      .set('Authorization', store.auth)
      .send({ taxBps: 1000 })
      .expect(200);
    await sell(store, {
      lines: [
        { productId: teh, qty: 1 },
        { productId: kopi, qty: 1 },
      ],
      paid: 14_300,
    });
    await http()
      .post('/expenses')
      .set('Authorization', store.auth)
      .set('Idempotency-Key', randomUUID())
      .send({
        category: 'sewa',
        amount: 100_000,
        source: 'outside',
        note: 'Sewa kios',
      })
      .expect(201);
    return store;
  }

  type Trend = {
    buckets: Array<{ key: string; sales: number; expenses: number }>;
    visual: { series: Array<{ label: string }> };
    to: string;
  };
  type Bars = {
    categories: string[];
    series: Array<{ values: number[] }>;
    parts: Array<{ value: number }>;
  };
  const trendOf = (r: { body: unknown }) => r.body as Trend;
  const visualsOf = (r: { body: unknown }) =>
    (r.body as { visuals: Bars[] }).visuals;

  const range = () => `from=${today()}&to=${today()}`;

  describe('Penjualan dan pengeluaran (feature 37)', () => {
    it('answers buckets, window totals and the change from the period before, from the profit and loss figures', async () => {
      const s = await knownStore();
      const r = await get(s.auth, '/reports/sales-expenses?scale=day').expect(
        200,
      );
      expect(r.body).toMatchObject({
        scale: 'day',
        count: 7,
        to: today(),
        partialLast: false,
      });
      expect(trendOf(r).buckets).toHaveLength(7);
      expect(trendOf(r).buckets.at(-1)).toMatchObject({
        key: today(),
        sales: 43_000,
        expenses: 100_000,
      });
      expect(
        trendOf(r)
          .buckets.slice(0, 6)
          .every(
            (b: { sales: number; expenses: number }) =>
              b.sales === 0 && b.expenses === 0,
          ),
      ).toBe(true);
      expect(r.body.totals).toEqual({
        sales: 43_000,
        cost: 24_000,
        grossProfit: 19_000,
        shrinkage: 0,
        expenses: 100_000,
        netProfit: -81_000,
        tax: 1300,
      });
      expect(r.body.change).toEqual({ sales: null, expenses: null });
      // One source: the profit and loss report of the same window says the same.
      const pl = await get(
        s.auth,
        `/reports/profit-loss?from=${r.body.from}&to=${r.body.to}`,
      ).expect(200);
      expect(pl.body.current).toMatchObject({
        revenue: 43_000,
        grossProfit: 19_000,
        expenses: 100_000,
        netProfit: -81_000,
        tax: 1300,
      });
      expect(r.body.visual).toMatchObject({
        kind: 'bars',
        orientation: 'vertical',
        unit: 'rupiah',
      });
      expect(
        trendOf(r).visual.series.map((x: { label: string }) => x.label),
      ).toEqual(['Penjualan', 'Pengeluaran']);
    });

    it('buckets by month and year, the last one still running', async () => {
      const s = await knownStore();
      const m = await get(s.auth, '/reports/sales-expenses?scale=month').expect(
        200,
      );
      expect(m.body.count).toBe(6);
      expect(trendOf(m).buckets.at(-1)).toMatchObject({
        sales: 43_000,
        expenses: 100_000,
      });
      const y = await get(s.auth, '/reports/sales-expenses?scale=year').expect(
        200,
      );
      expect(trendOf(y).buckets).toHaveLength(3);
      expect(trendOf(y).buckets.at(-1)).toMatchObject({
        key: `${today().slice(0, 4)}-01-01`,
        sales: 43_000,
      });
      expect(y.body.to).toBe(today());
    });

    it('refuses a window longer than the scale allows, in the words of the error dialog', async () => {
      const s = await createStore();
      for (const [scale, count] of [
        ['day', 93],
        ['month', 37],
        ['year', 11],
      ] as const) {
        for (const path of ['sales-expenses', 'sales-expenses/pdf']) {
          const r = await get(
            s.auth,
            `/reports/${path}?scale=${scale}&count=${count}`,
          ).expect(422);
          expect(r.body.code).toBe('EXPORT_RANGE_TOO_LARGE');
          expect(r.body.message).toMatch(/terlalu panjang untuk satu PDF/);
        }
      }
      await get(s.auth, '/reports/sales-expenses?scale=day&count=92').expect(
        200,
      );
      await get(s.auth, '/reports/sales-expenses?scale=week').expect(422);
      await get(s.auth, '/reports/sales-expenses?to=2026-02-30').expect(422);
      await get(s.auth, '/reports/sales-expenses/pdf?include=foo').expect(422);
    });

    it('makes a PDF with the store header, the figures, the chart and a footer with page numbers', async () => {
      const s = await knownStore();
      const res = await pdf(
        s.auth,
        '/reports/sales-expenses/pdf?scale=day',
      ).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="laporan-penjualan-pengeluaran-harian-.*\.pdf"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      const bytes = res.body as Buffer;
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
      const t = await text(bytes);
      for (const part of [
        'Warung Bu Sari',
        'Jl. Melati No. 12, Bandung',
        'Laporan penjualan dan pengeluaran',
        'Harian',
        'Rp43.000',
        'Rp24.000',
        'Rp19.000',
        'Rp100.000',
        '−Rp81.000',
        'Rp1.300',
        'Pajak dikumpulkan',
        'Penjualan dan pengeluaran per hari',
        'Rp100 rb',
        'Rincian per hari',
        'Total',
        'Dicetak',
        'oleh Pemilik',
        'Halaman 1 dari 1',
      ])
        expect(t).toContain(part);
      // Money is whole rupiah: no cents anywhere (the axis says "Rp100 rb", never "Rp1,50").
      expect(t).not.toMatch(/Rp\d+,\d{2}(?!\d| jt| rb)/);
    });

    it('prints only what the dialog ticked', async () => {
      const s = await knownStore();
      const only = async (include: string) =>
        text(
          (
            await pdf(
              s.auth,
              `/reports/sales-expenses/pdf?include=${include}`,
            ).expect(200)
          ).body as Buffer,
        );
      const chart = await only('chart');
      expect(chart).toContain('Penjualan dan pengeluaran per hari');
      expect(chart).not.toContain('Rincian per hari');
      expect(chart).not.toContain('Modal barang terjual');
      const table = await only('table');
      expect(table).toContain('Rincian per hari');
      expect(table).not.toContain('Rp100 rb');
      const summary = await only('summary');
      expect(summary).toContain('Modal barang terjual');
      expect(summary).not.toContain('Rincian per hari');
    });

    it('says so when there is nothing to show, and still makes a valid PDF', async () => {
      const s = await createStore();
      const res = await pdf(
        s.auth,
        '/reports/sales-expenses/pdf?scale=month',
      ).expect(200);
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      const t = await text(res.body as Buffer);
      expect(t).toContain(
        'Belum ada penjualan atau pengeluaran di periode ini.',
      );
      expect(t).toContain('Rp0');
    });
  });

  describe('every report PDF', () => {
    it('carries the report’s own figures, the header and the footer', async () => {
      const s = await knownStore();
      const cases: Array<[string, string[]]> = [
        [
          '/reports/pdf/sales?' + range(),
          [
            'Laporan penjualan',
            'Es Teh',
            'Kopi Susu',
            'Rp44.300',
            'Rp19.000',
            'Rp24.000',
            'Tren harian',
            'Cara bayar',
            'Produk terlaris',
          ],
        ],
        [
          '/reports/pdf/products?' + range(),
          ['Laporan produk', 'Es Teh', 'Rp44.300', 'Penjualan per produk'],
        ],
        [
          '/reports/pdf/shifts?' + range(),
          ['Laporan kasir', 'Pemilik', 'Pendapatan per shift', 'Rp44.300'],
        ],
        [
          '/reports/pdf/purchasing?' + range(),
          ['Laporan pembelian', 'Belum ada data pada rentang ini.'],
        ],
        [
          '/reports/pdf/profit-loss?period=today',
          [
            'Laporan untung rugi',
            'Rp43.000',
            'Rp19.000',
            'Rp100.000',
            '−Rp81.000',
            'Dari hasil jualan ke untung bersih',
            'Pengeluaran: Sewa',
          ],
        ],
        [
          '/reports/pdf/receivables',
          [
            'Laporan kasbon',
            'Total piutang',
            'Belum ada kasbon yang belum lunas.',
          ],
        ],
      ];
      for (const [path, expected] of cases) {
        const res = await pdf(s.auth, path).expect(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        const bytes = res.body as Buffer;
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
        const t = await text(bytes);
        for (const part of [
          'Warung Bu Sari',
          'Dicetak',
          'oleh Pemilik · UMKMall POS',
          'Halaman 1 dari',
          ...expected,
        ])
          expect([path, t.includes(part) ? part : `MISSING ${part}`]).toEqual([
            path,
            part,
          ]);
      }
    });

    it('prints no customer phone number, and the cashier’s name when a cashier prints it', async () => {
      const s = await knownStore();
      const cashier = await createCashier(app, s, ['reports.view']);
      const t = await text(
        (await pdf(cashier.auth, '/reports/pdf/sales?' + range()).expect(200))
          .body as Buffer,
      );
      expect(t).toContain('oleh Sari');
      expect(t).not.toMatch(/\+?62\d{8,}|08\d{8,}/);
    });

    it('refuses a bad range with the field messages, never a 500', async () => {
      const s = await createStore();
      const r = await get(
        s.auth,
        '/reports/pdf/sales?from=2026-02-30&to=2026-03-01',
      ).expect(422);
      expect(r.body.errors.from).toBeDefined();
      await get(
        s.auth,
        '/reports/pdf/sales?from=2026-01-01&to=2027-06-01',
      ).expect(422);
      await get(s.auth, '/reports/pdf/profit-loss?period=decade').expect(422);
      await get(s.auth, '/reports/pdf/receivables?filter=x').expect(422);
    });
  });

  describe('visuals (feature 38)', () => {
    it('sales: a trend, the payment methods and the best sellers, adding up to the report', async () => {
      const s = await knownStore();
      const r = await get(s.auth, `/reports/visuals/sales?${range()}`).expect(
        200,
      );
      const [trend, pay, best] = visualsOf(r);
      expect(trend).toMatchObject({
        id: 'tren-harian',
        kind: 'bars',
        orientation: 'vertical',
      });
      expect(
        trend.series[0].values.reduce((a: number, b: number) => a + b, 0),
      ).toBe(43_000);
      expect(pay).toMatchObject({ id: 'cara-bayar', kind: 'segments' });
      // What customers paid, tax included: the report's revenue.
      expect(
        pay.parts.reduce((a: number, p: { value: number }) => a + p.value, 0),
      ).toBe(44_300);
      expect(best).toMatchObject({
        id: 'produk-terlaris',
        unit: 'count',
        orientation: 'horizontal',
      });
      expect(best.categories[0]).toBe('Es Teh');
      expect(best.series[0].values).toEqual([4, 3]);
    });

    it('profit and loss: the bridge from sales to net profit', async () => {
      const s = await knownStore();
      const r = await get(
        s.auth,
        '/reports/visuals/profit-loss?period=today',
      ).expect(200);
      const [bridge, spent] = visualsOf(r);
      expect(bridge.categories).toEqual([
        'Hasil jualan',
        'Modal barang',
        'Untung kotor',
        'Susut stok',
        'Pengeluaran',
        'Untung bersih',
      ]);
      expect(bridge.series[0].values).toEqual([
        43_000, -24_000, 19_000, 0, -100_000, -81_000,
      ]);
      expect(spent.categories).toEqual(['Sewa']);
      expect(spent.series[0].values).toEqual([100_000]);
    });

    it('kasbon, products, shifts and purchasing answer, empty where there is nothing', async () => {
      const s = await knownStore();
      const k = await get(s.auth, '/reports/visuals/receivables').expect(200);
      expect(visualsOf(k)[0]).toMatchObject({
        id: 'umur-piutang',
        palette: 'sequential',
      });
      expect(
        visualsOf(k)[0].parts.map((p: { value: number }) => p.value),
      ).toEqual([0, 0, 0, 0]);
      const p = await get(
        s.auth,
        `/reports/visuals/products?${range()}`,
      ).expect(200);
      expect(visualsOf(p)[0].categories).toEqual(['Kopi Susu', 'Es Teh']);
      const sh = await get(s.auth, `/reports/visuals/shifts?${range()}`).expect(
        200,
      );
      expect(visualsOf(sh)[0].series[0].values).toEqual([44_300]);
      const pu = await get(
        s.auth,
        `/reports/visuals/purchasing?${range()}`,
      ).expect(200);
      expect(visualsOf(pu)[0].categories).toEqual([]);
    });
  });

  describe('permission and tenant', () => {
    const paths = () => [
      '/reports/sales-expenses',
      '/reports/sales-expenses/pdf',
      `/reports/visuals/sales?${range()}`,
      `/reports/visuals/products?${range()}`,
      `/reports/visuals/shifts?${range()}`,
      `/reports/visuals/purchasing?${range()}`,
      '/reports/visuals/profit-loss?period=today',
      '/reports/visuals/receivables',
      `/reports/pdf/sales?${range()}`,
      `/reports/pdf/products?${range()}`,
      `/reports/pdf/shifts?${range()}`,
      `/reports/pdf/purchasing?${range()}`,
      '/reports/pdf/profit-loss?period=today',
      '/reports/pdf/receivables',
    ];

    it('403 without reports.view, 401 without a session, 200 with it', async () => {
      const s = await createStore();
      const without = await createCashier(app, s, ['sales.create']);
      const withView = await createCashier(app, s, ['reports.view']);
      for (const p of paths()) {
        expect([p, (await get(without.auth, p)).status]).toEqual([p, 403]);
        expect([p, (await http().get(p)).status]).toEqual([p, 401]);
        expect([p, (await get(withView.auth, p)).status]).toEqual([p, 200]);
      }
    });

    it('store B sees only its own figures and its own name, never store A’s', async () => {
      const a = await knownStore('Toko A Makmur');
      const b = await knownStore('Toko B Sentosa');
      // B sells nothing more; A adds a distinctive product and sells it.
      const gula = await product(a, 'Gula Pasir Istimewa', 12_500, 9000);
      await sell(a, { lines: [{ productId: gula, qty: 2 }], paid: 30_000 });
      const aSales = await get(
        a.auth,
        `/reports/visuals/products?${range()}`,
      ).expect(200);
      expect(aSales.body.visuals[0].categories).toContain(
        'Gula Pasir Istimewa',
      );
      const bSales = await get(
        b.auth,
        `/reports/visuals/products?${range()}`,
      ).expect(200);
      expect(bSales.body.visuals[0].categories).not.toContain(
        'Gula Pasir Istimewa',
      );
      const bPdf = await text(
        (await pdf(b.auth, `/reports/pdf/sales?${range()}`).expect(200))
          .body as Buffer,
      );
      expect(bPdf).toContain('Toko B Sentosa');
      expect(bPdf).not.toContain('Toko A Makmur');
      expect(bPdf).not.toContain('Gula Pasir Istimewa');
      const bTrend = await get(b.auth, '/reports/sales-expenses').expect(200);
      expect(bTrend.body.totals.sales).toBe(43_000);
      const aTrend = await get(a.auth, '/reports/sales-expenses').expect(200);
      expect(aTrend.body.totals.sales).toBe(43_000 + 25_000);
      // A tenant id in the query is ignored: the session decides.
      const forged = await get(
        b.auth,
        `/reports/sales-expenses?tenantId=${a.tenantId}`,
      ).expect(200);
      expect(forged.body.totals.sales).toBe(43_000);
    });
  });
});
