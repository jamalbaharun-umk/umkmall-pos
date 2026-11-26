import { INestApplication } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import postgres from 'postgres';
import request from 'supertest';
import { withMargins } from '../src/agent/hpp';
import { AGENT_TOOL_NAMES } from '../src/agent/tools';
import { ADMIN_DATABASE_URL, APP_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';

// UMK-1978 (agent session), UMK-1979 (MCP read tools), UMK-1980 (write tools, HPP import), UMK-1982 (doc drift).

type Answer = (res: ServerResponse) => void;
const stub = {
  answer: (() => undefined) as Answer,
  cookies: [] as (string | undefined)[],
};

describe('UMKMall agent: session and MCP tools', () => {
  let app: INestApplication;
  let base: string;
  let umkmall: Server;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  const appDb = postgres(APP_DATABASE_URL, { max: 1 });
  const clients: Client[] = [];

  beforeAll(async () => {
    umkmall = createServer((req, res) => {
      if (req.url === '/api/auth/me' && req.method === 'GET') {
        stub.cookies.push(req.headers.cookie);
        return stub.answer(res);
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => umkmall.listen(0, '127.0.0.1', r));
    process.env.UMKMALL_WEB_URL = `http://127.0.0.1:${(umkmall.address() as AddressInfo).port}`;
    app = await createApp();
    // The tools call pos-api over loopback, so the app listens on a real port.
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as Server;
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
    await admin.end();
    await appDb.end();
    await new Promise((r) => umkmall.close(r));
  });

  const http = () => request(app.getHttpServer());

  async function agentToken(userId: string): Promise<string> {
    const r = await http()
      .post('/auth/dev/agent-session')
      .send({ userId })
      .expect(200);
    return r.body.sessionToken as string;
  }

  async function mcp(token: string): Promise<Client> {
    const client = new Client({ name: 'test-agent', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    return client;
  }

  async function call(
    client: Client,
    name: string,
    args: Record<string, unknown> = {},
  ) {
    const r = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    const text = r.content[0].text;
    if (r.isError) return { error: text };
    return { data: JSON.parse(text) as Record<string, unknown> };
  }

  async function seedProduct(auth: string, name: string, price: number) {
    const cat = await http()
      .post('/catalog/categories')
      .set('Authorization', auth)
      .send({ name: `Kat ${randomUUID().slice(0, 6)}` })
      .expect(201);
    const p = await http()
      .post('/catalog/products')
      .set('Authorization', auth)
      .send({
        name,
        categoryId: cat.body.id,
        sellingPrice: price,
        costPrice: 4000,
        type: 'non_stock',
      })
      .expect(201);
    return p.body as { id: string; sku: string };
  }

  describe('agent session (UMK-1978)', () => {
    const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig-part_1';

    it('exchanges a UMKMall token for an agent session, sending only the auth_token cookie', async () => {
      const store = await createStore();
      stub.cookies = [];
      stub.answer = (res) => {
        res.setHeader('set-cookie', ['auth_token=renewed; Path=/']);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: true, user: { id: store.userId } }));
      };
      const r = await http()
        .post('/auth/agent/session')
        .send({ token: TOKEN })
        .expect(200);
      expect(stub.cookies).toEqual([`auth_token=${TOKEN}`]);
      // An agent holds no browser: nothing is relayed.
      expect(r.headers['set-cookie']).toBeUndefined();
      expect(r.body).toMatchObject({
        expiresIn: 900,
        tenant: { id: store.tenantId },
      });
      const me = await http()
        .get('/catalog/categories')
        .set('Authorization', `Bearer ${r.body.sessionToken}`)
        .expect(200);
      expect(me.body).toEqual({ data: [] });
    });

    it('maps 401 to 401, 5xx to 503, and refuses a token that could break the cookie', async () => {
      stub.answer = (res) => {
        res.statusCode = 401;
        res.end('{}');
      };
      await http()
        .post('/auth/agent/session')
        .send({ token: TOKEN })
        .expect(401);
      stub.answer = (res) => {
        res.statusCode = 502;
        res.end('{}');
      };
      await http()
        .post('/auth/agent/session')
        .send({ token: TOKEN })
        .expect(503);
      stub.cookies = [];
      await http()
        .post('/auth/agent/session')
        .send({ token: `${TOKEN}; auth_refresh=x` })
        .expect(422);
      expect(stub.cookies).toEqual([]);
    });

    it('refuses the dev agent session in production', async () => {
      const store = await createStore();
      const was = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await http()
          .post('/auth/dev/agent-session')
          .send({ userId: store.userId })
          .expect(404);
      } finally {
        process.env.NODE_ENV = was;
      }
    });

    it('reaches only the routes marked for the agent: settings, staff and the rest answer 403', async () => {
      const store = await createStore();
      const auth = `Bearer ${await agentToken(store.userId)}`;
      await http()
        .get('/catalog/categories')
        .set('Authorization', auth)
        .expect(200);
      await http()
        .get('/reports/sales?from=2026-11-01&to=2026-11-26')
        .set('Authorization', auth)
        .expect(200);
      for (const [method, path] of [
        ['get', '/store/profile'],
        ['put', '/reports/settings'],
        ['put', '/sales/settings'],
        ['get', '/staff'],
        ['post', '/payment-methods'],
        ['get', '/expenses'],
        ['post', '/sales'],
        ['delete', `/catalog/products/${randomUUID()}`],
      ] as const)
        await http()
          [method](path)
          .set('Authorization', auth)
          .send({})
          .expect(403);
    });
  });

  describe('MCP server (UMK-1979)', () => {
    it('answers 401 without a token and 403 to an owner session', async () => {
      const store = await createStore();
      await http().post('/mcp').send({}).expect(401);
      await http()
        .post('/mcp')
        .set('Authorization', store.auth)
        .send({})
        .expect(403);
    });

    it('lists exactly the documented tools', async () => {
      const store = await createStore();
      const client = await mcp(await agentToken(store.userId));
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual([...AGENT_TOOL_NAMES]);
      const doc = readFileSync(
        join(__dirname, '../../../docs/agent-integration.md'),
        'utf8',
      );
      const documented = [...doc.matchAll(/^### `([a-z_]+)`/gm)].map(
        (m) => m[1],
      );
      expect(documented).toEqual([...AGENT_TOOL_NAMES]);
    });

    it('read tools answer what the REST routes answer', async () => {
      const store = await createStore();
      const product = await seedProduct(store.auth, 'Kopi Susu', 15000);
      const client = await mcp(await agentToken(store.userId));

      const rest = await http()
        .get('/catalog/products')
        .query({ q: 'Kopi' })
        .set('Authorization', store.auth)
        .expect(200);
      expect(
        (await call(client, 'search_products', { q: 'Kopi' })).data,
      ).toEqual(rest.body);

      const one = await call(client, 'get_product', { productId: product.id });
      expect(one.data).toMatchObject({
        id: product.id,
        costPrice: 4000,
        sellingPrice: 15000,
      });

      const range = { from: '2026-11-01', to: '2026-11-26' };
      for (const [tool, path] of [
        ['sales_report', '/reports/sales'],
        ['product_report', '/reports/products'],
        ['purchasing_report', '/reports/purchasing'],
      ] as const) {
        const viaRest = await http()
          .get(path)
          .query(range)
          .set('Authorization', store.auth)
          .expect(200);
        expect((await call(client, tool, range)).data).toEqual(viaRest.body);
      }
      const pl = await http()
        .get('/reports/profit-loss')
        .query({ period: 'month' })
        .set('Authorization', store.auth)
        .expect(200);
      expect(
        (await call(client, 'profit_loss', { period: 'month' })).data,
      ).toEqual(pl.body);
      const dash = await http()
        .get('/reports/dashboard')
        .query({ period: 'week' })
        .set('Authorization', store.auth)
        .expect(200);
      expect(
        (await call(client, 'store_summary', { period: 'week' })).data,
      ).toEqual(dash.body);
      const cats = await call(client, 'list_categories');
      expect((cats.data as { data: unknown[] }).data).toHaveLength(1);
    });

    it('product_margins adds average price, unit cost and margin to the products report', async () => {
      const store = await createStore();
      const client = await mcp(await agentToken(store.userId));
      expect(
        withMargins([
          {
            productId: 'p',
            sku: 'UMK-hpp_1',
            name: 'Kopi',
            qty: 3,
            sales: 45000,
            cost: 12500,
            grossProfit: 32500,
          },
          {
            productId: 'q',
            sku: 'SKU-1',
            name: 'Gratis',
            qty: 0,
            sales: 0,
            cost: 0,
            grossProfit: 0,
          },
        ]),
      ).toEqual([
        expect.objectContaining({
          hppRef: 'hpp_1',
          averagePrice: 15000,
          averageUnitCost: 4167,
          marginPercent: 72.2,
        }),
        expect.objectContaining({
          hppRef: null,
          averagePrice: null,
          averageUnitCost: null,
          marginPercent: null,
        }),
      ]);
      const r = await call(client, 'product_margins', {
        from: '2026-11-01',
        to: '2026-11-26',
      });
      expect(r.data).toMatchObject({ rows: [] });
    });

    it("a refused input comes back as the route's Indonesian message, never a stack", async () => {
      const store = await createStore();
      const client = await mcp(await agentToken(store.userId));
      const r = await call(client, 'sales_report', {
        from: 'kemarin',
        to: '2026-11-26',
      });
      expect(r.error).toBe('Tanggal mulai harus berformat TTTT-BB-HH');
      expect(r.error).not.toMatch(/\n\s+at |Error:|stack/);
      const missing = await call(client, 'get_product', {
        productId: randomUUID(),
      });
      expect(missing.error).toMatch(/tidak ditemukan/);
    });

    it("cross-tenant: store B's agent sees and changes nothing of store A", async () => {
      const a = await createStore();
      const b = await createStore();
      const product = await seedProduct(a.auth, 'Rahasia A', 9000);
      const client = await mcp(await agentToken(b.userId));
      const found = await call(client, 'search_products', { q: 'Rahasia' });
      expect((found.data as { data: unknown[] }).data).toEqual([]);
      expect(
        (await call(client, 'get_product', { productId: product.id })).error,
      ).toBeDefined();
      expect(
        (await call(client, 'get_product_stock', { productId: product.id }))
          .error,
      ).toBeDefined();
      const upd = await call(client, 'update_product', {
        productId: product.id,
        sellingPrice: 1,
        confirm: true,
        idempotencyKey: `k-${randomUUID()}`,
      });
      expect(upd.error).toBeDefined();
      const still = await http()
        .get(`/catalog/products/${product.id}`)
        .set('Authorization', a.auth)
        .expect(200);
      expect(still.body.sellingPrice).toBe(9000);
    });
  });

  describe('write tools and the HPP import (UMK-1980)', () => {
    const products = [
      {
        ref: 'hpp-kopi',
        name: 'Kopi Susu',
        cogs: 4250.4,
        price: 15000,
        unit: 'Gelas',
      },
      { ref: 'hpp-teh', name: 'Es Teh', cogs: 1200, price: 5000 },
    ];

    it('previews without writing, imports once per key, then updates by ref', async () => {
      const store = await createStore();
      const client = await mcp(await agentToken(store.userId));
      const key = `hpp-${randomUUID()}`;

      const preview = await call(client, 'import_hpp_products', {
        products,
        idempotencyKey: key,
      });
      expect(preview.data).toMatchObject({
        preview: true,
        rows: [
          {
            ref: 'hpp-kopi',
            action: 'create',
            costPrice: 4251,
            sellingPrice: 15000,
          },
          {
            ref: 'hpp-teh',
            action: 'create',
            costPrice: 1200,
            sellingPrice: 5000,
          },
        ],
      });
      const none = await http()
        .get('/catalog/products')
        .set('Authorization', store.auth)
        .expect(200);
      expect(none.body.total).toBe(0);

      const first = await call(client, 'import_hpp_products', {
        products,
        idempotencyKey: key,
        confirm: true,
      });
      expect(first.data).toMatchObject({
        rows: [
          { ref: 'hpp-kopi', result: 'created', sku: 'UMK-hpp-kopi' },
          { ref: 'hpp-teh', result: 'created', sku: 'UMK-hpp-teh' },
        ],
      });
      const list = await http()
        .get('/catalog/products')
        .set('Authorization', store.auth)
        .expect(200);
      expect(list.body.total).toBe(2);
      const kopi = (
        list.body as { data: { id: string; sku: string }[] }
      ).data.find((p) => p.sku === 'UMK-hpp-kopi')!;
      expect(kopi).toMatchObject({
        name: 'Kopi Susu',
        unit: 'Gelas',
        type: 'non_stock',
        costPrice: 4251,
        sellingPrice: 15000,
        category: expect.objectContaining({ name: 'Dari HPP UMKMall' }),
      });

      // a retry with the same key and input answers the first result and writes nothing
      const retry = await call(client, 'import_hpp_products', {
        products,
        idempotencyKey: key,
        confirm: true,
      });
      expect(retry.data).toEqual(first.data);
      const after = await http()
        .get('/catalog/products')
        .set('Authorization', store.auth)
        .expect(200);
      expect(after.body.total).toBe(2);

      // the same key with another input is refused
      const reuse = await call(client, 'import_hpp_products', {
        products: [{ ...products[0], price: 16000 }],
        idempotencyKey: key,
        confirm: true,
      });
      expect(reuse.error).toMatch(/sudah dipakai/);

      // a new HPP run: the changed product is updated, the other is unchanged, nothing is duplicated
      const second = await call(client, 'import_hpp_products', {
        products: [{ ...products[0], cogs: 4500, price: 16000 }, products[1]],
        idempotencyKey: `hpp-${randomUUID()}`,
        confirm: true,
      });
      expect(second.data).toMatchObject({
        rows: [
          {
            ref: 'hpp-kopi',
            result: 'updated',
            before: { costPrice: 4251, sellingPrice: 15000 },
            costPrice: 4500,
          },
          { ref: 'hpp-teh', result: 'unchanged' },
        ],
      });
      const [cats] = await appDb<{ n: number }[]>`
        select count(*)::int as n from pos.categories where tenant_id = ${store.tenantId}`;
      expect(cats.n).toBe(1);
      const final = await http()
        .get(`/catalog/products/${kopi.id}`)
        .set('Authorization', store.auth)
        .expect(200);
      expect(final.body).toMatchObject({
        costPrice: 4500,
        sellingPrice: 16000,
      });
    });

    it('refuses bad rows in Indonesian and leaves the key free', async () => {
      const store = await createStore();
      const client = await mcp(await agentToken(store.userId));
      const key = `hpp-${randomUUID()}`;
      const bad = await call(client, 'import_hpp_products', {
        products: [{ ref: 'a b', name: 'X', cogs: -1, price: 1.5 }],
        idempotencyKey: key,
        confirm: true,
      });
      expect(bad.error).toMatch(/cogs tidak boleh negatif/);
      expect(bad.error).toMatch(/bilangan bulat rupiah/);
      const [row] = await appDb<{ n: number }[]>`
        select count(*)::int as n from pos.agent_requests where tenant_id = ${store.tenantId}`;
      expect(row.n).toBe(0);
    });

    it('create and update previews change nothing; confirm applies once', async () => {
      const store = await createStore();
      const client = await mcp(await agentToken(store.userId));
      const cat = await call(client, 'create_category', {
        name: 'Minuman',
        idempotencyKey: 'cat-key-1',
        confirm: true,
      });
      const categoryId = (cat.data as { id: string }).id;
      const input = {
        name: 'Air Mineral',
        categoryId,
        sellingPrice: 4000,
        idempotencyKey: 'prod-key-1',
      };
      expect((await call(client, 'create_product', input)).data).toMatchObject({
        preview: true,
      });
      const made = await call(client, 'create_product', {
        ...input,
        confirm: true,
      });
      const again = await call(client, 'create_product', {
        ...input,
        confirm: true,
      });
      expect(again.data).toEqual(made.data);
      const id = (made.data as { id: string }).id;
      const prev = await call(client, 'update_product', {
        productId: id,
        sellingPrice: 4500,
        idempotencyKey: 'upd-key-1',
      });
      expect(prev.data).toMatchObject({
        before: { sellingPrice: 4000 },
        after: { sellingPrice: 4500 },
      });
      const unchanged = await http()
        .get(`/catalog/products/${id}`)
        .set('Authorization', store.auth)
        .expect(200);
      expect(unchanged.body.sellingPrice).toBe(4000);
      await call(client, 'update_product', {
        productId: id,
        sellingPrice: 4500,
        idempotencyKey: 'upd-key-1',
        confirm: true,
      });
      const changed = await http()
        .get(`/catalog/products/${id}`)
        .set('Authorization', store.auth)
        .expect(200);
      expect(changed.body.sellingPrice).toBe(4500);
      const list = await http()
        .get('/catalog/products')
        .set('Authorization', store.auth)
        .expect(200);
      expect(list.body.total).toBe(1);
    });
  });
});
