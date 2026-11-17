import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';

/**
 * The store's day (QA: a receivable showed "3 Des" in the list and "2 Des" on its page). The store timezone is
 * set to the fixed offset where it is just after midnight right now, so the store's day is not the UTC day
 * whenever the offset is not 0; the due date and voucher validity must follow the store's day, and list and
 * detail must agree on a plain 'YYYY-MM-DD'.
 */
describe('U7 store day: due date and voucher validity at the midnight boundary', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  /** The Etc/GMT zone whose local hour is 0 now, and its offset in hours (Etc/GMT+5 is UTC−5). */
  function midnightZone() {
    const h = new Date().getUTCHours();
    if (h === 0) return { zone: 'UTC', offset: 0 };
    return h <= 12
      ? { zone: `Etc/GMT+${h}`, offset: -h }
      : { zone: `Etc/GMT-${24 - h}`, offset: 24 - h };
  }
  const dayAt = (offset: number, plusDays = 0) =>
    new Date(Date.now() + offset * 3_600_000 + plusDays * 86_400_000)
      .toISOString()
      .slice(0, 10);

  /** A zone whose day differs from Jakarta's (UTC+7) right now: UTC−12, or UTC+14 when those share the day. */
  function notJakartaZone() {
    return dayAt(-12) !== dayAt(7)
      ? { zone: 'Etc/GMT+12', offset: -12 }
      : { zone: 'Etc/GMT-14', offset: 14 };
  }

  it("a kasbon just after the store's midnight is due 14 store days later, the same in list and detail", async () => {
    await kasbonInZone(midnightZone());
  });

  it("follows the store's timezone, not a hard-coded Asia/Jakarta", async () => {
    await kasbonInZone(notJakartaZone());
  });

  async function kasbonInZone({
    zone,
    offset,
  }: {
    zone: string;
    offset: number;
  }) {
    const s = await createStore();
    const post = (url: string, body: object) =>
      http().post(url).set('Authorization', s.auth).send(body);
    await http()
      .put('/reports/settings')
      .set('Authorization', s.auth)
      .send({ timezone: zone })
      .expect(200);
    const cat = await post('/catalog/categories', { name: 'Minuman' }).expect(
      201,
    );
    const p = await post('/catalog/products', {
      categoryId: cat.body.id,
      name: 'Kopi',
      costPrice: 1000,
      sellingPrice: 6000,
    }).expect(201);
    await post('/stock/opening', { productId: p.body.id, qty: 5 }).expect(201);
    await post('/shifts/open', { openingCash: 0 }).expect(201);
    const kasbon = await post('/payment-methods', {
      name: 'Kasbon',
      kind: 'credit',
    }).expect(201);
    const member = await post('/members', {
      name: 'Bu Sari',
      code: 'SARI',
    }).expect(201);
    // A voucher valid from the store's today only: it must apply although the UTC day may still be yesterday.
    const today = dayAt(offset);
    await post('/vouchers', {
      name: 'Hari ini',
      code: 'HARIINI',
      type: 'flat',
      nominal: 1000,
      kuota: 5,
      startDate: today,
      expired: today,
    }).expect(201);

    const before = dayAt(offset, 14);
    const sale = await http()
      .post('/sales')
      .set('Authorization', s.auth)
      .set('Idempotency-Key', randomUUID())
      .send({
        lines: [{ productId: p.body.id, qty: 1 }],
        memberId: member.body.id,
        paymentMethodId: kasbon.body.id,
        voucherCode: 'HARIINI',
        paid: 0,
      })
      .expect(201);
    const after = dayAt(offset, 14);
    expect(sale.body.voucherDiscount).toBe(1000);

    const list = await http()
      .get('/receivables')
      .set('Authorization', s.auth)
      .expect(200);
    const detail = await http()
      .get(`/receivables/${sale.body.receivableId}`)
      .set('Authorization', s.auth)
      .expect(200);
    const listDue = (list.body.data as { dueDate: string }[])[0].dueDate;
    // A plain calendar date, identical in both answers.
    expect(listDue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(detail.body.dueDate).toBe(listDue);
    // The store's day + 14 (the clock may tick past midnight between the two reads: accept either side).
    expect([before, after]).toContain(listDue);
  }
});
