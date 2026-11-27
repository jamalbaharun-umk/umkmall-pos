import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

// UMK-1987 (WhatsApp receipt) and UMK-1973 (kasbon reminder): the data the screens build their wa.me message from,
// and the one date the reminder leaves on the customer. The POS never sends a message and never stores one.
describe('WhatsApp receipt and kasbon reminder (UMK-1987, UMK-1973)', () => {
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

  const get = (auth: string, path: string) =>
    http().get(path).set('Authorization', auth);
  const post = (auth: string, path: string, body: object = {}) =>
    http()
      .post(path)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send(body);

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
      qty: 100,
    }).expect(201);
    const kasbon = await post(s.auth, '/payment-methods', {
      name: 'Kasbon',
      kind: 'credit',
    }).expect(201);
    await post(s.auth, '/shifts/open', { openingCash: 100_000 }).expect(201);
    return {
      ...s,
      productId: p.body.id as string,
      kasbonId: kasbon.body.id as string,
    };
  }
  type Shop = Awaited<ReturnType<typeof shop>>;

  const member = (s: Store, name: string, phone?: string) =>
    post(s.auth, '/members', {
      name,
      code: `M${Math.random().toString(36).slice(2, 8)}`,
      ...(phone ? { phone } : {}),
    }).expect(201);

  /** A kasbon of `qty` × Rp500 to `memberId`, due `dueInDays` from today (negative = late). */
  async function owe(s: Shop, memberId: string, qty: number, dueInDays = 14) {
    const sale = await post(s.auth, '/sales', {
      lines: [{ productId: s.productId, qty }],
      memberId,
      paymentMethodId: s.kasbonId,
      paid: 0,
    }).expect(201);
    await admin`
      update pos.receivables set due_date = (now() at time zone 'Asia/Jakarta')::date + ${dueInDays}::int
      where id = ${sale.body.receivableId}`;
    return sale.body as { id: string; receivableId: string };
  }

  describe('receipt carries the member phone (UMK-1987)', () => {
    it('answers the member record phone, null without a member, and the sale detail does not carry it', async () => {
      const s = await shop();
      const m = await member(s, 'Bu Rina', '0812 3456 7890');
      const withMember = await post(s.auth, '/sales', {
        lines: [{ productId: s.productId, qty: 2 }],
        memberId: m.body.id,
        paid: 1000,
      }).expect(201);
      const plain = await post(s.auth, '/sales', {
        lines: [{ productId: s.productId, qty: 1 }],
        paid: 500,
      }).expect(201);
      const r = await get(
        s.auth,
        `/sales/${withMember.body.id}/receipt`,
      ).expect(200);
      expect(r.body).toMatchObject({
        memberName: 'Bu Rina',
        memberPhone: '0812 3456 7890',
        total: 1000,
      });
      const r2 = await get(s.auth, `/sales/${plain.body.id}/receipt`).expect(
        200,
      );
      expect(r2.body.memberPhone).toBeNull();
      const detail = await get(s.auth, `/sales/${withMember.body.id}`).expect(
        200,
      );
      expect(JSON.stringify(detail.body)).not.toContain('3456');
    });

    it('cross-tenant: store B cannot read store A receipt', async () => {
      const a = await shop();
      const b = await shop();
      const m = await member(a, 'Bu Rina', '081234567890');
      const sale = await post(a.auth, '/sales', {
        lines: [{ productId: a.productId, qty: 1 }],
        memberId: m.body.id,
        paid: 500,
      }).expect(201);
      await get(b.auth, `/sales/${sale.body.id}/receipt`).expect(404);
    });
  });

  describe('kasbon reminder (UMK-1973)', () => {
    it('adds up the open balances, uses the oldest due date and counts the days late', async () => {
      const s = await shop();
      const m = await member(s, 'Bu Rina', '081234567890');
      await owe(s, m.body.id, 4, -12); // 2.000, 12 days late
      await owe(s, m.body.id, 2, 5); // 1.000, not due
      const r = await get(s.auth, `/receivables/reminders/${m.body.id}`).expect(
        200,
      );
      expect(r.body).toMatchObject({
        memberId: m.body.id,
        memberName: 'Bu Rina',
        phone: '081234567890',
        rest: 3000,
        overdueDays: 12,
        lastRemindedAt: null,
        remindedDaysAgo: null,
      });
      expect(r.body.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('a balance not yet due is 0 days late; a settled one is refused with nothing_owed', async () => {
      const s = await shop();
      const m = await member(s, 'Toko Berkah', '081234567890');
      const sale = await owe(s, m.body.id, 3, 5);
      const r = await get(s.auth, `/receivables/reminders/${m.body.id}`).expect(
        200,
      );
      expect(r.body).toMatchObject({ rest: 1500, overdueDays: 0 });
      await post(s.auth, `/receivables/${sale.receivableId}/payments`, {
        amount: 1500,
      }).expect(201);
      const settled = await get(
        s.auth,
        `/receivables/reminders/${m.body.id}`,
      ).expect(409);
      expect(settled.body).toMatchObject({ code: 'nothing_owed' });
      await post(s.auth, `/receivables/reminders/${m.body.id}`).expect(409);
    });

    it('marking stores only a date: remindedDaysAgo follows the store day, nothing of the message is kept', async () => {
      const s = await shop();
      const m = await member(s, 'Pak Dedi', '081234567890');
      await owe(s, m.body.id, 2, -3);
      const marked = await post(
        s.auth,
        `/receivables/reminders/${m.body.id}`,
      ).expect(200);
      expect(marked.body.lastRemindedAt).toEqual(expect.any(String));
      const now = await get(
        s.auth,
        `/receivables/reminders/${m.body.id}`,
      ).expect(200);
      expect(now.body.remindedDaysAgo).toBe(0);
      await admin`
        update pos.members set last_reminded_at = now() - interval '2 days' where id = ${m.body.id}`;
      const later = await get(
        s.auth,
        `/receivables/reminders/${m.body.id}`,
      ).expect(200);
      expect(later.body.remindedDaysAgo).toBe(2);
      // The row has no message column: the only new field is the date.
      const cols = await admin`
        select column_name from information_schema.columns
        where table_schema = 'pos' and table_name = 'members' and column_name ilike '%remind%'`;
      expect(cols.map((c) => c.column_name as string)).toEqual([
        'last_reminded_at',
      ]);
      // The list shows when and how late.
      const list = await get(s.auth, '/receivables?status=open').expect(200);
      expect(list.body.data[0]).toMatchObject({
        memberName: 'Pak Dedi',
        overdueDays: 3,
      });
      expect(list.body.data[0].memberLastRemindedAt).toEqual(
        expect.any(String),
      );
      expect(JSON.stringify(list.body)).not.toContain('081234567890');
    });

    it('a customer without a phone: reading works (phone null), marking is refused with phone_missing', async () => {
      const s = await shop();
      const m = await member(s, 'Tanpa Nomor');
      await owe(s, m.body.id, 2, -1);
      const r = await get(s.auth, `/receivables/reminders/${m.body.id}`).expect(
        200,
      );
      expect(r.body.phone).toBeNull();
      const res = await post(
        s.auth,
        `/receivables/reminders/${m.body.id}`,
      ).expect(409);
      expect(res.body).toMatchObject({ code: 'phone_missing' });
    });

    it('the late queue lists customers with a phone, oldest first, over the whole store', async () => {
      const s = await shop();
      const a = await member(s, 'Bu Rina', '081234567890');
      const b = await member(s, 'Pak Dedi', '081234567891');
      const c = await member(s, 'Tanpa Nomor');
      const d = await member(s, 'Belum Tempo', '081234567892');
      await owe(s, a.body.id, 1, -3);
      await owe(s, b.body.id, 1, -9);
      await owe(s, c.body.id, 1, -20);
      await owe(s, d.body.id, 1, 4);
      const list = await get(s.auth, '/receivables?q=Rina').expect(200);
      expect(list.body.summary.overdueMemberIds).toEqual([
        b.body.id,
        a.body.id,
      ]);
    });

    it('a deleted customer is not reminded: 404 to read and mark, out of the late queue, flagged in the list', async () => {
      const s = await shop();
      const gone = await member(s, 'Sudah Dihapus', '081234567890');
      const kept = await member(s, 'Masih Ada', '081234567891');
      await owe(s, gone.body.id, 1, -5);
      await owe(s, kept.body.id, 1, -2);
      await http()
        .delete(`/members/${gone.body.id}`)
        .set('Authorization', s.auth)
        .expect(204);
      await get(s.auth, `/receivables/reminders/${gone.body.id}`).expect(404);
      await post(s.auth, `/receivables/reminders/${gone.body.id}`).expect(404);
      const list = await get(s.auth, '/receivables?status=open').expect(200);
      expect(list.body.summary.overdueMemberIds).toEqual([kept.body.id]);
      const rows = list.body.data as {
        memberName: string;
        memberDeleted: boolean;
      }[];
      expect(
        rows.find((r) => r.memberName === 'Sudah Dihapus')?.memberDeleted,
      ).toBe(true);
      expect(
        rows.find((r) => r.memberName === 'Masih Ada')?.memberDeleted,
      ).toBe(false);
    });

    it('the amount follows a payment correction: a reversed payment is owed again, a smaller one is owed less', async () => {
      const s = await shop();
      const m = await member(s, 'Bu Rina', '081234567890');
      const sale = await owe(s, m.body.id, 12, -4); // 6.000
      await http()
        .put('/void-pin')
        .set('Authorization', s.freshAuth)
        .send({ pin: '246810' })
        .expect(200);
      const paid = await post(
        s.auth,
        `/receivables/${sale.receivableId}/payments`,
        {
          amount: 2500,
        },
      ).expect(201);
      const paymentId = (paid.body.payments as { id: string }[]).at(-1)!.id;
      const rest = async () =>
        (await get(s.auth, `/receivables/reminders/${m.body.id}`).expect(200))
          .body.rest as number;
      expect(await rest()).toBe(3500);
      const fix = (replacement: { amount: number } | null, paymentId: string) =>
        post(
          s.auth,
          `/receivables/${sale.receivableId}/payments/${paymentId}/correction`,
          {
            replacement,
            reasonCode: 'wrong_amount',
            approverId: s.userId,
            pin: '246810',
          },
        ).expect(201);
      // Corrected to Rp3.000: Rp3.000 is owed.
      const fixed = await fix({ amount: 3000 }, paymentId);
      expect(await rest()).toBe(3000);
      // Cancelled altogether: the whole Rp6.000 is owed again, and the reminder says so.
      await fix(null, fixed.body.correction.newPaymentId as string);
      expect(await rest()).toBe(6000);
    });

    it('cross-tenant: store B gets 404 on store A members, to read and to mark', async () => {
      const a = await shop();
      const b = await shop();
      const m = await member(a, 'Bu Rina', '081234567890');
      await owe(a, m.body.id, 1, -1);
      await get(b.auth, `/receivables/reminders/${m.body.id}`).expect(404);
      await post(b.auth, `/receivables/reminders/${m.body.id}`).expect(404);
      // Nothing was written on A's customer by B's attempt.
      const [row] = await admin`
        select last_reminded_at from pos.members where id = ${m.body.id}`;
      expect(row.last_reminded_at).toBeNull();
    });

    it('needs receivables.manage: 403 for a cashier without it, allowed with it', async () => {
      const s = await shop();
      const m = await member(s, 'Bu Rina', '081234567890');
      await owe(s, m.body.id, 1, -1);
      const plain = await createCashier(app, s, ['sales.create']);
      await get(plain.auth, `/receivables/reminders/${m.body.id}`).expect(403);
      await post(plain.auth, `/receivables/reminders/${m.body.id}`).expect(403);
      const ok = await createCashier(app, s, ['receivables.manage']);
      await get(ok.auth, `/receivables/reminders/${m.body.id}`).expect(200);
      await post(ok.auth, `/receivables/reminders/${m.body.id}`).expect(200);
    });

    it('a malformed member id answers 404 or 422, never 500', async () => {
      const s = await shop();
      const res = await get(s.auth, '/receivables/reminders/not-a-uuid');
      expect([404, 422]).toContain(res.status);
    });
  });
});
