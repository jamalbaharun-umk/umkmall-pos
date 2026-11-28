import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;
type Row = { key: string; status: string; updatedAt: string };

/** UMK-2134: each person's coach-mark progress, kept on the server (design 46). */
describe('guide progress (UMK-2134)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const list = async (auth: string) =>
    (
      (
        await http()
          .get('/guides/progress')
          .set('Authorization', auth)
          .expect(200)
      ).body as { data: Row[] }
    ).data.map((r) => [r.key, r.status]);
  const mark = (auth: string, key: string, body: object) =>
    http().put(`/guides/progress/${key}`).set('Authorization', auth).send(body);

  let a: Store;
  let b: Store;
  beforeAll(async () => {
    app = await createApp();
    a = await createStore();
    b = await createStore();
  });
  afterAll(async () => {
    await app.close();
  });

  it('records a guide as done or skipped, once per person, and answers it back', async () => {
    expect(await list(a.auth)).toEqual([]);
    const done = await mark(a.auth, 'kasir', { status: 'done' }).expect(200);
    expect(done.body).toMatchObject({ key: 'kasir', status: 'done' });
    await mark(a.auth, 'catalog.products', { status: 'skipped' }).expect(200);
    // Marking again replaces the status, never a second row.
    await mark(a.auth, 'kasir', { status: 'skipped' }).expect(200);
    expect(await list(a.auth)).toEqual([
      ['catalog.products', 'skipped'],
      ['kasir', 'skipped'],
    ]);
  });

  it('"Ulangi" forgets one guide, "Ulangi semua" forgets every guide of that person only', async () => {
    const cashier = await createCashier(app, a, ['sales.create']);
    await mark(cashier.auth, 'kasir', { status: 'done' }).expect(200);
    await http()
      .delete('/guides/progress/kasir')
      .set('Authorization', a.auth)
      .expect(204);
    expect(await list(a.auth)).toEqual([['catalog.products', 'skipped']]);
    // The cashier keeps their own progress.
    expect(await list(cashier.auth)).toEqual([['kasir', 'done']]);
    await http()
      .delete('/guides/progress')
      .set('Authorization', a.auth)
      .expect(204);
    expect(await list(a.auth)).toEqual([]);
    expect(await list(cashier.auth)).toEqual([['kasir', 'done']]);
  });

  it('refuses a bad key or body with 422', async () => {
    for (const key of ['KASIR', 'a%20b', 'x'.repeat(61)])
      await mark(a.auth, key, { status: 'done' }).expect(422);
    for (const body of [{}, { status: 'seen' }, { status: 'done', at: 1 }])
      await mark(a.auth, 'kasir', body).expect(422);
    await http()
      .delete('/guides/progress/BAD!')
      .set('Authorization', a.auth)
      .expect(422);
  });

  it('needs a session; store B sees and clears nothing of store A', async () => {
    await http().get('/guides/progress').expect(401);
    await mark(a.auth, 'dashboard', { status: 'done' }).expect(200);
    expect(await list(b.auth)).toEqual([]);
    await http()
      .delete('/guides/progress')
      .set('Authorization', b.auth)
      .expect(204);
    expect(await list(a.auth)).toEqual([['dashboard', 'done']]);
  });
});
