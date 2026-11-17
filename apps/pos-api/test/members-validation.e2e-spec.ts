import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';

// Every U7 refusal answers its status with { message, errors: { <field>: <Indonesian message> } }.

const jakartaDay = (days = 0) =>
  new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

describe('U7 validation: status and field message per refusal', () => {
  let app: INestApplication;
  let auth: string;
  const http = () => request(app.getHttpServer());
  const post = (url: string, body: unknown, a = auth) =>
    http()
      .post(url)
      .set('Authorization', a)
      .send(body as object);
  const patch = (url: string, body: unknown) =>
    http()
      .patch(url)
      .set('Authorization', auth)
      .send(body as object);

  /** Expects `status` and exactly these field messages. */
  const refused = async (
    req: request.Test,
    status: number,
    errors: Record<string, string>,
  ) => {
    const res = await req.expect(status);
    expect(res.body.errors).toEqual(errors);
    expect(typeof res.body.message).toBe('string');
    return res;
  };

  const goodVoucher = (extra: object = {}) => ({
    name: 'Hemat',
    code: `V${Math.random().toString(36).slice(2, 8)}`,
    type: 'percentage',
    nominal: 10,
    kuota: 5,
    startDate: jakartaDay(-1),
    expired: jakartaDay(1),
    ...extra,
  });

  beforeAll(async () => {
    app = await createApp();
    auth = (await createStore()).auth;
  });
  afterAll(async () => {
    await app.close();
  });

  describe('members', () => {
    it('POST: missing, wrong type, too long, bad format, unknown field → 422', async () => {
      await refused(post('/members', {}), 422, {
        name: 'Wajib diisi',
        code: 'Wajib diisi',
      });
      await refused(
        post('/members', {
          name: 5,
          code: 'A B',
          phone: 'abc',
          address: 'x'.repeat(501),
          email: 'a@b.c',
        }),
        422,
        {
          name: 'Format tidak valid',
          code: 'Kode tanpa spasi',
          phone: 'Nomor telepon tidak valid',
          address: 'Maksimal 500 karakter',
          email: 'Isian tidak dikenal',
        },
      );
      const one = await refused(
        post('/members', { name: 'Sari', code: '' }),
        422,
        {
          code: 'Wajib diisi',
        },
      );
      expect(one.body.message).toBe('Wajib diisi');
    });

    it('POST/PATCH duplicate code → 409 on the code field; blank optionals stored as null', async () => {
      const m = await post('/members', {
        name: 'Sari',
        code: 'PLG-1',
        phone: '',
        address: '',
      }).expect(201);
      expect(m.body).toMatchObject({ phone: null, address: null });
      // Codes are case-insensitive (QA sweep U7: "plg-1" was accepted next to "PLG-1").
      await refused(post('/members', { name: 'Lain', code: 'plg-1' }), 409, {
        code: 'Kode pelanggan sudah dipakai',
      });
      await refused(post('/members', { name: 'Lain', code: 'PLG-1' }), 409, {
        code: 'Kode pelanggan sudah dipakai',
      });
      const other = await post('/members', {
        name: 'Lain',
        code: 'PLG-2',
      }).expect(201);
      await refused(
        patch(`/members/${other.body.id}`, { code: 'PLG-1' }),
        409,
        {
          code: 'Kode pelanggan sudah dipakai',
        },
      );
      await refused(patch(`/members/${other.body.id}`, {}), 422, {
        _: 'Tidak ada yang diubah',
      });
    });

    it('GET: a search longer than 60 characters → 422', async () => {
      await refused(
        http()
          .get(`/members?q=${'a'.repeat(61)}`)
          .set('Authorization', auth),
        422,
        { q: 'Maksimal 60 karakter' },
      );
    });
  });

  describe('payment methods', () => {
    it('POST: missing and invalid kind → 422; duplicate → 409; a deleted name can be reused', async () => {
      await refused(post('/payment-methods', {}), 422, {
        name: 'Wajib diisi',
        kind: 'Wajib diisi',
      });
      await refused(
        post('/payment-methods', { name: 'X', kind: 'qris' }),
        422,
        {
          kind: 'Pilihan tidak valid',
        },
      );
      const ovo = await post('/payment-methods', {
        name: 'OVO',
        kind: 'wallet',
      }).expect(201);
      await refused(
        post('/payment-methods', { name: 'OVO', kind: 'debit' }),
        409,
        {
          name: 'Nama metode pembayaran sudah dipakai',
        },
      );
      await http()
        .delete(`/payment-methods/${ovo.body.id}`)
        .set('Authorization', auth)
        .expect(204);
      await post('/payment-methods', { name: 'OVO', kind: 'wallet' }).expect(
        201,
      );
    });

    it('Tunai cannot be changed → 422', async () => {
      const list = await http()
        .get('/payment-methods')
        .set('Authorization', auth)
        .expect(200);
      const tunai = (list.body.data as { id: string; name: string }[]).find(
        (m) => m.name === 'Tunai',
      )!;
      await refused(
        patch(`/payment-methods/${tunai.id}`, { name: 'Kas' }),
        422,
        {
          _: 'Metode Tunai tidak dapat diubah atau dihapus',
        },
      );
      await refused(patch(`/payment-methods/${tunai.id}`, {}), 422, {
        _: 'Tidak ada yang diubah',
      });
    });
  });

  describe('vouchers', () => {
    it('POST: every required field named', async () => {
      await refused(post('/vouchers', {}), 422, {
        name: 'Wajib diisi',
        code: 'Wajib diisi',
        type: 'Wajib diisi',
        nominal: 'Wajib diisi',
        kuota: 'Wajib diisi',
        startDate: 'Wajib diisi',
        expired: 'Wajib diisi',
      });
    });

    it('POST: wrong type, out of range, impossible and unordered dates', async () => {
      await refused(post('/vouchers', goodVoucher({ nominal: '10' })), 422, {
        nominal: 'Harus berupa angka',
      });
      await refused(
        post('/vouchers', goodVoucher({ type: 'flat', nominal: 1.5 })),
        422,
        {
          nominal: 'Harus bilangan bulat rupiah',
        },
      );
      await refused(post('/vouchers', goodVoucher({ nominal: 0 })), 422, {
        nominal: 'Harus lebih dari 0',
      });
      await refused(post('/vouchers', goodVoucher({ nominal: 150 })), 422, {
        nominal: 'Persen antara 1 dan 100',
      });
      await refused(post('/vouchers', goodVoucher({ kuota: -1 })), 422, {
        kuota: 'Minimal 0',
      });
      // V8 rolls 2026-02-31 over to 3 March; it must be refused, not stored or 500.
      await refused(
        post('/vouchers', goodVoucher({ startDate: '2026-02-31' })),
        422,
        {
          startDate: 'Tanggal tidak valid',
        },
      );
      await refused(
        post('/vouchers', goodVoucher({ expired: '17-11-2026' })),
        422,
        {
          expired: 'Format tanggal YYYY-MM-DD',
        },
      );
      await refused(
        post(
          '/vouchers',
          goodVoucher({ startDate: jakartaDay(2), expired: jakartaDay(1) }),
        ),
        422,
        {
          expired:
            'Tanggal berakhir harus sama dengan atau setelah tanggal mulai',
        },
      );
    });

    it('duplicate code (any case) → 409; PATCH is checked against the stored voucher', async () => {
      const v = await post('/vouchers', goodVoucher({ code: 'DOBEL' })).expect(
        201,
      );
      await refused(post('/vouchers', goodVoucher({ code: 'dobel' })), 409, {
        code: 'Kode voucher sudah dipakai',
      });
      await refused(patch(`/vouchers/${v.body.id}`, { nominal: 150 }), 422, {
        nominal: 'Persen antara 1 dan 100',
      });
      await refused(
        patch(`/vouchers/${v.body.id}`, { expired: jakartaDay(-5) }),
        422,
        {
          expired:
            'Tanggal berakhir harus sama dengan atau setelah tanggal mulai',
        },
      );
      await refused(
        patch(`/vouchers/${v.body.id}`, { startDate: '2026-13-01' }),
        422,
        {
          startDate: 'Tanggal tidak valid',
        },
      );
      const ok = await patch(`/vouchers/${v.body.id}`, {
        type: 'flat',
        nominal: 5000,
      }).expect(200);
      expect(ok.body).toMatchObject({ type: 'flat', nominal: 5000 });
    });

    it('check: missing fields, unknown, expired, exhausted and below minimum, each on the code field', async () => {
      await refused(post('/vouchers/check', {}), 422, {
        code: 'Wajib diisi',
        amount: 'Wajib diisi',
      });
      await refused(
        post('/vouchers/check', { code: 'NOPE', amount: 1000 }),
        422,
        {
          code: 'Voucher tidak ditemukan',
        },
      );
      const old = await post(
        '/vouchers',
        goodVoucher({ startDate: jakartaDay(-9), expired: jakartaDay(-2) }),
      ).expect(201);
      await refused(
        post('/vouchers/check', { code: old.body.code, amount: 1000 }),
        422,
        {
          code: 'Voucher belum berlaku atau sudah kedaluwarsa',
        },
      );
      const empty = await post('/vouchers', goodVoucher({ kuota: 0 })).expect(
        201,
      );
      await refused(
        post('/vouchers/check', { code: empty.body.code, amount: 1000 }),
        422,
        {
          code: 'Voucher sudah habis',
        },
      );
      const min = await post(
        '/vouchers',
        goodVoucher({ minimalBuying: 50_000 }),
      ).expect(201);
      await refused(
        post('/vouchers/check', { code: min.body.code, amount: 49_999 }),
        422,
        {
          code: 'Belanja minimal Rp50.000 untuk voucher ini',
        },
      );
    });
  });

  describe('sales (U7 fields) and receivables', () => {
    let productId: string;
    let kasbon: string;
    let memberId: string;

    beforeAll(async () => {
      const cat = await post('/catalog/categories', { name: 'Minuman' }).expect(
        201,
      );
      const p = await post('/catalog/products', {
        categoryId: cat.body.id,
        name: 'Teh',
        costPrice: 1000,
        sellingPrice: 6000,
      }).expect(201);
      productId = p.body.id as string;
      await post('/stock/opening', { productId, qty: 50 }).expect(201);
      await post('/shifts/open', { openingCash: 0 }).expect(201);
      kasbon = (
        await post('/payment-methods', {
          name: 'Kasbon',
          kind: 'credit',
        }).expect(201)
      ).body.id;
      memberId = (
        await post('/members', { name: 'Bu Sari', code: 'SARI' }).expect(201)
      ).body.id;
    });

    const sell = (body: object) =>
      http()
        .post('/sales')
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send(body);
    const pay = (
      rid: string,
      body: unknown,
      key: string | null = randomUUID(),
    ) => {
      const req = http()
        .post(`/receivables/${rid}/payments`)
        .set('Authorization', auth);
      if (key !== null) req.set('Idempotency-Key', key);
      return req.send(body as object);
    };
    const kasbonSale = async () =>
      (
        await sell({
          lines: [{ productId, qty: 1 }],
          memberId,
          paymentMethodId: kasbon,
          paid: 0,
        }).expect(201)
      ).body.receivableId as string;

    it('sale: kasbon without a member, bad ids, exhausted voucher → 422 on the field', async () => {
      const line = [{ productId, qty: 1 }];
      await refused(
        sell({ lines: line, paymentMethodId: kasbon, paid: 0 }),
        422,
        {
          memberId: 'Pilih member untuk kasbon',
        },
      );
      await refused(sell({ lines: line, memberId: 'x', paid: 6000 }), 422, {
        memberId: 'Format tidak valid',
      });
      await refused(
        sell({ lines: line, memberId: randomUUID(), paid: 6000 }),
        422,
        {
          memberId: 'Pelanggan tidak ditemukan',
        },
      );
      await refused(
        sell({ lines: line, paymentMethodId: randomUUID(), paid: 6000 }),
        422,
        {
          paymentMethodId: 'Metode pembayaran tidak ditemukan',
        },
      );
      await refused(sell({ lines: line, paid: 100 }), 422, {
        paid: 'Uang dibayar kurang dari total',
      });
      const empty = await post('/vouchers', goodVoucher({ kuota: 0 })).expect(
        201,
      );
      await refused(
        sell({ lines: line, voucherCode: empty.body.code, paid: 6000 }),
        422,
        {
          voucherCode: 'Voucher sudah habis',
        },
      );
      await refused(
        http()
          .post('/sales')
          .set('Authorization', auth)
          .send({ lines: line, paid: 6000 }),
        422,
        { idempotencyKey: 'Wajib diisi' },
      );
    });

    it('payment: key, amount and method refusals; overpayment names the rest', async () => {
      const rid = await kasbonSale();
      await refused(pay(rid, { amount: 1000 }, null), 422, {
        idempotencyKey: 'Wajib diisi',
      });
      await refused(pay(rid, {}), 422, { amount: 'Wajib diisi' });
      await refused(pay(rid, { amount: '1000' }), 422, {
        amount: 'Harus berupa angka',
      });
      await refused(pay(rid, { amount: 0 }), 422, {
        amount: 'Harus lebih dari 0',
      });
      await refused(pay(rid, { amount: 10.5 }), 422, {
        amount: 'Harus bilangan bulat rupiah',
      });
      await refused(pay(rid, { amount: 1000, paymentMethodId: 'tunai' }), 422, {
        paymentMethodId: 'Pilihan tidak valid',
      });
      await refused(pay(rid, { amount: 1000, paymentMethodId: kasbon }), 422, {
        paymentMethodId: 'Piutang tidak dapat dibayar dengan kasbon',
      });
      await refused(pay(rid, { amount: 6001 }), 422, {
        amount: 'Pembayaran melebihi sisa piutang (Rp6.000)',
      });
      await pay(rid, { amount: 6000 }).expect(201);
      await refused(pay(rid, { amount: 1 }), 422, {
        amount: 'Piutang sudah lunas',
      });
      await refused(
        http().get('/receivables?status=lunas').set('Authorization', auth),
        422,
        { status: 'Pilihan tidak valid' },
      );
    });

    it('payment Idempotency-Key: a retry records one payment; another body on the same key → 422', async () => {
      const rid = await kasbonSale();
      const key = randomUUID();
      const first = await pay(rid, { amount: 2500 }, key).expect(201);
      const retry = await pay(rid, { amount: 2500 }, key).expect(201);
      expect(first.body.rest).toBe(3500);
      expect(retry.body.rest).toBe(3500);
      expect(retry.body.payments).toHaveLength(1);
      await refused(pay(rid, { amount: 1000 }, key), 422, {
        idempotencyKey: 'Kunci ini sudah dipakai untuk pembayaran lain',
      });
      // The same key on another receivable is refused too.
      const other = await kasbonSale();
      await refused(pay(other, { amount: 2500 }, key), 422, {
        idempotencyKey: 'Kunci ini sudah dipakai untuk pembayaran lain',
      });
    });

    it('payment: two concurrent requests with one key record one payment', async () => {
      const rid = await kasbonSale();
      const key = randomUUID();
      const [a, b] = await Promise.all([
        pay(rid, { amount: 1000 }, key),
        pay(rid, { amount: 1000 }, key),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      const r = await http()
        .get(`/receivables/${rid}`)
        .set('Authorization', auth)
        .expect(200);
      expect(r.body).toMatchObject({ rest: 5000 });
      expect(r.body.payments).toHaveLength(1);
    });
  });
});
