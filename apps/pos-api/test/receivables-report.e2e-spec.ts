import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { ReceivablesReportService } from '../src/reports/receivables-report.service';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Customer = {
  memberId: string;
  name: string;
  kasbonCount: number;
  total: number;
  paid: number;
  rest: number;
  dueRest: number;
  oldestDueDate: string | null;
  overdueDays: number | null;
  status: 'due' | 'not_due';
};

// UMK-1964 "Laporan kasbon" (design feature 28): remaining from the payment book, overdue by the store's date,
// voided kasbon left out, collector-held cash apart, the sales report split into Lunas and Kasbon, CSV export.
describe('kasbon report (UMK-1964)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  const http = () => request(app.getHttpServer());
  const OWNER_PIN = '246810';

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const get = (auth: string, path: string) =>
    http().get(path).set('Authorization', auth);
  const post = (auth: string, path: string, body: object) =>
    http()
      .post(path)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  /** A store selling one product at Rp500 (cost Rp300), a Kasbon method and an open owner shift. */
  async function shop() {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Sembako',
    }).expect(201);
    const p = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Gula',
      costPrice: 300,
      sellingPrice: 500,
    }).expect(201);
    await post(s.auth, '/stock/opening', {
      productId: p.body.id,
      qty: 500,
    }).expect(201);
    const kasbon = await post(s.auth, '/payment-methods', {
      name: 'Kasbon',
      kind: 'credit',
    }).expect(201);
    await post(s.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    const member = async (name: string) =>
      (
        await post(s.auth, '/members', {
          name,
          code: `M${randomUUID().slice(0, 6)}`,
          phone: '081234567890',
        }).expect(201)
      ).body.id as string;
    /** A kasbon sale of `total` (a multiple of Rp500) with an optional down payment; returns the receivable id. */
    const kasbonSale = async (memberId: string, total: number, paid = 0) =>
      (
        await post(s.auth, '/sales', {
          lines: [{ productId: p.body.id, qty: total / 500 }],
          memberId,
          paymentMethodId: kasbon.body.id,
          paid,
        }).expect(201)
      ).body as { id: string; receivableId: string };
    const cashSale = (total: number) =>
      post(s.auth, '/sales', {
        lines: [{ productId: p.body.id, qty: total / 500 }],
        paid: total,
      }).expect(201);
    const pay = (auth: string, rid: string, amount: number) =>
      post(auth, `/receivables/${rid}/payments`, { amount }).expect(201);
    /** Due date = the store's calendar date + `days` (negative = in the past). */
    const due = (rid: string, days: number) => admin`
      update pos.receivables set due_date = (now() at time zone coalesce(
        (select rs.timezone from pos.report_settings rs where rs.tenant_id = pos.receivables.tenant_id),
        'Asia/Jakarta'))::date + ${days}::int
       where id = ${rid}`;
    return { ...s, member, kasbonSale, cashSale, pay, due };
  }

  const report = async (auth: string, filter = 'all') =>
    (await get(auth, `/reports/receivables?filter=${filter}`).expect(200))
      .body as {
      filter: string;
      summary: Record<string, number | string>;
      truncated: boolean;
      rows: Customer[];
    };
  const today = (tz = 'Asia/Jakarta') =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const salesToday = async (auth: string) =>
    (
      await get(auth, `/reports/sales?from=${today()}&to=${today()}`).expect(
        200,
      )
    ).body.totals as Record<string, number>;

  it('remaining = kasbon − the payment book; customers by most overdue; exact summary, filters and sales split', async () => {
    const s = await shop();
    // The design's example: kasbon Rp6.000, paid Rp2.500 (cash, at the till), remaining Rp3.500, 1 day late.
    const siti = await s.member('Siti');
    const k1 = await s.kasbonSale(siti, 6000);
    await s.pay(s.auth, k1.receivableId, 2500);
    await s.due(k1.receivableId, -1);
    // Two kasbon, one 12 days late, one due today with a Rp1.000 down payment.
    const rina = await s.member('Bu Rina');
    const k2 = await s.kasbonSale(rina, 10_000);
    await s.due(k2.receivableId, -12);
    const k3 = await s.kasbonSale(rina, 5000, 1000);
    await s.due(k3.receivableId, 0);
    const berkah = await s.member('Toko Berkah');
    const k4 = await s.kasbonSale(berkah, 6500);
    await s.due(k4.receivableId, 5);
    // Paid in full: out of every list and total; its instalment is money in this month.
    const dedi = await s.member('Pak Dedi');
    const k5 = await s.kasbonSale(dedi, 5000);
    await s.due(k5.receivableId, -30);
    await s.pay(s.auth, k5.receivableId, 5000);
    await s.cashSale(4000);

    const all = await report(s.auth);
    expect(all.summary).toEqual({
      timezone: 'Asia/Jakarta',
      today: today(),
      totalRest: 24_000,
      dueRest: 17_500,
      customers: 3,
      dueCustomers: 2,
      // Instalments only: Rp2.500 + Rp5.000; the down payment belongs to its sale.
      paidThisMonth: 7500,
      collectorHeld: 0,
    });
    expect(all.truncated).toBe(false);
    expect(all.rows).toEqual([
      {
        memberId: rina,
        name: 'Bu Rina',
        kasbonCount: 2,
        total: 15_000,
        paid: 1000,
        rest: 14_000,
        dueRest: 14_000,
        oldestDueDate: expect.any(String),
        overdueDays: 12,
        status: 'due',
      },
      {
        memberId: siti,
        name: 'Siti',
        kasbonCount: 1,
        total: 6000,
        paid: 2500,
        rest: 3500,
        dueRest: 3500,
        oldestDueDate: expect.any(String),
        overdueDays: 1,
        status: 'due',
      },
      {
        memberId: berkah,
        name: 'Toko Berkah',
        kasbonCount: 1,
        total: 6500,
        paid: 0,
        rest: 6500,
        dueRest: 0,
        oldestDueDate: expect.any(String),
        overdueDays: null,
        status: 'not_due',
      },
    ]);
    // The receivables' own `rest` agrees with the book.
    const [{ rest }] = await admin<{ rest: number }[]>`
      select sum(rest)::int as rest from pos.receivables where tenant_id = ${s.tenantId}`;
    expect(rest).toBe(24_000);

    expect((await report(s.auth, 'due')).rows.map((r) => r.name)).toEqual([
      'Bu Rina',
      'Siti',
    ]);
    expect((await report(s.auth, 'not_due')).rows.map((r) => r.name)).toEqual([
      'Toko Berkah',
    ]);
    await get(s.auth, '/reports/receivables?filter=late').expect(422);

    const card = await get(s.auth, '/reports/receivables/summary').expect(200);
    expect(card.body).toEqual(all.summary);

    // Rina's detail: her open kasbon (due first) with the down payment in the book.
    const detail = await get(
      s.auth,
      `/reports/receivables/customers/${rina}`,
    ).expect(200);
    expect(detail.body).toMatchObject({
      memberId: rina,
      name: 'Bu Rina',
      rest: 14_000,
    });
    expect(
      (detail.body.receivables as Record<string, unknown>[]).map((r) => ({
        total: r.total,
        paid: r.paid,
        rest: r.rest,
        overdueDays: r.overdueDays,
        status: r.status,
        payments: (r.payments as { amount: number; method: string }[]).map(
          (p) => [p.amount, p.method],
        ),
      })),
    ).toEqual([
      {
        total: 10_000,
        paid: 0,
        rest: 10_000,
        overdueDays: 12,
        status: 'due',
        payments: [],
      },
      {
        total: 5000,
        paid: 1000,
        rest: 4000,
        overdueDays: 0,
        status: 'due',
        payments: [[1000, 'Tunai']],
      },
    ]);
    const sitiDetail = await get(
      s.auth,
      `/reports/receivables/customers/${siti}`,
    ).expect(200);
    expect(sitiDetail.body.receivables).toEqual([
      expect.objectContaining({
        total: 6000,
        paid: 2500,
        rest: 3500,
        payments: [
          expect.objectContaining({
            amount: 2500,
            paidOn: today(),
            byCollector: false,
          }),
        ],
      }),
    ]);
    // A settled customer has nothing open.
    const dediDetail = await get(
      s.auth,
      `/reports/receivables/customers/${dedi}`,
    ).expect(200);
    expect(dediDetail.body).toMatchObject({ rest: 0, receivables: [] });
    await get(s.auth, '/reports/receivables/customers/not-a-uuid').expect(404);

    // Sales report: revenue Rp36.500 = Lunas Rp4.000 + Kasbon Rp32.500; instalments Rp7.500 apart, not revenue.
    const totals = await salesToday(s.auth);
    expect(totals).toMatchObject({
      revenue: 36_500,
      settledSales: 4000,
      creditSales: 32_500,
      receivablePaid: 7500,
      tax: 0,
      cost: 21_900,
      grossProfit: 14_600,
    });
    const csv = await get(
      s.auth,
      `/reports/sales/csv?from=${today()}&to=${today()}`,
    ).expect(200);
    expect(csv.text).toContain('Pendapatan lunas,,,,,,,4000,,\r\n');
    expect(csv.text).toContain('Pendapatan kasbon,,,,,,,32500,,\r\n');
    expect(csv.text).toContain('Piutang dibayar (uang masuk),,,,,,,7500,,\r\n');
  });

  it('a voided kasbon leaves the report; its instalment given back is not money in', async () => {
    const s = await shop();
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: OWNER_PIN })
      .expect(200);
    const siti = await s.member('Siti');
    const k = await s.kasbonSale(siti, 6000);
    await s.pay(s.auth, k.receivableId, 2500);
    expect((await report(s.auth)).summary).toMatchObject({
      totalRest: 3500,
      paidThisMonth: 2500,
    });
    await post(s.auth, `/sales/${k.id}/void`, {
      reasonCode: 'customer_cancelled',
      approverId: s.userId,
      pin: OWNER_PIN,
    }).expect(201);

    const after = await report(s.auth);
    expect(after.rows).toEqual([]);
    expect(after.summary).toMatchObject({
      totalRest: 0,
      dueRest: 0,
      customers: 0,
      paidThisMonth: 0,
    });
    const detail = await get(
      s.auth,
      `/reports/receivables/customers/${siti}`,
    ).expect(200);
    expect(detail.body).toMatchObject({ rest: 0, receivables: [] });
    const csv = await get(s.auth, '/reports/receivables/csv').expect(200);
    expect(csv.text).toBe(
      'Pelanggan,Kasbon,Dibayar,Sisa,Jatuh tempo,Terlambat (hari)\r\n',
    );
    // Sold and voided the same day: nothing in the Kasbon line, nothing paid.
    expect(await salesToday(s.auth)).toMatchObject({
      revenue: 0,
      settledSales: 0,
      creditSales: 0,
      receivablePaid: 0,
    });
  });

  it('cash a collector took outside a shift lowers the debt and is "dipegang penagih" until the deposit', async () => {
    const s = await shop();
    const siti = await s.member('Siti');
    const k = await s.kasbonSale(siti, 6000);
    const collector = await createCashier(app, s, ['receivables.manage']);
    await s.pay(collector.auth, k.receivableId, 2500);

    const held = await report(s.auth);
    expect(held.summary).toMatchObject({
      totalRest: 3500,
      paidThisMonth: 2500,
      collectorHeld: 2500,
    });
    expect(held.rows[0]).toMatchObject({ paid: 2500, rest: 3500 });
    const detail = await get(
      s.auth,
      `/reports/receivables/customers/${siti}`,
    ).expect(200);
    expect(detail.body.receivables[0].payments).toEqual([
      expect.objectContaining({ amount: 2500, byCollector: true }),
    ]);

    // The owner (open shift) receives the deposit: no longer held, the debt is unchanged.
    await post(s.auth, '/store-cash/deposits', {
      collectorId: collector.staffId,
      amount: 2500,
    }).expect(201);
    expect((await report(s.auth)).summary).toMatchObject({
      totalRest: 3500,
      paidThisMonth: 2500,
      collectorHeld: 0,
    });
  });

  it('overdue counts store-timezone calendar days: due today is due (0 days), due tomorrow is not', async () => {
    const s = await shop();
    // A zone whose date differs from UTC's right now, so a UTC (or server) date gives other answers.
    const tz =
      new Date().getUTCHours() < 11 ? 'Etc/GMT+12' : 'Pacific/Kiritimati';
    expect(today(tz)).not.toBe(new Date().toISOString().slice(0, 10));
    await http()
      .put('/reports/settings')
      .set('Authorization', s.auth)
      .send({ timezone: tz })
      .expect(200);
    const a = await s.member('A hari ini');
    const b = await s.member('B besok');
    const c = await s.member('C kemarin');
    const ka = await s.kasbonSale(a, 1000);
    const kb = await s.kasbonSale(b, 1000);
    const kc = await s.kasbonSale(c, 1000);
    await s.due(ka.receivableId, 0);
    await s.due(kb.receivableId, 1);
    await s.due(kc.receivableId, -1);

    const r = await report(s.auth);
    expect(r.summary).toMatchObject({ today: today(tz), dueRest: 2000 });
    expect(
      r.rows.map((x) => [x.name, x.status, x.overdueDays, x.oldestDueDate]),
    ).toEqual([
      ['C kemarin', 'due', 1, expect.any(String)],
      ['A hari ini', 'due', 0, today(tz)],
      ['B besok', 'not_due', null, expect.any(String)],
    ]);
    const csv = await get(s.auth, '/reports/receivables/csv').expect(200);
    expect(csv.text.split('\r\n').slice(1, 4)).toEqual([
      expect.stringMatching(/^C kemarin,1000,0,1000,\d{4}-\d{2}-\d{2},1$/),
      `A hari ini,1000,0,1000,${today(tz)},0`,
      expect.stringMatching(/^B besok,1000,0,1000,\d{4}-\d{2}-\d{2},0$/),
    ]);
  });

  it('CSV: one row per open kasbon, formula-like names prefixed, no phone number, at most the row limit', async () => {
    const s = await shop();
    const evil = await s.member('=HYPERLINK("http://x","klik")');
    const plus = await s.member('+62 Warung');
    const k1 = await s.kasbonSale(evil, 6000);
    await s.pay(s.auth, k1.receivableId, 2500);
    await s.due(k1.receivableId, -3);
    const k2 = await s.kasbonSale(plus, 1500);
    await s.due(k2.receivableId, 2);

    const res = await get(s.auth, '/reports/receivables/csv').expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="laporan-kasbon.csv"',
    );
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe(
      'Pelanggan,Kasbon,Dibayar,Sisa,Jatuh tempo,Terlambat (hari)',
    );
    expect(lines[1]).toMatch(
      /^"'=HYPERLINK\(""http:\/\/x"",""klik""\)",6000,2500,3500,\d{4}-\d{2}-\d{2},3$/,
    );
    expect(lines[2]).toMatch(/^'\+62 Warung,1500,0,1500,\d{4}-\d{2}-\d{2},0$/);
    expect(lines).toHaveLength(4);
    expect(res.text).not.toContain('081234567890');

    const due = await get(s.auth, '/reports/receivables/csv?filter=due').expect(
      200,
    );
    expect(due.text.split('\r\n')).toHaveLength(3);
    await get(s.auth, '/reports/receivables/csv?memberId=x').expect(422);

    // Beyond the limit: refused with a clear code; one customer fits.
    const svc = app.get(ReceivablesReportService);
    svc.exportMaxRows = 1;
    try {
      const big = await get(s.auth, '/reports/receivables/csv').expect(422);
      expect(big.body).toMatchObject({ code: 'EXPORT_TOO_LARGE', maxRows: 1 });
      expect(big.body.message).toMatch(/terlalu besar/);
      const one = await get(
        s.auth,
        `/reports/receivables/csv?memberId=${plus}`,
      ).expect(200);
      expect(one.text.split('\r\n')).toHaveLength(3);
    } finally {
      svc.exportMaxRows = 10_000;
    }
  });

  it('needs reports.view: 403 for a cashier without it, 200 with it', async () => {
    const s = await shop();
    const m = await s.member('Siti');
    const paths = [
      '/reports/receivables',
      '/reports/receivables/summary',
      '/reports/receivables/csv',
      `/reports/receivables/customers/${m}`,
    ];
    const kasir = await createCashier(app, s, ['sales.create']);
    const viewer = await createCashier(app, s, ['reports.view']);
    for (const p of paths) {
      await get(kasir.auth, p).expect(403);
      await get(viewer.auth, p).expect(200);
    }
  });

  it('cross-tenant: store B sees nothing of store A and gets 404 on its customer', async () => {
    const a = await shop();
    const siti = await a.member('Siti');
    const k = await a.kasbonSale(siti, 6000);
    await a.pay(a.auth, k.receivableId, 2500);
    const b = await createStore();

    const r = await report(b.auth);
    expect(r.rows).toEqual([]);
    expect(r.summary).toMatchObject({
      totalRest: 0,
      dueRest: 0,
      customers: 0,
      paidThisMonth: 0,
      collectorHeld: 0,
    });
    expect(
      (await get(b.auth, '/reports/receivables/summary').expect(200)).body,
    ).toMatchObject({ totalRest: 0, paidThisMonth: 0 });
    await get(b.auth, `/reports/receivables/customers/${siti}`).expect(404);
    for (const q of ['', `?memberId=${siti}`]) {
      const csv = await get(b.auth, `/reports/receivables/csv${q}`).expect(200);
      expect(csv.text).toBe(
        'Pelanggan,Kasbon,Dibayar,Sisa,Jatuh tempo,Terlambat (hari)\r\n',
      );
    }
    expect(await salesToday(b.auth)).toMatchObject({
      creditSales: 0,
      receivablePaid: 0,
    });
  });
});
