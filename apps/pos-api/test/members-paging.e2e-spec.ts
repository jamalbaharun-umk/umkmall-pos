import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';

type Store = Awaited<ReturnType<typeof createStore>>;
type Page<T> = { data: T[]; total: number; page: number; perPage: number };

// U7 list paging and search for members and receivables, like GET /sales (QA sweep U7, OPEN-3).
describe('U7 lists: paging, search, cross-tenant', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const get = (s: Store, url: string) =>
    http().get(url).set('Authorization', s.auth);
  const post = (s: Store, url: string, body: object) =>
    http().post(url).set('Authorization', s.auth).send(body);

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  describe('members', () => {
    let a: Store;
    let b: Store;
    beforeAll(async () => {
      a = await createStore();
      b = await createStore();
      for (let i = 1; i <= 25; i++) {
        const n = String(i).padStart(2, '0');
        await post(a, '/members', {
          name: `Anggota ${n}`,
          code: `PLG${n}`,
          phone: `08120000${n}00`,
        }).expect(201);
      }
    });

    const list = async (s: Store, qs: string) =>
      (await get(s, `/members?${qs}`).expect(200)).body as Page<{
        name: string;
      }>;

    it('pages through 25 members, sorted by name, with the total', async () => {
      const p1 = await list(a, 'perPage=10');
      expect(p1).toMatchObject({ total: 25, page: 1, perPage: 10 });
      expect(p1.data.map((m) => m.name)).toEqual(
        Array.from(
          { length: 10 },
          (_, i) => `Anggota ${String(i + 1).padStart(2, '0')}`,
        ),
      );
      const p3 = await list(a, 'perPage=10&page=3');
      expect(p3.data.map((m) => m.name)).toEqual([
        'Anggota 21',
        'Anggota 22',
        'Anggota 23',
        'Anggota 24',
        'Anggota 25',
      ]);
      // Past the last page: empty, total unchanged.
      expect(await list(a, 'perPage=10&page=4')).toMatchObject({
        data: [],
        total: 25,
      });
      // Default page size is 20, like /sales.
      expect((await list(a, '')).data).toHaveLength(20);
    });

    it('refuses bad paging with field messages', async () => {
      const r1 = await get(a, '/members?perPage=101').expect(422);
      expect(r1.body.errors).toEqual({ perPage: 'Maksimal 100' });
      const r2 = await get(a, '/members?page=0').expect(422);
      expect(r2.body.errors).toEqual({ page: 'Minimal 1' });
      const r3 = await get(a, '/members?page=abc').expect(422);
      expect(r3.body.errors).toEqual({ page: 'Harus berupa angka' });
    });

    it('searches name, code and phone, and pages the result', async () => {
      const byName = await list(a, 'q=anggota%201&perPage=5');
      expect(byName.total).toBe(10); // Anggota 10–19
      expect(byName.data).toHaveLength(5);
      expect((await list(a, 'q=plg07')).data.map((m) => m.name)).toEqual([
        'Anggota 07',
      ]);
      expect((await list(a, 'q=081200002300')).data.map((m) => m.name)).toEqual(
        ['Anggota 23'],
      );
      // LIKE wildcards are literal.
      expect((await list(a, 'q=%25')).total).toBe(0);
    });

    it('cross-tenant: store B sees none of store A, also by search', async () => {
      expect(await list(b, '')).toMatchObject({ data: [], total: 0 });
      expect(await list(b, 'q=anggota')).toMatchObject({ data: [], total: 0 });
    });
  });

  describe('receivables', () => {
    let a: Store;
    let b: Store;
    const sales: { number: number; receivableId: string }[] = [];

    /** A store with a Rp6.000 product, an open shift and a Kasbon method. */
    async function shop() {
      const s = await createStore();
      const cat = await post(s, '/catalog/categories', {
        name: 'Minuman',
      }).expect(201);
      const p = await post(s, '/catalog/products', {
        categoryId: cat.body.id,
        name: 'Kopi',
        costPrice: 1000,
        sellingPrice: 6000,
      }).expect(201);
      await post(s, '/stock/opening', { productId: p.body.id, qty: 50 }).expect(
        201,
      );
      await post(s, '/shifts/open', { openingCash: 0 }).expect(201);
      const kasbon = await post(s, '/payment-methods', {
        name: 'Kasbon',
        kind: 'credit',
      }).expect(201);
      return {
        s,
        productId: p.body.id as string,
        kasbonId: kasbon.body.id as string,
      };
    }

    beforeAll(async () => {
      const shopA = await shop();
      a = shopA.s;
      b = (await shop()).s;
      const sari = await post(a, '/members', {
        name: 'Bu Sari',
        code: 'SARI',
      }).expect(201);
      const budi = await post(a, '/members', {
        name: 'Pak Budi',
        code: 'BUDI',
      }).expect(201);
      for (const [member, qty] of [
        [sari, 1],
        [budi, 2],
        [sari, 3],
      ] as const) {
        const sale = await http()
          .post('/sales')
          .set('Authorization', a.auth)
          .set('Idempotency-Key', randomUUID())
          .send({
            lines: [{ productId: shopA.productId, qty }],
            memberId: member.body.id,
            paymentMethodId: shopA.kasbonId,
            paid: 0,
          })
          .expect(201);
        sales.push({
          number: sale.body.number,
          receivableId: sale.body.receivableId,
        });
      }
      // Settle Pak Budi's Rp12.000.
      await http()
        .post(`/receivables/${sales[1].receivableId}/payments`)
        .set('Authorization', a.auth)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 12_000 })
        .expect(201);
    });

    type R = Page<{ id: string; memberName: string; rest: number }> & {
      summary: { openRest: number; openCount: number };
    };
    const list = async (s: Store, qs: string) =>
      (await get(s, `/receivables?${qs}`).expect(200)).body as R;

    it('pages newest first with the total; the summary covers every page', async () => {
      const p1 = await list(a, 'perPage=2');
      expect(p1).toMatchObject({ total: 3, page: 1, perPage: 2 });
      expect(p1.data.map((r) => r.id)).toEqual([
        sales[2].receivableId,
        sales[1].receivableId,
      ]);
      const p2 = await list(a, 'perPage=2&page=2');
      expect(p2.data.map((r) => r.id)).toEqual([sales[0].receivableId]);
      // Open: Bu Sari 6.000 + 18.000; Pak Budi settled.
      expect(p1.summary).toEqual({
        openRest: 24_000,
        openCount: 2,
        outsideShiftCollected: 0,
      });
      expect(p2.summary).toEqual({
        openRest: 24_000,
        openCount: 2,
        outsideShiftCollected: 0,
      });
      // The tab filters rows, not the summary.
      const settled = await list(a, 'status=settled');
      expect(settled.data.map((r) => r.memberName)).toEqual(['Pak Budi']);
      expect(settled.summary).toEqual({
        openRest: 24_000,
        openCount: 2,
        outsideShiftCollected: 0,
      });
    });

    it('searches by member name or sale number', async () => {
      const sari = await list(a, 'q=sari');
      expect(sari.total).toBe(2);
      expect(sari.summary).toEqual({
        openRest: 24_000,
        openCount: 2,
        outsideShiftCollected: 0,
      });
      const budi = await list(a, 'q=budi');
      expect(budi).toMatchObject({
        total: 1,
        summary: { openRest: 0, openCount: 0 },
      });
      const byNumber = await list(a, `q=%23${sales[2].number}`);
      expect(byNumber.data.map((r) => r.id)).toEqual([sales[2].receivableId]);
      expect((await list(a, 'q=tidak-ada')).total).toBe(0);
    });

    it('refuses bad paging and status with field messages', async () => {
      const r = await get(a, '/receivables?perPage=0&status=lunas').expect(422);
      expect(r.body.errors).toEqual({
        perPage: 'Minimal 1',
        status: 'Pilihan tidak valid',
      });
    });

    it('cross-tenant: store B sees none of store A, by search or sale number', async () => {
      expect(await list(b, '')).toMatchObject({
        data: [],
        total: 0,
        summary: { openRest: 0, openCount: 0 },
      });
      expect((await list(b, 'q=sari')).total).toBe(0);
      expect((await list(b, `q=${sales[0].number}`)).total).toBe(0);
    });
  });
});
