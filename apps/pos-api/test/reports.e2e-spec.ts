import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

describe('reports and dashboard (U5)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const get = (store: { auth: string }, path: string) =>
    http().get(path).set('Authorization', store.auth);

  async function product(
    store: Store,
    name: string,
    sellingPrice: number,
    costPrice: number,
  ) {
    const cat = await http()
      .post('/catalog/categories')
      .set('Authorization', store.auth)
      .send({ name: `Kat ${randomUUID().slice(0, 8)}` })
      .expect(201);
    const p = await http()
      .post('/catalog/products')
      .set('Authorization', store.auth)
      .send({ categoryId: cat.body.id, name, costPrice, sellingPrice })
      .expect(201);
    await http()
      .post('/stock/opening')
      .set('Authorization', store.auth)
      .send({ productId: p.body.id, qty: 100 })
      .expect(201);
    return p.body.id as string;
  }

  const openShift = (store: Store) =>
    http()
      .post('/shifts/open')
      .set('Authorization', store.auth)
      .send({ openingCash: 100_000 })
      .expect(201);

  const sell = async (store: Store, body: object) =>
    (
      await http()
        .post('/sales')
        .set('Authorization', store.auth)
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(201)
    ).body as { id: string; total: number };

  /**
   * Known sales: (1) 3 × Es Teh Rp5.000/cost 3.000; (2) 2 × Kopi Rp8.000/cost 4.000 with discount Rp1.000;
   * (3) tax 10%: 1 × Es Teh + 1 × Kopi. Revenue 44.300, tax 1.300, cost 24.000 → gross profit 19.000.
   */
  async function knownSalesStore() {
    const store = await createStore();
    const teh = await product(store, 'Es Teh', 5000, 3000);
    const kopi = await product(store, 'Kopi Susu', 8000, 4000);
    await openShift(store);
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
    return { store, teh, kopi };
  }

  const KNOWN = {
    salesCount: 3,
    grossSales: 44_000,
    discount: 1000,
    tax: 1300,
    revenue: 44_300,
    cost: 24_000,
    grossProfit: 19_000,
  };

  const today = (tz = 'Asia/Jakarta') =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

  it('slice check: after a 3 × Rp5.000 sale with cost Rp3.000, revenue Rp15.000 and profit Rp6.000', async () => {
    const store = await createStore();
    const teh = await product(store, 'Es Teh', 5000, 3000);
    await openShift(store);
    await sell(store, { lines: [{ productId: teh, qty: 3 }], paid: 20_000 });
    const res = await get(store, '/reports/dashboard?period=today').expect(200);
    expect(res.body.current).toMatchObject({
      revenue: 15_000,
      grossProfit: 6000,
      salesCount: 1,
      cost: 9000,
    });
  });

  it('dashboard metrics are exact and keep their names (revenue ≠ profit)', async () => {
    const { store } = await knownSalesStore();
    for (const period of ['today', 'week', 'month', 'year']) {
      const res = await get(
        store,
        `/reports/dashboard?period=${period}`,
      ).expect(200);
      expect(res.body).toMatchObject({
        period,
        timezone: 'Asia/Jakarta',
        to: today(),
      });
      expect(res.body.current).toEqual(KNOWN);
      expect(res.body.previous).toEqual({
        ...KNOWN,
        salesCount: 0,
        grossSales: 0,
        discount: 0,
        tax: 0,
        revenue: 0,
        cost: 0,
        grossProfit: 0,
      });
    }
    expect(KNOWN.revenue).not.toBe(KNOWN.grossProfit);
  });

  it('a sale exactly one period back counts as previous, not current', async () => {
    const store = await createStore();
    const teh = await product(store, 'Es Teh', 5000, 3000);
    await openShift(store);
    await sell(store, { lines: [{ productId: teh, qty: 1 }], paid: 5000 });
    const old = await sell(store, {
      lines: [{ productId: teh, qty: 2 }],
      paid: 10_000,
    });
    await admin`update pos.sales set created_at = created_at - interval '1 week' where id = ${old.id}`;
    const res = await get(store, '/reports/dashboard?period=week').expect(200);
    expect(res.body.current).toMatchObject({
      salesCount: 1,
      revenue: 5000,
      grossProfit: 2000,
    });
    expect(res.body.previous).toMatchObject({
      salesCount: 1,
      revenue: 10_000,
      grossProfit: 4000,
    });
  });

  it('uses the store timezone for day boundaries', async () => {
    const store = await createStore();
    const teh = await product(store, 'Es Teh', 5000, 3000);
    await openShift(store);
    const s = await sell(store, {
      lines: [{ productId: teh, qty: 1 }],
      paid: 5000,
    });
    // 00:30 WIB on 11 Nov = 17:30 UTC on 10 Nov.
    await admin`update pos.sales set created_at = '2026-11-10T17:30:00Z' where id = ${s.id}`;
    const day = (d: string) =>
      get(store, `/reports/sales?from=${d}&to=${d}`).expect(200);

    expect((await day('2026-11-11')).body.totals.salesCount).toBe(1);
    expect((await day('2026-11-10')).body.totals.salesCount).toBe(0);
    expect((await day('2026-11-11')).body.rows[0].time).toBe(
      '2026-11-11 00:30',
    );

    await http()
      .put('/reports/settings')
      .set('Authorization', store.auth)
      .send({ timezone: 'UTC' })
      .expect(200);
    expect((await get(store, '/reports/settings').expect(200)).body).toEqual({
      timezone: 'UTC',
    });
    expect((await day('2026-11-10')).body.totals.salesCount).toBe(1);
    expect((await day('2026-11-11')).body.totals.salesCount).toBe(0);
  });

  it('sales, product and shift reports on the known sales', async () => {
    const { store } = await knownSalesStore();
    await http()
      .post('/shifts/current/close')
      .set('Authorization', store.auth)
      .send({ countedCash: 144_000 })
      .expect(200);
    const q = `from=${today()}&to=${today()}`;

    const sales = (await get(store, `/reports/sales?${q}`).expect(200)).body;
    expect(sales.totals).toEqual({ qty: 7, ...KNOWN });
    expect(sales.truncated).toBe(false);
    expect(sales.rows).toHaveLength(4);
    expect(sales.rows[0]).toMatchObject({
      number: 1,
      name: 'Es Teh',
      qty: 3,
      unitPrice: 5000,
      lineTotal: 15_000,
      cost: 9000,
      grossProfit: 6000,
    });

    const products = (await get(store, `/reports/products?${q}`).expect(200))
      .body;
    expect(products.rows).toEqual([
      expect.objectContaining({
        name: 'Kopi Susu',
        qty: 3,
        sales: 24_000,
        cost: 12_000,
        grossProfit: 12_000,
      }),
      expect.objectContaining({
        name: 'Es Teh',
        qty: 4,
        sales: 20_000,
        cost: 12_000,
        grossProfit: 8000,
      }),
    ]);
    expect(products.totals).toEqual({ qty: 7, ...KNOWN });

    const shifts = (await get(store, `/reports/shifts?${q}`).expect(200)).body;
    expect(shifts.rows).toHaveLength(1);
    expect(shifts.rows[0]).toMatchObject({
      cashier: 'Pemilik',
      openingCash: 100_000,
      expectedCash: 144_300,
      countedCash: 144_000,
      difference: -300,
      ...KNOWN,
    });
    expect(shifts.totals).toEqual({ shifts: 1, ...KNOWN });
  });

  it('shift report names the cashier', async () => {
    const store = await createStore();
    const teh = await product(store, 'Es Teh', 5000, 3000);
    const cashier = await createCashier(app, store, ['sales.create']);
    await http()
      .post('/shifts/open')
      .set('Authorization', cashier.auth)
      .send({ openingCash: 0 })
      .expect(201);
    await http()
      .post('/sales')
      .set('Authorization', cashier.auth)
      .set('Idempotency-Key', randomUUID())
      .send({ lines: [{ productId: teh, qty: 1 }], paid: 5000 })
      .expect(201);
    const res = await get(
      store,
      `/reports/shifts?from=${today()}&to=${today()}`,
    ).expect(200);
    expect(res.body.rows).toEqual([
      expect.objectContaining({
        salesCount: 1,
        revenue: 5000,
        closedAt: null,
        difference: null,
      }),
    ]);
    expect(res.body.rows[0].cashier).not.toBe('Pemilik');
  });

  it('purchasing report lists approved purchases only', async () => {
    const store = await createStore();
    const teh = await product(store, 'Es Teh', 5000, 3000);
    const sup = await http()
      .post('/suppliers')
      .set('Authorization', store.auth)
      .send({ name: 'CV Segar' })
      .expect(201);
    const order = (lines: object[]) =>
      http()
        .post('/purchasing/orders')
        .set('Authorization', store.auth)
        .send({ supplierId: sup.body.id, lines })
        .expect(201);
    const a = await order([{ productId: teh, qty: 20, unitCost: 2800 }]);
    await order([{ productId: teh, qty: 5, unitCost: 2800 }]); // draft: excluded
    await http()
      .post(`/purchasing/orders/${a.body.id}/approve`)
      .set('Authorization', store.auth)
      .expect(200);
    const res = await get(
      store,
      `/reports/purchasing?from=${today()}&to=${today()}`,
    ).expect(200);
    expect(res.body.rows).toEqual([
      expect.objectContaining({
        supplier: 'CV Segar',
        name: 'Es Teh',
        qty: 20,
        unitCost: 2800,
        lineTotal: 56_000,
        date: today(),
      }),
    ]);
    expect(res.body.totals).toEqual({ orders: 1, qty: 20, total: 56_000 });

    const csv = await get(
      store,
      `/reports/purchasing/csv?from=${today()}&to=${today()}`,
    ).expect(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.text.split('\r\n')).toEqual([
      'Tanggal,Pemasok,SKU,Produk,Qty,Harga beli,Jumlah',
      expect.stringMatching(
        new RegExp(`^${today()},CV Segar,[^,]+,Es Teh,20,2800,56000$`),
      ),
      'Total,,,,20,,56000',
      '',
    ]);
  });

  it('CSV export: header, rows, totals; formula cells neutralised', async () => {
    const store = await createStore();
    const p = await product(store, '=HYPERLINK("x")', 5000, 3000);
    await openShift(store);
    await sell(store, { lines: [{ productId: p, qty: 2 }], paid: 10_000 });
    const q = `from=${today()}&to=${today()}`;
    const csv = await get(store, `/reports/products/csv?${q}`).expect(200);
    expect(csv.headers['content-disposition']).toContain('laporan-produk.csv');
    const lines = csv.text.split('\r\n');
    expect(lines[0]).toBe('SKU,Produk,Qty,Penjualan,Modal,Laba kotor');
    expect(lines[1]).toMatch(
      /^[^,]+,"'=HYPERLINK\(""x""\)",2,10000,6000,4000$/,
    );
    expect(lines).toContain('Pendapatan,,,10000,,');
    expect(lines).toContain('Laba kotor,,,4000,,');
    for (const kind of ['sales', 'shifts']) {
      const r = await get(store, `/reports/${kind}/csv?${q}`).expect(200);
      expect(r.text.split('\r\n').length).toBeGreaterThan(2);
    }
  });

  /** pos-api's toast line: the field's own message, or a generic one when several fields are wrong. */
  const message = (errors: Record<string, string>) =>
    Object.keys(errors).length === 1
      ? Object.values(errors)[0]
      : 'Periksa kembali isian kamu';

  const RANGE_ENDPOINTS = [
    'sales',
    'products',
    'shifts',
    'purchasing',
    'sales/csv',
    'products/csv',
    'shifts/csv',
    'purchasing/csv',
  ];
  const RANGE_REFUSALS: [string, Record<string, string>][] = [
    [
      '',
      { from: 'Tanggal mulai wajib diisi', to: 'Tanggal akhir wajib diisi' },
    ],
    ['from=2026-11-01', { to: 'Tanggal akhir wajib diisi' }],
    ['from=&to=2026-11-02', { from: 'Tanggal mulai wajib diisi' }],
    [
      'from=2026-11-1&to=2026-11-02',
      { from: 'Tanggal mulai harus berformat TTTT-BB-HH' },
    ],
    [
      'from=2026-11-01&to=abc',
      { to: 'Tanggal akhir harus berformat TTTT-BB-HH' },
    ],
    [
      'from=2026-02-30&to=2026-03-01',
      { from: 'Tanggal mulai tidak ada di kalender' },
    ],
    [
      'from=2026-01-01&from=2026-01-02&to=2026-03-01',
      { from: 'Tanggal mulai harus berformat TTTT-BB-HH' },
    ],
    [
      'from=2026-11-10&to=2026-11-01',
      { to: 'Tanggal akhir tidak boleh sebelum tanggal mulai' },
    ],
    [
      'from=2025-11-16&to=2026-11-17',
      { to: 'Rentang tanggal paling lama 366 hari' },
    ],
  ];

  it.each(RANGE_ENDPOINTS)(
    'GET /reports/%s refuses each bad range with 422 and the field message',
    async (endpoint) => {
      const store = await createStore();
      for (const [query, errors] of RANGE_REFUSALS) {
        const res = await get(store, `/reports/${endpoint}?${query}`).expect(
          422,
        );
        expect(res.body).toEqual({ message: message(errors), errors });
      }
      // 366 days inclusive is the limit.
      await get(
        store,
        `/reports/${endpoint}?from=2025-11-17&to=2026-11-17`,
      ).expect(200);
    },
  );

  it('GET /reports/dashboard refuses an unknown period with the field message', async () => {
    const store = await createStore();
    for (const q of ['period=decade', 'period=', 'period=today&period=week']) {
      const res = await get(store, `/reports/dashboard?${q}`).expect(422);
      expect(res.body).toEqual({
        message: 'Periode harus hari ini, minggu ini, bulan ini atau tahun ini',
        errors: {
          period:
            'Periode harus hari ini, minggu ini, bulan ini atau tahun ini',
        },
      });
    }
    await get(store, '/reports/dashboard').expect(200); // period defaults to today
  });

  it('PUT /reports/settings refuses a bad timezone with the field message and keeps the old one', async () => {
    const store = await createStore();
    const cases: [unknown, Record<string, string>][] = [
      [{}, { timezone: 'Zona waktu wajib diisi' }],
      [{ timezone: '' }, { timezone: 'Zona waktu wajib diisi' }],
      [{ timezone: 42 }, { timezone: 'Zona waktu tidak dikenal' }],
      [{ timezone: 'Mars/Olympus' }, { timezone: 'Zona waktu tidak dikenal' }],
      [
        { timezone: 'Asia/Jakarta; drop table x' },
        { timezone: 'Zona waktu tidak dikenal' },
      ],
      [{ timezone: 'UTC', extra: 1 }, { extra: 'Isian tidak dikenal' }],
    ];
    for (const [body, errors] of cases) {
      const res = await http()
        .put('/reports/settings')
        .set('Authorization', store.auth)
        .send(body as object)
        .expect(422);
      expect(res.body).toEqual({ message: message(errors), errors });
    }
    expect((await get(store, '/reports/settings').expect(200)).body).toEqual({
      timezone: 'Asia/Jakarta',
    });
  });

  it('cross-tenant: store B never sees store A’s numbers or settings', async () => {
    const { store: a } = await knownSalesStore();
    await http()
      .put('/reports/settings')
      .set('Authorization', a.auth)
      .send({ timezone: 'Asia/Makassar' })
      .expect(200);
    const b = await createStore();
    const q = `from=${today()}&to=${today()}`;
    expect((await get(b, '/reports/settings').expect(200)).body).toEqual({
      timezone: 'Asia/Jakarta',
    });
    const dash = (await get(b, '/reports/dashboard?period=year').expect(200))
      .body;
    expect(dash.current).toMatchObject({
      salesCount: 0,
      revenue: 0,
      grossProfit: 0,
    });
    for (const kind of ['sales', 'products', 'shifts', 'purchasing']) {
      const r = (await get(b, `/reports/${kind}?${q}`).expect(200)).body;
      expect(r.rows).toEqual([]);
    }
    expect(
      (await get(b, `/reports/sales?${q}`).expect(200)).body.totals.revenue,
    ).toBe(0);
    // A still sees its own.
    expect(
      (
        await get(
          a,
          `/reports/sales?from=${today('Asia/Makassar')}&to=${today('Asia/Makassar')}`,
        ).expect(200)
      ).body.totals.revenue,
    ).toBe(44_300);
  });

  it('needs reports.view (and catalog.manage to change the timezone)', async () => {
    const store = await createStore();
    const plain = await createCashier(app, store, ['sales.create']);
    const viewer = await createCashier(app, store, ['reports.view']);
    const q = `from=${today()}&to=${today()}`;
    const paths = [
      '/reports/settings',
      '/reports/dashboard',
      ...['sales', 'products', 'shifts', 'purchasing'].flatMap((k) => [
        `/reports/${k}?${q}`,
        `/reports/${k}/csv?${q}`,
      ]),
    ];
    for (const path of paths) {
      await get(plain, path).expect(403);
      await get(viewer, path).expect(200);
    }
    await http()
      .put('/reports/settings')
      .set('Authorization', viewer.auth)
      .send({ timezone: 'UTC' })
      .expect(403);
    await http()
      .put('/reports/settings')
      .set('Authorization', plain.auth)
      .send({ timezone: 'UTC' })
      .expect(403);
  });
});
