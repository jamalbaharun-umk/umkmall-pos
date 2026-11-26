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
import { AGENT_TOOL_NAMES, redact } from '../src/agent/tools';
import { ADMIN_DATABASE_URL, APP_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';

// UMK-1978 (agent session), UMK-1979 (MCP read tools), UMK-1980 (write tools, HPP import), UMK-1982 (doc drift),
// and the New Teman AI alignment: consent scopes, revocation, usage and provenance, registry entries.

type Answer = (res: ServerResponse) => void;
const stub = {
  answer: (() => undefined) as Answer,
  cookies: [] as (string | undefined)[],
};
const READ_WRITE = ['pos.read', 'pos.write'];
const KEY = process.env.POS_AGENT_SERVICE_KEY!;

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

  afterEach(() => jest.restoreAllMocks());

  const http = () => request(app.getHttpServer());

  async function agentToken(
    userId: string,
    scopes: string[] = READ_WRITE,
    consentRef?: string,
  ): Promise<string> {
    const r = await http()
      .post('/auth/dev/agent-session')
      .send({ userId, scopes, ...(consentRef && { consentRef }) })
      .expect(200);
    return r.body.sessionToken as string;
  }

  async function mcp(
    token: string,
    headers: Record<string, string> = {},
  ): Promise<Client> {
    const client = new Client({ name: 'test-agent', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: {
          headers: { Authorization: `Bearer ${token}`, ...headers },
        },
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

  async function seedProduct(
    auth: string,
    name: string,
    price: number,
    sku?: string,
  ) {
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
        ...(sku && { sku }),
      })
      .expect(201);
    return p.body as { id: string; sku: string; categoryId: string };
  }

  const productCount = async (auth: string) =>
    (
      await http()
        .get('/catalog/products')
        .set('Authorization', auth)
        .expect(200)
    ).body.total as number;

  describe('agent session (UMK-1978)', () => {
    const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig-part_1';

    it('exchanges a UMKMall token for an agent session, sending only auth_token and relaying every Set-Cookie', async () => {
      const store = await createStore();
      stub.cookies = [];
      stub.answer = (res) => {
        res.setHeader('set-cookie', [
          'auth_token=renewed; Path=/',
          'auth_refresh=sid.secret; Path=/',
        ]);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: true, user: { id: store.userId } }));
      };
      const r = await http()
        .post('/auth/agent/session')
        .set('X-Pos-Agent-Key', KEY)
        .send({ token: TOKEN, scopes: ['pos.write'], consentRef: 'consent:1' })
        .expect(200);
      expect(stub.cookies).toEqual([`auth_token=${TOKEN}`]);
      // /auth/me can mint the session's refresh secret once: dropping it would sign the owner's browser out.
      expect(r.headers['set-cookie']).toEqual([
        'auth_token=renewed; Path=/',
        'auth_refresh=sid.secret; Path=/',
      ]);
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

    it('refuses an agent session without the service key, before asking UMKMall', async () => {
      stub.cookies = [];
      for (const key of [
        undefined,
        'wrong-key-wrong-key',
        process.env.POS_SERVICE_KEY!, // the purge key is not the agent's
      ])
        await (
          key
            ? http().post('/auth/agent/session').set('X-Pos-Agent-Key', key)
            : http().post('/auth/agent/session')
        )
          .send({ token: TOKEN, scopes: ['pos.write'] })
          .expect(401);
      expect(stub.cookies).toEqual([]);
    });

    it('maps 401 to 401, 5xx to 503 (cookies still relayed), and refuses a token that could break the cookie', async () => {
      stub.answer = (res) => {
        res.statusCode = 401;
        res.end('{}');
      };
      await http()
        .post('/auth/agent/session')
        .set('X-Pos-Agent-Key', KEY)
        .send({ token: TOKEN })
        .expect(401);
      stub.answer = (res) => {
        res.setHeader('set-cookie', ['auth_token=x; Path=/']);
        res.statusCode = 502;
        res.end('{}');
      };
      const down = await http()
        .post('/auth/agent/session')
        .set('X-Pos-Agent-Key', KEY)
        .send({ token: TOKEN })
        .expect(503);
      expect(down.headers['set-cookie']).toEqual(['auth_token=x; Path=/']);
      stub.cookies = [];
      await http()
        .post('/auth/agent/session')
        .set('X-Pos-Agent-Key', KEY)
        .send({ token: `${TOKEN}; auth_refresh=x` })
        .expect(422);
      expect(stub.cookies).toEqual([]);
    });

    it('opens the dev agent session only in an explicit development or test environment', async () => {
      const store = await createStore();
      const was = process.env.NODE_ENV;
      try {
        for (const env of ['production', undefined, 'staging']) {
          if (env === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = env;
          await http()
            .post('/auth/dev/agent-session')
            .send({ userId: store.userId })
            .expect(404);
        }
      } finally {
        process.env.NODE_ENV = was;
      }
    });

    it('reaches only the routes marked for the agent', async () => {
      const store = await createStore();
      const product = await seedProduct(store.auth, 'Kopi', 10000);
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
        ['patch', `/catalog/products/${product.id}`],
        ['delete', `/catalog/products/${product.id}`],
        ['put', '/store/profile'],
        ['put', '/reports/settings'],
        ['put', '/sales/settings'],
        ['get', '/staff'],
        ['get', '/members'],
        ['post', '/payment-methods'],
        ['get', '/expenses'],
        ['post', `/sales/${randomUUID()}/void`],
        ['post', '/shifts/current/close'],
        ['post', '/agent/access/revoke'],
      ] as const)
        await http()
          [method](path)
          .set('Authorization', auth)
          .send({ sellingPrice: 1 })
          .expect(403);
      const still = await http()
        .get(`/catalog/products/${product.id}`)
        .set('Authorization', store.auth)
        .expect(200);
      expect(still.body.sellingPrice).toBe(10000);
    });

    it('creates a product through REST with one base price only: no units, tiers or deactivation', async () => {
      const store = await createStore();
      const product = await seedProduct(store.auth, 'Teh', 5000);
      const auth = `Bearer ${await agentToken(store.userId)}`;
      const body = {
        name: 'Es Jeruk',
        categoryId: product.categoryId,
        sellingPrice: 6000,
      };
      for (const extra of [
        { priceTiers: [{ minQty: 10, price: 5000 }] },
        { units: [{ name: 'Dus', unitQty: 12, price: 60000 }] },
        { isActive: false },
      ])
        await http()
          .post('/catalog/products')
          .set('Authorization', auth)
          .send({ ...body, ...extra })
          .expect(422);
      await http()
        .post('/catalog/products')
        .set('Authorization', auth)
        .send(body)
        .expect(201);
    });

    it('a read-only consent reads but cannot write, over MCP or REST', async () => {
      const store = await createStore();
      const product = await seedProduct(store.auth, 'Roti', 8000);
      const token = await agentToken(store.userId, ['pos.read']);
      await http()
        .post('/catalog/categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'X' })
        .expect(403);
      const client = await mcp(token);
      expect(
        (await call(client, 'get_product', { productId: product.id })).data,
      ).toMatchObject({ costPrice: 4000 });
      const w = await call(client, 'create_category', {
        name: 'X',
        idempotencyKey: 'read-only-1',
        confirm: true,
      });
      expect(w.error).toMatch(/izin pos\.write/);
    });

    it('the owner turns the agent off for good: old sessions 401, no new one until the owner turns it on', async () => {
      const store = await createStore();
      const token = await agentToken(store.userId);
      await http()
        .get('/catalog/categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await http()
        .post('/agent/access/revoke')
        .set('Authorization', store.auth)
        .expect(200);
      await http()
        .get('/catalog/categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      // persistent: a second later the same owner's login still gets no agent session, by either route
      await new Promise((r) => setTimeout(r, 1100));
      const refused = await http()
        .post('/auth/dev/agent-session')
        .send({ userId: store.userId })
        .expect(403);
      expect(refused.body.message).toMatch(/mematikan akses agent/);
      stub.answer = (res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: true, user: { id: store.userId } }));
      };
      await http()
        .post('/auth/agent/session')
        .set('X-Pos-Agent-Key', KEY)
        .send({ token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig-part_1' })
        .expect(403);
      const state = await http()
        .get('/agent/access')
        .set('Authorization', store.auth)
        .expect(200);
      expect(state.body).toEqual({ enabled: false });
      // only the owner turns it on again; sessions revoked before stay refused
      await http()
        .post('/agent/access/enable')
        .set('Authorization', store.auth)
        .expect(200);
      const fresh = await agentToken(store.userId);
      await http()
        .get('/catalog/categories')
        .set('Authorization', `Bearer ${fresh}`)
        .expect(200);
      await http()
        .get('/catalog/categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      for (const path of ['/agent/access/enable', '/agent/access/revoke'])
        await http()
          .post(path)
          .set('Authorization', `Bearer ${fresh}`)
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

    it('lists exactly the documented tools, each with its registry entry', async () => {
      const store = await createStore();
      const client = await mcp(await agentToken(store.userId));
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual([...AGENT_TOOL_NAMES]);
      for (const t of tools)
        expect(t._meta?.['umkmall/registry']).toMatchObject({
          scope: expect.stringMatching(/^pos\.(read|write)$/) as string,
          connection: 'UMKMall POS',
          coinCost: 0,
        });
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
      const exact = await call(client, 'search_products', {
        sku: product.sku,
      });
      expect(
        (exact.data as { data: { id: string }[] }).data.map((p) => p.id),
      ).toEqual([product.id]);

      const one = await call(client, 'get_product', { productId: product.id });
      expect(one.data).toMatchObject({
        id: product.id,
        costPrice: 4000,
        sellingPrice: 15000,
      });

      const range = { from: '2026-11-01', to: '2026-11-26' };
      const sales = await http()
        .get('/reports/sales')
        .query(range)
        .set('Authorization', store.auth)
        .expect(200);
      const viaTool = (await call(client, 'sales_report', range)).data as {
        rows: Record<string, unknown>[];
      };
      expect(viaTool).toEqual({
        ...sales.body,
        rows: (sales.body.rows as Record<string, unknown>[]).map(
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          ({ cashier: _c, ...row }) => row,
        ),
      });
      expect(JSON.stringify(viaTool)).not.toMatch(/cashier/);
      for (const [tool, path] of [
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
      const ctx = await call(client, 'business_context');
      expect(ctx.data).toMatchObject({
        productCount: 1,
        categories: [expect.any(String)],
      });
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
      expect(
        (await call(client, 'get_product', { productId: randomUUID() })).error,
      ).toMatch(/tidak ditemukan/);
      expect(
        (await call(client, 'get_product', { productId: '../staff' })).error,
      ).toMatch(/productId tidak valid/);
    });

    it("cross-tenant: store B's agent sees and changes nothing of store A", async () => {
      const a = await createStore();
      const b = await createStore();
      const product = await seedProduct(a.auth, 'Rahasia A', 9000);
      const client = await mcp(await agentToken(b.userId));
      const found = await call(client, 'search_products', { q: 'Rahasia' });
      expect((found.data as { data: unknown[] }).data).toEqual([]);
      expect(
        (await call(client, 'search_products', { sku: product.sku })).data,
      ).toMatchObject({ data: [] });
      expect(
        (await call(client, 'get_product', { productId: product.id })).error,
      ).toBeDefined();
      expect(
        (await call(client, 'get_product_stock', { productId: product.id }))
          .error,
      ).toBeDefined();
      const made = await call(client, 'create_product', {
        name: 'Milik B',
        categoryId: product.categoryId,
        sellingPrice: 1000,
        idempotencyKey: `k-${randomUUID()}`,
        confirm: true,
      });
      expect(made.error).toMatch(/Kategori tidak ditemukan/);
      expect(await productCount(a.auth)).toBe(1);
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

    it('previews without writing, creates new SKUs once per key, and never touches an existing product', async () => {
      const store = await createStore();
      // A product the owner made by hand under an HPP SKU: the import must leave it exactly as it is.
      const handMade = await seedProduct(
        store.auth,
        'Teh Manis',
        7000,
        'UMK-hpp-teh',
      );
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
            action: 'exists',
            productId: handMade.id,
            current: { costPrice: 4000, sellingPrice: 7000 },
            sellingPrice: 5000,
          },
        ],
      });
      expect(await productCount(store.auth)).toBe(1);

      const first = await call(client, 'import_hpp_products', {
        products,
        idempotencyKey: key,
        confirm: true,
      });
      expect(first.data).toMatchObject({
        rows: [
          { ref: 'hpp-kopi', result: 'created', sku: 'UMK-hpp-kopi' },
          { ref: 'hpp-teh', result: 'exists' },
        ],
        provenance: {
          source: 'umkmall-pos',
          tool: 'import_hpp_products',
          by: 'agent',
        },
      });
      const list = await http()
        .get('/catalog/products')
        .query({ sku: 'UMK-hpp-kopi' })
        .set('Authorization', store.auth)
        .expect(200);
      expect(list.body.data[0]).toMatchObject({
        name: 'Kopi Susu',
        unit: 'Gelas',
        type: 'non_stock',
        costPrice: 4251,
        sellingPrice: 15000,
        category: expect.objectContaining({
          name: 'Dari HPP UMKMall',
        }) as object,
      });
      const teh = await http()
        .get(`/catalog/products/${handMade.id}`)
        .set('Authorization', store.auth)
        .expect(200);
      expect(teh.body).toMatchObject({ costPrice: 4000, sellingPrice: 7000 });

      // a retry with the same key and input answers the first result and writes nothing
      const retry = await call(client, 'import_hpp_products', {
        products,
        idempotencyKey: key,
        confirm: true,
      });
      expect(retry.data).toEqual(first.data);
      expect(await productCount(store.auth)).toBe(2);

      // the same key with another input is refused
      const reuse = await call(client, 'import_hpp_products', {
        products: [{ ...products[0], price: 16000 }],
        idempotencyKey: key,
        confirm: true,
      });
      expect(reuse.error).toMatch(/sudah dipakai/);

      // a new HPP run with a new price: the imported product stays as it is (the owner changes prices)
      const second = await call(client, 'import_hpp_products', {
        products: [{ ...products[0], cogs: 4500, price: 16000 }],
        idempotencyKey: `hpp-${randomUUID()}`,
        confirm: true,
      });
      expect(second.data).toMatchObject({
        rows: [
          {
            ref: 'hpp-kopi',
            result: 'exists',
            current: { costPrice: 4251, sellingPrice: 15000 },
            costPrice: 4500,
            sellingPrice: 16000,
          },
        ],
      });
      const [cats] = await appDb<{ n: number }[]>`
        select count(*)::int as n from pos.categories
         where tenant_id = ${store.tenantId} and name = 'Dari HPP UMKMall'`;
      expect(cats.n).toBe(1);
    });

    it('refuses bad rows and bad keys in Indonesian and leaves the key free', async () => {
      const store = await createStore();
      const client = await mcp(await agentToken(store.userId));
      const bad = await call(client, 'import_hpp_products', {
        products: [{ ref: 'a b', name: 'X', cogs: -1, price: 1.5 }],
        idempotencyKey: `hpp-${randomUUID()}`,
        confirm: true,
      });
      expect(bad.error).toMatch(/cogs tidak boleh negatif/);
      expect(bad.error).toMatch(/bilangan bulat rupiah/);
      const badKey = await call(client, 'create_category', {
        name: 'X',
        idempotencyKey: 'kunci dengan spasi',
        confirm: true,
      });
      expect(badKey.error).toMatch(/idempotencyKey wajib/);
      const refusedByRoute = await call(client, 'create_category', {
        name: '',
        idempotencyKey: 'cat-empty-1',
        confirm: true,
      });
      expect(refusedByRoute.error).toMatch(/wajib diisi/);
      const [row] = await appDb<{ n: number }[]>`
        select count(*)::int as n from pos.agent_requests where tenant_id = ${store.tenantId}`;
      expect(row.n).toBe(0);
      // the freed key works for the corrected call
      const fixed = await call(client, 'create_category', {
        name: 'Minuman',
        idempotencyKey: 'cat-empty-1',
        confirm: true,
      });
      expect(fixed.data).toMatchObject({ name: 'Minuman' });
    });

    it('keeps the key after a lost answer (5xx), so a retry can never write twice', async () => {
      const store = await createStore();
      const client = await mcp(await agentToken(store.userId));
      const realFetch = global.fetch;
      let failed = false;
      jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const res = await realFetch(input, init);
        // The route commits, then its answer is lost on the way back.
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (
          !failed &&
          url.endsWith('/catalog/categories') &&
          init?.method === 'POST'
        ) {
          failed = true;
          return new Response('{}', { status: 502 });
        }
        return res;
      });
      const lost = await call(client, 'create_category', {
        name: 'Makanan',
        idempotencyKey: 'cat-lost-1',
        confirm: true,
      });
      expect(lost.error).toMatch(/belum pasti/);
      const again = await call(client, 'create_category', {
        name: 'Makanan',
        idempotencyKey: 'cat-lost-1',
        confirm: true,
      });
      expect(again.error).toMatch(/belum pasti/);
      const [cats] = await appDb<{ n: number }[]>`
        select count(*)::int as n from pos.categories where tenant_id = ${store.tenantId}`;
      expect(cats.n).toBe(1);
    });

    it('records every call with its goal, assistant, run, mode and consent, and the ids a write made', async () => {
      const store = await createStore();
      const client = await mcp(
        await agentToken(store.userId, READ_WRITE, 'consent:ig-7'),
        {
          'X-Umkmall-Goal': 'goal:brand-1',
          'X-Umkmall-Assistant': 'asisten:harga',
          'X-Umkmall-Run': 'run:42',
          'X-Umkmall-Mode': 'agentic',
        },
      );
      await call(client, 'list_categories');
      await call(client, 'create_category', {
        name: 'Kue',
        idempotencyKey: 'cat-prov-1',
      });
      const made = await call(client, 'create_category', {
        name: 'Kue',
        idempotencyKey: 'cat-prov-1',
        confirm: true,
      });
      const id = (made.data as { id: string }).id;
      expect(made.data).toMatchObject({
        provenance: {
          goalRef: 'goal:brand-1',
          runRef: 'run:42',
          consentRef: 'consent:ig-7',
        },
      });
      const activity = await call(client, 'agent_activity', {});
      const rows = (activity.data as { data: Record<string, unknown>[] }).data;
      expect(rows.map((r) => [r.tool, r.outcome])).toEqual([
        ['create_category', 'ok'],
        ['create_category', 'preview'],
        ['list_categories', 'ok'],
      ]);
      expect(rows[0]).toMatchObject({
        goalRef: 'goal:brand-1',
        assistantRef: 'asisten:harga',
        runRef: 'run:42',
        mode: 'agentic',
        consentRef: 'consent:ig-7',
        resultRefs: [id],
      });
      // the owner sees the same activity (the activity call itself is the fourth row)
      const owner = await http()
        .get('/agent/activity')
        .set('Authorization', store.auth)
        .expect(200);
      expect(owner.body.data).toHaveLength(4);
      // a malformed context header is refused before any tool runs
      await http()
        .post('/mcp')
        .set('Authorization', `Bearer ${await agentToken(store.userId)}`)
        .set('X-Umkmall-Goal', 'goal with spaces')
        .send({})
        .expect(422);
    });
  });

  describe('HPP data for UMKMall (owner direction 2026-11-26)', () => {
    it('hpp_product_data gives each product its prices, stock, sales and real purchase costs, plus expenses', async () => {
      const store = await createStore();
      const cat = await http()
        .post('/catalog/categories')
        .set('Authorization', store.auth)
        .send({ name: 'Bahan' })
        .expect(201);
      const gula = await http()
        .post('/catalog/products')
        .set('Authorization', store.auth)
        .send({
          name: 'Gula',
          categoryId: cat.body.id,
          sellingPrice: 18000,
          costPrice: 14000,
          unit: 'kg',
        })
        .expect(201);
      const sup = await http()
        .post('/suppliers')
        .set('Authorization', store.auth)
        .send({
          name: 'Toko Grosir',
          phone: '081234567890',
          address: 'Jl. Pasar 1',
        })
        .expect(201);
      // Two deliveries at different prices.
      for (const [qty, unitCost] of [
        [10, 14000],
        [5, 15500],
      ]) {
        const po = await http()
          .post('/purchasing/orders')
          .set('Authorization', store.auth)
          .send({
            supplierId: sup.body.id,
            paymentMethod: 'Tunai',
            lines: [{ productId: gula.body.id, qty, unitCost }],
          })
          .expect(201);
        await http()
          .post(`/purchasing/orders/${po.body.id}/approve`)
          .set('Authorization', store.auth)
          .expect(200);
      }
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
      }).format(new Date());
      const client = await mcp(await agentToken(store.userId, ['pos.read']));
      const r = await call(client, 'hpp_product_data', {
        from: today,
        to: today,
      });
      expect(r.data).toMatchObject({
        from: today,
        to: today,
        total: 1,
        products: [
          {
            productId: gula.body.id,
            name: 'Gula',
            unit: 'kg',
            category: 'Bahan',
            sellingPrice: 18000,
            costPrice: 14000,
            stock: 15,
            sold: { qty: 0, averagePrice: null },
            purchases: {
              qty: 15,
              total: 217500,
              averageUnitCost: 14500,
              lastUnitCost: 15500,
            },
          },
        ],
        purchasesTruncated: false,
        operatingExpenses: { total: 0, byCategory: [] },
      });
      const bad = await call(client, 'hpp_product_data', {
        from: 'x',
        to: today,
      });
      expect(bad.error).toMatch(/Tanggal/);
    });
  });

  describe('sales, members, kasbon and suppliers (UMK-1981)', () => {
    async function openShift(auth: string, openingCash = 100000) {
      await http()
        .post('/shifts/open')
        .set('Authorization', auth)
        .send({ openingCash })
        .expect(201);
    }

    it("records a sale into the owner's open shift exactly as the till would, once per key", async () => {
      const store = await createStore();
      await http()
        .put('/sales/settings')
        .set('Authorization', store.auth)
        .send({ taxBps: 1100 })
        .expect(200);
      const kopi = await seedProduct(store.auth, 'Kopi Susu', 15123);
      const client = await mcp(await agentToken(store.userId));
      const cart = { lines: [{ productId: kopi.id, qty: 2 }] };

      // no open shift: the tool says so and records nothing
      const closed = await call(client, 'record_sale', {
        ...cart,
        idempotencyKey: 'sale-noshift-1',
        confirm: true,
      });
      expect(closed.error).toMatch(/Belum ada shift yang dibuka/);

      await openShift(store.auth);
      const preview = await call(client, 'record_sale', {
        ...cart,
        idempotencyKey: 'sale-agent-1',
      });
      expect(preview.error).toBeUndefined();
      // 30246 + 11% tax (3327) = 33573, cash rounded up to 33600
      expect(preview.data).toMatchObject({
        preview: true,
        quote: {
          subtotal: 30246,
          tax: 3327,
          total: 33573,
          rounding: 27,
          amountDue: 33600,
        },
      });
      const made = await call(client, 'record_sale', {
        ...cart,
        idempotencyKey: 'sale-agent-1',
        confirm: true,
      });
      const saleId = (made.data as { id: string }).id;
      const again = await call(client, 'record_sale', {
        ...cart,
        idempotencyKey: 'sale-agent-1',
        confirm: true,
      });
      // A replay answers the stored result, kept without customer data.
      expect(again.data).toEqual(redact('record_sale', made.data));

      // the same cart at the till
      const till = await http()
        .post('/sales')
        .set('Authorization', store.auth)
        .set('Idempotency-Key', `till-${randomUUID()}`)
        .send({ ...cart, paid: 33600 })
        .expect(201);
      const viaAgent = await http()
        .get(`/sales/${saleId}`)
        .set('Authorization', store.auth)
        .expect(200);
      const viaTill = await http()
        .get(`/sales/${till.body.id}`)
        .set('Authorization', store.auth)
        .expect(200);
      for (const k of [
        'subtotal',
        'tax',
        'total',
        'rounding',
        'paid',
        'costTotal',
        'shiftId',
      ])
        expect([k, viaAgent.body[k]]).toEqual([k, viaTill.body[k]]);
      const receipt = await http()
        .get(`/sales/${saleId}/receipt`)
        .set('Authorization', store.auth)
        .expect(200);
      expect(receipt.body.cashier).toBe('Agent UMKMall');
      const list = await http()
        .get('/sales')
        .set('Authorization', store.auth)
        .expect(200);
      expect(list.body.total).toBe(2);
    });

    it('never takes a price or a discount from the agent, over REST either', async () => {
      const store = await createStore();
      const kopi = await seedProduct(store.auth, 'Kopi', 10000);
      await openShift(store.auth);
      const auth = `Bearer ${await agentToken(store.userId)}`;
      // Each body would sell at the till's price if the agent schema let it through (paid = the full 10000), so each
      // case fails on the schema alone (revert-red: swap AgentSaleInput for SaleInput and they pass with 201).
      for (const body of [
        { lines: [{ productId: kopi.id, qty: 1, price: 1 }], paid: 10000 },
        {
          lines: [{ productId: kopi.id, qty: 1 }],
          discount: 5000,
          paid: 10000,
        },
        { lines: [{ productId: kopi.id, qty: 1 }], bank: 'BCA', paid: 10000 },
        { lines: [{ productId: kopi.id, qty: 1 }], extra: true, paid: 10000 },
      ])
        await http()
          .post('/sales')
          .set('Authorization', auth)
          .set('Idempotency-Key', `agent-${randomUUID()}`)
          .send(body)
          .expect(422);
    });

    it('refuses an online method for an agent sale in the service, not only in the tool', async () => {
      const store = await createStore();
      const kopi = await seedProduct(store.auth, 'Kopi', 10000);
      await openShift(store.auth);
      const [qris] = await appDb<{ id: string }[]>`
        insert into pos.payment_methods (tenant_id, name, is_online, gateway_method)
        values (${store.tenantId}, 'QRIS Online', true, 'fake_qris') returning id`;
      const r = await http()
        .post('/sales')
        .set('Authorization', `Bearer ${await agentToken(store.userId)}`)
        .set('Idempotency-Key', `agent-${randomUUID()}`)
        .send({
          lines: [{ productId: kopi.id, qty: 1 }],
          paymentMethodId: qris.id,
          paid: 10000,
        })
        .expect(422);
      expect(r.body.errors.paymentMethodId).toMatch(/lewat agent/);
      const [n] = await appDb<{ n: number }[]>`
        select count(*)::int as n from pos.sales where tenant_id = ${store.tenantId}`;
      expect(n.n).toBe(0);
    });

    it('after a lost answer, a retry with the SAME key replays the route and sells once', async () => {
      const store = await createStore();
      const kopi = await seedProduct(store.auth, 'Kopi', 10000);
      await openShift(store.auth);
      const client = await mcp(await agentToken(store.userId));
      const realFetch = global.fetch;
      let failed = false;
      jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const res = await realFetch(input, init);
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        // The sale commits, then its answer is lost (as when payment-api times out after the insert).
        if (!failed && url.endsWith('/sales') && init?.method === 'POST') {
          failed = true;
          return new Response('{}', { status: 503 });
        }
        return res;
      });
      const args = {
        lines: [{ productId: kopi.id, qty: 1 }],
        idempotencyKey: 'sale-lost-0001',
        confirm: true,
      };
      const lost = await call(client, 'record_sale', args);
      expect(lost.error).toMatch(/kunci yang SAMA/);
      jest.restoreAllMocks();
      // Prices change in between: the replay still sends the lost call's exact body.
      await http()
        .patch(`/catalog/products/${kopi.id}`)
        .set('Authorization', store.auth)
        .send({ sellingPrice: 12000 })
        .expect(200);
      const replayed = await call(client, 'record_sale', args);
      expect(replayed.data).toMatchObject({ total: 10000 });
      const again = await call(client, 'record_sale', args);
      expect(again.data).toEqual(redact('record_sale', replayed.data));
      const [n] = await appDb<{ n: number }[]>`
        select count(*)::int as n from pos.sales where tenant_id = ${store.tenantId}`;
      expect(n.n).toBe(1);
    });

    it('opens a shift only through its own tool, and not twice', async () => {
      const store = await createStore();
      const client = await mcp(await agentToken(store.userId));
      const p = await call(client, 'open_shift', {
        openingCash: 150000,
        idempotencyKey: 'shift-open-1',
      });
      expect(p.data).toMatchObject({ preview: true });
      await call(client, 'open_shift', {
        openingCash: 150000,
        idempotencyKey: 'shift-open-1',
        confirm: true,
      });
      const cur = await http()
        .get('/shifts/current')
        .set('Authorization', store.auth)
        .expect(200);
      expect(cur.body.shift).toMatchObject({ openingCash: 150000 });
      const twice = await call(client, 'open_shift', {
        openingCash: 1,
        idempotencyKey: 'shift-open-2',
      });
      expect(twice.error).toMatch(/sudah terbuka/);
    });

    it('a kasbon sale to a new member, then an instalment, each once', async () => {
      const store = await createStore();
      const roti = await seedProduct(store.auth, 'Roti', 20000);
      const kasbon = await http()
        .post('/payment-methods')
        .set('Authorization', store.auth)
        .send({ name: 'Kasbon', kind: 'credit' })
        .expect(201);
      await openShift(store.auth);
      const client = await mcp(await agentToken(store.userId));
      const member = await call(client, 'create_member', {
        name: 'Bu Sari',
        phone: '081234567890',
        idempotencyKey: 'member-0001',
        confirm: true,
      });
      expect(member.error).toBeUndefined();
      const memberId = (member.data as { id: string }).id;
      const found = await call(client, 'search_members', { q: 'Sari' });
      expect(
        (found.data as { data: { id: string }[] }).data.map((m) => m.id),
      ).toContain(memberId);

      await call(client, 'record_sale', {
        lines: [{ productId: roti.id, qty: 1 }],
        memberId,
        paymentMethodId: kasbon.body.id,
        downPayment: 5000,
        idempotencyKey: 'sale-kasbon-1',
        confirm: true,
      });
      const recs = await call(client, 'list_receivables', { memberId });
      const rec = (recs.data as { data: { id: string; rest: number }[] })
        .data[0];
      expect(rec.rest).toBe(15000);

      const preview = await call(client, 'record_receivable_payment', {
        receivableId: rec.id,
        amount: 6000,
        idempotencyKey: 'kasbon-pay-1',
      });
      expect(preview.data).toMatchObject({
        balanceBefore: 15000,
        balanceAfter: 9000,
      });
      for (let i = 0; i < 2; i += 1)
        await call(client, 'record_receivable_payment', {
          receivableId: rec.id,
          amount: 6000,
          idempotencyKey: 'kasbon-pay-1',
          confirm: true,
        });
      const after = await http()
        .get(`/receivables/${rec.id}`)
        .set('Authorization', store.auth)
        .expect(200);
      expect(after.body.rest).toBe(9000);
      const over = await call(client, 'record_receivable_payment', {
        receivableId: rec.id,
        amount: 10000,
        idempotencyKey: 'kasbon-pay-2',
        confirm: true,
      });
      expect(over.error).toMatch(/melebihi sisa piutang/);
    });

    it('adds a supplier and lists suppliers and payment methods', async () => {
      const store = await createStore();
      const client = await mcp(await agentToken(store.userId));
      await call(client, 'create_supplier', {
        name: 'Toko Grosir Jaya',
        idempotencyKey: 'supplier-0001',
        confirm: true,
      });
      const list = await call(client, 'list_suppliers');
      expect(
        (list.data as { data: { name: string }[] }).data.map((x) => x.name),
      ).toEqual(['Toko Grosir Jaya']);
      const methods = await call(client, 'list_payment_methods');
      expect(
        (methods.data as { data: unknown[] }).data.length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('a read-only consent can record nothing and read no member or kasbon data', async () => {
      const store = await createStore();
      const kopi = await seedProduct(store.auth, 'Kopi', 10000);
      await openShift(store.auth);
      const token = await agentToken(store.userId, ['pos.read']);
      const client = await mcp(token);
      const sale = await call(client, 'record_sale', {
        lines: [{ productId: kopi.id, qty: 1 }],
        idempotencyKey: 'ro-sale-1',
        confirm: true,
      });
      expect(sale.error).toMatch(/izin pos\.write/);
      for (const path of [
        '/members/picker',
        '/receivables',
        '/shifts/current',
        '/suppliers',
      ])
        await http()
          .get(path)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
    });

    it("cross-tenant: store B's agent cannot sell A's product or pay A's real kasbon", async () => {
      const a = await createStore();
      const b = await createStore();
      const kopi = await seedProduct(a.auth, 'Kopi A', 10000);
      // A real receivable of store A: a kasbon sale at A's till.
      const kasbon = await http()
        .post('/payment-methods')
        .set('Authorization', a.auth)
        .send({ name: 'Kasbon', kind: 'credit' })
        .expect(201);
      const member = await http()
        .post('/members')
        .set('Authorization', a.auth)
        .send({ name: 'Pelanggan A', code: 'PLGA01' })
        .expect(201);
      await openShift(a.auth);
      await http()
        .post('/sales')
        .set('Authorization', a.auth)
        .set('Idempotency-Key', `till-${randomUUID()}`)
        .send({
          lines: [{ productId: kopi.id, qty: 1 }],
          memberId: member.body.id,
          paymentMethodId: kasbon.body.id,
          paid: 0,
        })
        .expect(201);
      const recA = await http()
        .get('/receivables')
        .set('Authorization', a.auth)
        .expect(200);
      const receivableId = recA.body.data[0].id as string;

      await openShift(b.auth);
      const client = await mcp(await agentToken(b.userId));
      const sale = await call(client, 'record_sale', {
        lines: [{ productId: kopi.id, qty: 1 }],
        idempotencyKey: 'x-sale-0001',
        confirm: true,
      });
      expect(sale.error).toMatch(/tidak ditemukan/i);
      for (const confirm of [false, true]) {
        const pay = await call(client, 'record_receivable_payment', {
          receivableId,
          amount: 1000,
          idempotencyKey: 'x-pay-0001',
          confirm,
        });
        expect(pay.error).toMatch(/tidak ditemukan/i);
      }
      const still = await http()
        .get(`/receivables/${receivableId}`)
        .set('Authorization', a.auth)
        .expect(200);
      expect(still.body.rest).toBe(10000);
    });
  });

  describe('ledger feed and product photos (UMKMall Catatan Keuangan, Upgrade Foto)', () => {
    const PIN = '482913';
    // A 1x1 PNG.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    it('ledger_entries lists every money movement once, with ids, on the local day', async () => {
      const store = await createStore();
      const kopi = await seedProduct(store.auth, 'Kopi', 10000);
      const kasbon = await http()
        .post('/payment-methods')
        .set('Authorization', store.auth)
        .send({ name: 'Kasbon', kind: 'credit' })
        .expect(201);
      const member = await http()
        .post('/members')
        .set('Authorization', store.auth)
        .send({ name: 'Bu Sari', code: 'BS01' })
        .expect(201);
      await http()
        .put('/void-pin')
        .set('Authorization', store.freshAuth)
        .send({ pin: PIN })
        .expect(200);
      await http()
        .post('/shifts/open')
        .set('Authorization', store.auth)
        .send({ openingCash: 50000 })
        .expect(201);
      const sell = (body: object) =>
        http()
          .post('/sales')
          .set('Authorization', store.auth)
          .set('Idempotency-Key', `till-${randomUUID()}`)
          .send({ lines: [{ productId: kopi.id, qty: 1 }], ...body })
          .expect(201);
      const cash = await sell({ paid: 20000 }); // change 10000: 10000 came in
      await sell({ paid: 10000 });
      await sell({
        memberId: member.body.id,
        paymentMethodId: kasbon.body.id,
        paid: 3000,
      });
      const recs = await http()
        .get('/receivables')
        .set('Authorization', store.auth)
        .expect(200);
      await http()
        .post(`/receivables/${recs.body.data[0].id}/payments`)
        .set('Authorization', store.auth)
        .set('Idempotency-Key', `pay-${randomUUID()}`)
        .send({ amount: 2000 })
        .expect(201);
      await http()
        .post(`/sales/${cash.body.id}/void`)
        .set('Authorization', store.auth)
        .set('Idempotency-Key', `void-${randomUUID()}`)
        .send({
          reasonCode: 'customer_cancelled',
          approverId: store.userId,
          pin: PIN,
        })
        .expect(201);
      await http()
        .post('/expenses')
        .set('Authorization', store.auth)
        .set('Idempotency-Key', `exp-${randomUUID()}`)
        .send({ amount: 15000, category: 'sewa', source: 'outside' })
        .expect(201);
      await http()
        .post('/shifts/current/cash-entries')
        .set('Authorization', store.auth)
        .set('Idempotency-Key', `cash-${randomUUID()}`)
        .send({ direction: 'out', amount: 5000, reason: 'ambil_pemilik' })
        .expect(201);

      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
      }).format(new Date());
      const client = await mcp(await agentToken(store.userId, ['pos.read']));
      const r = await call(client, 'ledger_entries', {
        from: today,
        to: today,
      });
      const data = r.data as {
        truncated: boolean;
        totals: { in: number; out: number; net: number };
        entries: {
          id: string;
          date: string;
          direction: string;
          kind: string;
          label: string;
          amount: number;
          receiptNumber: number | null;
        }[];
      };
      const byKind = data.entries
        .map((e) => [e.kind, e.direction, e.amount])
        .sort();
      expect(byKind).toEqual(
        [
          ['cash_out', 'out', 5000],
          ['expense', 'out', 15000],
          ['kasbon_payment', 'in', 2000],
          ['kasbon_payment', 'in', 3000],
          ['refund', 'out', 10000],
          ['sale', 'in', 10000],
          ['sale', 'in', 10000],
        ].sort(),
      );
      expect(data.totals).toEqual({ in: 25000, out: 30000, net: -5000 });
      expect(data.truncated).toBe(false);
      expect(new Set(data.entries.map((e) => e.id)).size).toBe(7);
      expect(data.entries.every((e) => e.date === today)).toBe(true);
      expect(data.entries.find((e) => e.kind === 'cash_out')?.label).toBe(
        'Diambil pemilik',
      );
      expect(data.entries.find((e) => e.kind === 'expense')?.label).toBe(
        'Sewa',
      );
      // The voided sale stays as money that came in, and its refund is money that went out, both on its receipt.
      const voided = cash.body.number as number;
      expect(
        data.entries
          .filter((e) => e.receiptNumber === voided)
          .map((e) => [e.kind, e.direction, e.amount]),
      ).toEqual([
        ['sale', 'in', 10000],
        ['refund', 'out', 10000],
      ]);
      // the same pull again: the same ids
      const again = await call(client, 'ledger_entries', {
        from: today,
        to: today,
      });
      expect((again.data as typeof data).entries.map((e) => e.id)).toEqual(
        data.entries.map((e) => e.id),
      );
      // another store's agent sees none of it
      const other = await createStore();
      const theirs = await call(
        await mcp(await agentToken(other.userId, ['pos.read'])),
        'ledger_entries',
        {
          from: today,
          to: today,
        },
      );
      expect((theirs.data as typeof data).entries).toEqual([]);
    });

    it('ledger_entries stops at 2000 entries and says truncated', async () => {
      const store = await createStore();
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
      }).format(new Date());
      await appDb`
        insert into pos.expenses (tenant_id, kind, category, amount, expense_date, source, actor_id, actor_kind,
                                  idempotency_key, request_hash)
        select ${store.tenantId}, 'expense', 'lainnya', 1000, ${today}::date, 'outside', ${store.userId}, 'owner',
               'bulk-' || g, 'h'
          from generate_series(1, 2001) g`;
      const client = await mcp(await agentToken(store.userId, ['pos.read']));
      const r = await call(client, 'ledger_entries', {
        from: today,
        to: today,
      });
      const data = r.data as { truncated: boolean; entries: unknown[] };
      expect(data.truncated).toBe(true);
      expect(data.entries).toHaveLength(2000);
    });

    it('caps the photos the agent may add to one product', async () => {
      const store = await createStore();
      const kopi = await seedProduct(store.auth, 'Kopi', 10000);
      await appDb`
        insert into pos.product_images (tenant_id, product_id, storage_key, content_type, size_bytes)
        select ${store.tenantId}, ${kopi.id}, 'tenants/x/' || g, 'image/png', 10
          from generate_series(1, 10) g`;
      const client = await mcp(await agentToken(store.userId));
      const r = await call(client, 'add_product_photo', {
        productId: kopi.id,
        imageBase64: PNG.toString('base64'),
        idempotencyKey: 'photo-cap-0001',
        confirm: true,
      });
      expect(r.error).toMatch(/sudah punya 10 foto/);
    });

    it('add_product_photo appends a photo once per key, needs pos.write, and refuses a bad file', async () => {
      const store = await createStore();
      const kopi = await seedProduct(store.auth, 'Kopi', 10000);
      const client = await mcp(await agentToken(store.userId));
      const args = {
        productId: kopi.id,
        imageBase64: PNG.toString('base64'),
        idempotencyKey: 'photo-0001',
      };
      expect(
        (await call(client, 'add_product_photo', args)).data,
      ).toMatchObject({
        preview: true,
        product: 'Kopi',
        sizeBytes: PNG.length,
      });
      const made = await call(client, 'add_product_photo', {
        ...args,
        confirm: true,
      });
      const again = await call(client, 'add_product_photo', {
        ...args,
        confirm: true,
      });
      expect(again.data).toEqual(made.data);
      const product = await http()
        .get(`/catalog/products/${kopi.id}`)
        .set('Authorization', store.auth)
        .expect(200);
      expect(product.body.images).toHaveLength(1);
      const bad = await call(client, 'add_product_photo', {
        ...args,
        imageBase64: Buffer.from('not an image').toString('base64'),
        idempotencyKey: 'photo-0002',
        confirm: true,
      });
      expect(bad.error).toMatch(/JPG, PNG atau WebP/);
      const readOnly = await mcp(await agentToken(store.userId, ['pos.read']));
      expect(
        (
          await call(readOnly, 'add_product_photo', {
            ...args,
            idempotencyKey: 'photo-0003',
            confirm: true,
          })
        ).error,
      ).toMatch(/izin pos\.write/);
      // still no way to delete one
      await http()
        .delete(
          `/catalog/products/${kopi.id}/images/${(made.data as { id: string }).id}`,
        )
        .set('Authorization', `Bearer ${await agentToken(store.userId)}`)
        .expect(403);
    });
  });

  describe('E2E findings (UMK-2069, UMK-2070)', () => {
    it('record_sale says which price and discount it ignored, and sells at the catalog price', async () => {
      const store = await createStore();
      const kopi = await seedProduct(store.auth, 'Kopi', 10000);
      await http()
        .post('/shifts/open')
        .set('Authorization', store.auth)
        .send({ openingCash: 0 })
        .expect(201);
      const client = await mcp(await agentToken(store.userId));
      const args = {
        lines: [
          {
            productId: kopi.id,
            qty: 1,
            price: 1,
            discountPercent: 50,
            discountAmount: 1.5,
          },
        ],
        discount: 5000,
        idempotencyKey: 'sale-price-0001',
      };
      const preview = await call(client, 'record_sale', args);
      expect(preview.data).toMatchObject({
        ignored: {
          // A non-whole number is not echoed (nor used).
          linePrices: [
            { productId: kopi.id, sentPrice: 1, sentDiscountPercent: 50 },
          ],
          discount: 5000,
        },
        quote: { total: 10000 },
      });
      const made = await call(client, 'record_sale', {
        ...args,
        confirm: true,
      });
      expect(made.data).toMatchObject({
        total: 10000,
        ignored: { linePrices: [{ sentPrice: 1 }] },
      });
      const clean = await call(client, 'record_sale', {
        lines: [{ productId: kopi.id, qty: 1 }],
        idempotencyKey: 'sale-price-0002',
      });
      expect(clean.data).not.toHaveProperty('ignored');
    });

    async function stockStore() {
      const store = await createStore();
      const cat = await http()
        .post('/catalog/categories')
        .set('Authorization', store.auth)
        .send({ name: 'Bahan' })
        .expect(201);
      const gula = await http()
        .post('/catalog/products')
        .set('Authorization', store.auth)
        .send({
          name: 'Gula',
          categoryId: cat.body.id,
          sellingPrice: 18000,
          type: 'product',
        })
        .expect(201);
      const sup = await http()
        .post('/suppliers')
        .set('Authorization', store.auth)
        .send({ name: 'Toko Grosir' })
        .expect(201);
      const onHand = async () =>
        (
          await http()
            .get(`/stock/products/${gula.body.id}`)
            .set('Authorization', store.auth)
            .expect(200)
        ).body.onHand as number;
      return {
        store,
        productId: gula.body.id as string,
        supplierId: sup.body.id as string,
        onHand,
      };
    }

    it('stock_in previews stock before and after, then receives the stock once per key', async () => {
      const { store, productId, supplierId, onHand } = await stockStore();
      const client = await mcp(await agentToken(store.userId));
      const args = {
        supplierId,
        lines: [{ productId, qty: 10, unitCost: 14000 }],
        idempotencyKey: 'stock-in-0001',
      };
      expect((await call(client, 'stock_in', args)).data).toMatchObject({
        preview: true,
        lines: [{ name: 'Gula', stockBefore: 0, stockAfter: 10 }],
        total: 140000,
      });
      expect(await onHand()).toBe(0);
      await call(client, 'stock_in', { ...args, confirm: true });
      await call(client, 'stock_in', { ...args, confirm: true });
      expect(await onHand()).toBe(10);
      const read = await mcp(await agentToken(store.userId, ['pos.read']));
      expect(
        (
          await call(read, 'stock_in', {
            ...args,
            idempotencyKey: 'stock-in-0002',
            confirm: true,
          })
        ).error,
      ).toMatch(/izin pos\.write/);
    });

    it('stock_in after a lost answer replays under the same key: one purchase, stock once', async () => {
      const { store, productId, supplierId, onHand } = await stockStore();
      const client = await mcp(await agentToken(store.userId));
      const realFetch = global.fetch;
      let failed = false;
      jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const res = await realFetch(input, init);
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        // The purchase is written and received, then its answer is lost.
        if (!failed && url.endsWith('/stock-in') && init?.method === 'POST') {
          failed = true;
          return new Response('{}', { status: 502 });
        }
        return res;
      });
      const args = {
        supplierId,
        lines: [{ productId, qty: 5, unitCost: 15000 }],
        idempotencyKey: 'stock-lost-0001',
        confirm: true,
      };
      expect((await call(client, 'stock_in', args)).error).toMatch(
        /kunci yang SAMA/,
      );
      jest.restoreAllMocks();
      expect((await call(client, 'stock_in', args)).data).toMatchObject({
        status: 'approved',
      });
      expect(await onHand()).toBe(5);
      const [n] = await appDb<{ n: number }[]>`
        select count(*)::int as n from pos.purchase_orders where tenant_id = ${store.tenantId}`;
      expect(n.n).toBe(1);
    });

    it('two stock-in requests with one key at once make one purchase and receive the stock once', async () => {
      const { store, productId, supplierId, onHand } = await stockStore();
      const auth = `Bearer ${await agentToken(store.userId)}`;
      const send = () =>
        http()
          .post('/purchasing/orders/stock-in')
          .set('Authorization', auth)
          .set('Idempotency-Key', 'same-key-00001')
          .send({ supplierId, lines: [{ productId, qty: 3, unitCost: 1000 }] });
      const [a, b] = await Promise.all([send(), send()]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(await onHand()).toBe(3);
      // the same key with another body is refused
      const other = await http()
        .post('/purchasing/orders/stock-in')
        .set('Authorization', auth)
        .set('Idempotency-Key', 'same-key-00001')
        .send({ supplierId, lines: [{ productId, qty: 4, unitCost: 1000 }] })
        .expect(422);
      expect(other.body.errors.idempotencyKey).toMatch(/sudah dipakai/);
      expect(await onHand()).toBe(3);
    });

    it('the agent can neither create a draft purchase nor approve one', async () => {
      const { store, productId, supplierId, onHand } = await stockStore();
      const draft = await http()
        .post('/purchasing/orders')
        .set('Authorization', store.auth)
        .send({ supplierId, lines: [{ productId, qty: 7, unitCost: 1000 }] })
        .expect(201);
      const auth = `Bearer ${await agentToken(store.userId)}`;
      await http()
        .post(`/purchasing/orders/${draft.body.id}/approve`)
        .set('Authorization', auth)
        .expect(403);
      await http()
        .post('/purchasing/orders')
        .set('Authorization', auth)
        .send({ supplierId, lines: [{ productId, qty: 1, unitCost: 1 }] })
        .expect(403);
      expect(await onHand()).toBe(0);
    });

    it('stock_in previews only what the route would take', async () => {
      const { store, productId, supplierId } = await stockStore();
      const client = await mcp(await agentToken(store.userId));
      for (const [line, msg] of [
        [{ productId, qty: 1.5, unitCost: 1000 }, /bilangan bulat/],
        [{ productId, qty: 100_001, unitCost: 1000 }, /maksimal 100.000/],
        [
          { productId, qty: 1, unitCost: 1_000_000_001 },
          /maksimal Rp1.000.000.000/,
        ],
      ] as const) {
        const r = await call(client, 'stock_in', {
          supplierId,
          lines: [line],
          idempotencyKey: `bounds-${randomUUID()}`,
        });
        expect(r.error).toMatch(msg);
      }
    });

    it("stock_in refuses a product without stock tracking and another store's supplier", async () => {
      const { store, productId } = await stockStore();
      const menu = await seedProduct(store.auth, 'Es Teh', 5000);
      const client = await mcp(await agentToken(store.userId));
      const other = await createStore();
      const theirSup = await http()
        .post('/suppliers')
        .set('Authorization', other.auth)
        .send({ name: 'Pemasok B' })
        .expect(201);
      const nonStock = await call(client, 'stock_in', {
        supplierId: theirSup.body.id,
        lines: [{ productId: menu.id, qty: 1, unitCost: 1000 }],
        idempotencyKey: 'stock-bad-0001',
      });
      expect(nonStock.error).toMatch(/tidak dilacak stoknya/);
      const foreign = await call(client, 'stock_in', {
        supplierId: theirSup.body.id,
        lines: [{ productId, qty: 1, unitCost: 1000 }],
        idempotencyKey: 'stock-bad-0002',
        confirm: true,
      });
      expect(foreign.error).toBeDefined();
      const [n] = await appDb<{ n: number }[]>`
        select count(*)::int as n from pos.purchase_orders where tenant_id = ${store.tenantId}`;
      expect(n.n).toBe(0);
    });
  });

  describe('UMK-1981 review follow-ups', () => {
    it('keeps no customer name or phone in the stored answer; a replay answers without them', async () => {
      const store = await createStore();
      const client = await mcp(await agentToken(store.userId));
      const args = {
        name: 'Bu Ratna',
        phone: '081298765432',
        idempotencyKey: 'member-pii-0001',
        confirm: true,
      };
      const first = await call(client, 'create_member', args);
      expect(first.data).toMatchObject({
        name: 'Bu Ratna',
        phone: '081298765432',
      });
      expect((first.data as { code: string }).code).toMatch(/^AG[0-9A-F]{10}$/);
      const [row] = await appDb<{ answer: string }[]>`
        select answer::text as answer from pos.agent_requests where tenant_id = ${store.tenantId}`;
      expect(row.answer).not.toMatch(/Ratna|081298765432/);
      const replay = await call(client, 'create_member', args);
      expect(replay.data).toMatchObject({
        id: (first.data as { id: string }).id,
      });
      expect(replay.data).not.toHaveProperty('name');
      expect(replay.data).not.toHaveProperty('phone');
    });

    it('labels agent sales "Agent UMKMall" in the sales list', async () => {
      const store = await createStore();
      const kopi = await seedProduct(store.auth, 'Kopi', 10000);
      await http()
        .post('/shifts/open')
        .set('Authorization', store.auth)
        .send({ openingCash: 0 })
        .expect(201);
      const client = await mcp(await agentToken(store.userId));
      await call(client, 'record_sale', {
        lines: [{ productId: kopi.id, qty: 1 }],
        idempotencyKey: 'label-sale-0001',
        confirm: true,
      });
      const list = await http()
        .get('/sales')
        .set('Authorization', store.auth)
        .expect(200);
      expect(list.body.data[0].cashier).toBe('Agent UMKMall');
    });

    it('previews refuse what the confirm would refuse: kasbon without a member, an instalment over the balance', async () => {
      const store = await createStore();
      const roti = await seedProduct(store.auth, 'Roti', 20000);
      const kasbon = await http()
        .post('/payment-methods')
        .set('Authorization', store.auth)
        .send({ name: 'Kasbon', kind: 'credit' })
        .expect(201);
      await http()
        .post('/shifts/open')
        .set('Authorization', store.auth)
        .send({ openingCash: 0 })
        .expect(201);
      const client = await mcp(await agentToken(store.userId));
      const noMember = await call(client, 'record_sale', {
        lines: [{ productId: roti.id, qty: 1 }],
        paymentMethodId: kasbon.body.id,
        idempotencyKey: 'prev-kasbon-0001',
      });
      expect(noMember.error).toMatch(/Pilih member/);
      const member = await call(client, 'create_member', {
        name: 'Pak Budi',
        code: 'PB01',
        idempotencyKey: 'prev-member-0001',
        confirm: true,
      });
      const memberId = (member.data as { id: string }).id;
      const ok = await call(client, 'record_sale', {
        lines: [{ productId: roti.id, qty: 1 }],
        paymentMethodId: kasbon.body.id,
        memberId,
        downPayment: 5000,
        idempotencyKey: 'prev-kasbon-0002',
      });
      expect(ok.data).toMatchObject({ wouldPay: 5000, kasbonRest: 15000 });
      await call(client, 'record_sale', {
        lines: [{ productId: roti.id, qty: 1 }],
        paymentMethodId: kasbon.body.id,
        memberId,
        downPayment: 5000,
        idempotencyKey: 'prev-kasbon-0002',
        confirm: true,
      });
      const recs = await call(client, 'list_receivables', { memberId });
      const rec = (recs.data as { data: { id: string }[] }).data[0];
      const over = await call(client, 'record_receivable_payment', {
        receivableId: rec.id,
        amount: 20000,
        idempotencyKey: 'prev-pay-0001',
      });
      expect(over.error).toMatch(/melebihi sisa piutang/);
      const blank = await call(client, 'create_supplier', {
        name: '  ',
        idempotencyKey: 'prev-supp-0001',
      });
      expect(blank.error).toMatch(/Nama wajib diisi/);
    });
  });

  describe('review follow-ups', () => {
    it('an off switch refuses a live session even without a revocation time', async () => {
      const store = await createStore();
      const token = await agentToken(store.userId);
      await appDb`insert into pos.agent_access (tenant_id, enabled) values (${store.tenantId}, false)`;
      await http()
        .get('/catalog/categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('drops call records past the retention window of the same store only', async () => {
      const a = await createStore();
      const b = await createStore();
      for (const s of [a, b])
        await appDb`insert into pos.agent_tool_calls (tenant_id, tool, outcome, actor_id, duration_ms, created_at)
          values (${s.tenantId}, 'old', 'ok', ${s.userId}, 1, now() - interval '200 days')`;
      const client = await mcp(await agentToken(a.userId));
      await call(client, 'list_categories');
      const rows = await appDb<{ tenant_id: string; tool: string }[]>`
        select tenant_id, tool from pos.agent_tool_calls
         where tenant_id in (${a.tenantId}, ${b.tenantId}) order by tool`;
      expect(rows).toEqual([
        { tenant_id: a.tenantId, tool: 'list_categories' },
        { tenant_id: b.tenantId, tool: 'old' },
      ]);
    });

    it('the owner dev sign-in also needs an explicit development or test environment', async () => {
      const store = await createStore();
      const was = process.env.NODE_ENV;
      try {
        delete process.env.NODE_ENV;
        await http()
          .post('/auth/dev/sign-in')
          .send({ userId: store.userId })
          .expect(404);
      } finally {
        process.env.NODE_ENV = was;
      }
    });

    // Last in the file: it spends this address's agent-session budget.
    it('limits /mcp per store, with an Indonesian 429', async () => {
      const store = await createStore();
      const auth = `Bearer ${await agentToken(store.userId)}`;
      let status = 0;
      for (let i = 0; i <= 300 && status !== 429; i += 1)
        status = (await http().post('/mcp').set('Authorization', auth).send({}))
          .status;
      expect(status).toBe(429);
      const r = await http().post('/mcp').set('Authorization', auth).send({});
      expect(r.status).toBe(429);
      expect(r.body.message).toMatch(/Terlalu banyak permintaan agent/);
      // another store is not affected
      const other = await createStore();
      const ok = await http()
        .post('/mcp')
        .set('Authorization', `Bearer ${await agentToken(other.userId)}`)
        .send({});
      expect(ok.status).not.toBe(429);
    });

    it('limits failed agent-key checks per address; a valid key is never limited', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 40 && !codes.includes(429); i += 1)
        codes.push(
          (
            await http()
              .post('/auth/agent/session')
              .set('X-Pos-Agent-Key', 'wrong-key-wrong-key')
              .send({ token: 'x'.repeat(20) })
          ).status,
        );
      expect(codes.at(-1)).toBe(429);
      expect(codes.length).toBeLessThanOrEqual(31);
      // UMKMall's backend shares the address but holds the key: it still gets its session.
      const store = await createStore();
      stub.answer = (res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: true, user: { id: store.userId } }));
      };
      await http()
        .post('/auth/agent/session')
        .set('X-Pos-Agent-Key', KEY)
        .send({ token: 'x'.repeat(20) })
        .expect(200);
    });
  });
});
