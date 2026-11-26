import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { PosSession } from '../tenancy/session';
import {
  costFromCogs,
  HPP_CATEGORY,
  HPP_MAX_ROWS,
  hppSku,
  withMargins,
} from './hpp';
import type { AgentIdempotency } from './idempotency';
import { callRoute, type Loopback, type RouteAnswer } from './loopback';
import type { AgentUsage, CallContext } from './usage';

// The MCP tools UMKMall's agent calls (UMK-1979, UMK-1980), shaped for New Teman AI: every tool carries a registry
// description (scope, modes, who it suits, the manual path), every call is recorded with the goal, assistant and run
// it served, reading and writing are separate consented scopes, and a write previews before it runs once per key.
// Each tool calls existing routes over loopback with the caller's token. Owner ruling (24 Nov 2026): the agent
// creates products but never changes an existing product's price, voids, or moves drawer cash.
// docs/agent-integration.md lists every tool (test/agent.e2e-spec.ts fails when the list drifts).

const SERVER_TROUBLE = 'Terjadi kesalahan di POS. Coba lagi sebentar lagi.';
const NO_WRITE_CONSENT =
  'Pemilik belum mengizinkan agent mengubah data POS (izin pos.write). Minta izinnya di Koneksi UMKMall.';
const UNKNOWN_OUTCOME =
  'Hasilnya belum pasti karena POS tidak menjawab. Cek katalog dulu; bila memang belum tercatat, kirim lagi dengan kunci baru.';
const KEY_RE = /^[A-Za-z0-9:._-]{8,100}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAD_ID = 'productId tidak valid: kirim id produk dari search_products.';

const ok = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});
const refused = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: message }],
});
const answer = (r: RouteAnswer) => (r.ok ? ok(r.data) : refused(r.message));
/** 0 (no answer) or 5xx: the write may have happened. */
const outcomeUnknown = (status: number) => status === 0 || status >= 500;
const idParam = (raw: unknown): string | null =>
  typeof raw === 'string' && UUID_RE.test(raw) ? raw : null;
type Query = Record<string, string | number | boolean | undefined>;

const text = (max: number) => z.string().max(max);
const dateRange = {
  from: text(10).describe('Start date, YYYY-MM-DD, store timezone'),
  to: text(10).describe('End date, YYYY-MM-DD, store timezone'),
};
const writeControls = {
  confirm: z
    .boolean()
    .optional()
    .describe('true applies the change; without it the tool only previews'),
  idempotencyKey: text(100).describe(
    '8 to 100 of A-Z a-z 0-9 : . _ -, unique per intended change; a retry with the same key and input returns the first result',
  ),
};

/** New Teman AI solution registry entry, the same shape for every tool (`_meta['umkmall/registry']`). */
export type Registry = {
  scope: 'pos.read' | 'pos.write';
  /** agentic: the agent does it and the owner approves; guided: the agent drafts, the owner finishes in the POS. */
  modes: ('agentic' | 'guided')[];
  suits: string;
  /** Where the owner does it by hand in pos-web (prefix the POS web origin): the hand-over path. */
  manualPath: string | null;
  connection: 'UMKMall POS';
  /** Coins are off (D3); usage is recorded in pos.agent_tool_calls. */
  coinCost: 0;
};
const reads = (suits: string, manualPath: string | null): Registry => ({
  scope: 'pos.read',
  modes: ['agentic'],
  suits,
  manualPath,
  connection: 'UMKMall POS',
  coinCost: 0,
});
const writes = (suits: string, manualPath: string): Registry => ({
  scope: 'pos.write',
  modes: ['agentic', 'guided'],
  suits,
  manualPath,
  connection: 'UMKMall POS',
  coinCost: 0,
});

/** The tool names, in the order the server lists them (the docs test compares against this). */
export const AGENT_TOOL_NAMES = [
  'business_context',
  'search_products',
  'get_product',
  'get_product_stock',
  'list_categories',
  'store_summary',
  'sales_report',
  'product_report',
  'product_margins',
  'profit_loss',
  'purchasing_report',
  'agent_activity',
  'create_category',
  'create_product',
  'import_hpp_products',
] as const;

const HppRow = z
  .object({
    ref: z
      .string()
      .regex(
        /^[A-Za-z0-9_-]{1,40}$/,
        'ref: 1 sampai 40 huruf, angka, - atau _',
      ),
    name: z.string().trim().min(1, 'Nama produk wajib diisi').max(120),
    cogs: z
      .number({ invalid_type_error: 'cogs harus berupa angka' })
      .finite()
      .min(0, 'cogs tidak boleh negatif')
      .max(1_000_000_000_000, 'cogs terlalu besar'),
    price: z
      .number({ invalid_type_error: 'price harus berupa angka' })
      .int('price harus bilangan bulat rupiah')
      .positive('price harus lebih dari 0')
      .max(1_000_000_000_000, 'price terlalu besar'),
    unit: z.string().trim().min(1).max(20).optional(),
  })
  .strict();
const HppRows = z
  .array(HppRow)
  .min(1, 'Kirim minimal 1 produk')
  .max(HPP_MAX_ROWS, `Maksimal ${HPP_MAX_ROWS} produk per panggilan`)
  .refine(
    (rows) => new Set(rows.map((r) => r.ref)).size === rows.length,
    'ref tidak boleh ganda',
  );

type Product = {
  id: string;
  sku: string;
  name: string;
  costPrice?: number;
  sellingPrice: number;
};
type RunResult =
  { data: object; resultRefs?: string[] } | { error: string; status: number };
/** What the tracking wrapper hands each tool, so the call record knows how it ended. */
type Track = { outcome?: 'preview'; resultRefs?: string[] };
type Run = (
  args: Record<string, unknown>,
  track: Track,
) => Promise<CallToolResult>;

export function buildAgentServer(
  session: PosSession,
  ctx: Loopback,
  deps: { idempotency: AgentIdempotency; usage: AgentUsage },
  context: CallContext,
): McpServer {
  const server = new McpServer({ name: 'umkmall-pos', version: '1.0.0' });
  const get = (path: string, query?: Query) =>
    callRoute(ctx, 'GET', path, { query });

  /** Registers a tool with its registry entry, a generic-error catch and the usage/provenance record. */
  const tool = (
    name: (typeof AGENT_TOOL_NAMES)[number],
    config: {
      description: string;
      inputSchema: z.ZodRawShape;
      registry: Registry;
    },
    run: Run,
  ) =>
    server.registerTool(
      name,
      {
        description: config.description,
        inputSchema: config.inputSchema,
        annotations: { readOnlyHint: config.registry.scope === 'pos.read' },
        _meta: { 'umkmall/registry': config.registry },
      },
      async (args: Record<string, unknown>) => {
        const started = Date.now();
        const track: Track = {};
        let result: CallToolResult;
        try {
          result = await run(args, track);
        } catch {
          result = refused(SERVER_TROUBLE);
        }
        await deps.usage.record({
          ...context,
          tenantId: session.tenantId,
          actorId: session.actorId,
          consentRef: session.consentRef,
          tool: name,
          outcome: result.isError ? 'refused' : (track.outcome ?? 'ok'),
          resultRefs: track.resultRefs,
          durationMs: Date.now() - started,
        });
        return result;
      },
    );

  /** Provenance every write answer carries (New Teman AI: results keep their source). */
  const provenance = (toolName: string) => ({
    source: 'umkmall-pos',
    tool: toolName,
    by: 'agent',
    actorId: session.actorId,
    goalRef: context.goalRef ?? null,
    assistantRef: context.assistantRef ?? null,
    runRef: context.runRef ?? null,
    consentRef: session.consentRef ?? null,
    at: new Date().toISOString(),
  });

  /** Preview, or run once per key: the shared shape of every write tool. */
  const runWrite = async (
    toolName: string,
    args: Record<string, unknown>,
    track: Track,
    preview: () => Promise<CallToolResult>,
    run: () => Promise<RunResult>,
  ): Promise<CallToolResult> => {
    if (!session.agentScopes?.includes('pos.write'))
      return refused(NO_WRITE_CONSENT);
    const key = args.idempotencyKey;
    if (typeof key !== 'string' || !KEY_RE.test(key))
      return refused(
        'idempotencyKey wajib: 8 sampai 100 karakter huruf, angka, titik dua, titik, garis bawah atau tanda hubung.',
      );
    if (args.confirm !== true) {
      track.outcome = 'preview';
      return preview();
    }
    const { confirm: _c, idempotencyKey: _k, ...rest } = args;
    void _c;
    void _k;
    const claim = await deps.idempotency.claim(
      session.tenantId,
      key,
      toolName,
      rest,
    );
    if (claim.kind === 'refused') return refused(claim.message);
    if (claim.kind === 'replay') {
      const stored = claim.answer as {
        unknownOutcome?: boolean;
        message?: string;
      };
      return stored.unknownOutcome
        ? refused(stored.message ?? UNKNOWN_OUTCOME)
        : ok(claim.answer);
    }
    let result: RunResult;
    try {
      result = await run();
    } catch {
      result = { error: UNKNOWN_OUTCOME, status: 0 };
    }
    if ('error' in result) {
      if (outcomeUnknown(result.status)) {
        // The route may have committed before its answer was lost: the key stays taken.
        await deps.idempotency.unknown(session.tenantId, key, UNKNOWN_OUTCOME);
        return refused(UNKNOWN_OUTCOME);
      }
      // Refused (4xx): nothing was written, so the key is free for a corrected retry.
      await deps.idempotency.release(session.tenantId, key);
      return refused(result.error);
    }
    const data = { ...result.data, provenance: provenance(toolName) };
    await deps.idempotency.finish(session.tenantId, key, data);
    track.resultRefs = result.resultRefs;
    return ok(data);
  };

  /** POST a body; a created row's id becomes the call's result ref. */
  const create = async (path: string, body: unknown): Promise<RunResult> => {
    const r = await callRoute(ctx, 'POST', path, { body });
    if (!r.ok) return { error: r.message, status: r.status };
    const data = r.data as { id: string };
    return { data, resultRefs: [data.id] };
  };

  tool(
    'business_context',
    {
      description:
        'The business layer of New Teman AI context, from the POS: store name and type, categories, product count and this month in figures. Read it at the start of a session instead of asking the owner to re-explain their business.',
      inputSchema: {},
      registry: reads(
        'Every assistant and goal that needs to know what the shop sells',
        '/',
      ),
    },
    async () => {
      const [profile, cats, products, month] = await Promise.all([
        get('/store/profile'),
        get('/catalog/categories'),
        get('/catalog/products', { perPage: 1 }),
        get('/reports/dashboard', { period: 'month' }),
      ]);
      if (!profile.ok) return refused(profile.message);
      if (!cats.ok) return refused(cats.message);
      if (!products.ok) return refused(products.message);
      if (!month.ok) return refused(month.message);
      const p = profile.data as Record<string, unknown>;
      return ok({
        store: {
          name: p.name ?? null,
          businessType: p.businessType ?? null,
          otherBusinessType: p.otherBusinessType ?? null,
          address: p.address ?? null,
        },
        categories: (cats.data as { data: { name: string }[] }).data.map(
          (c) => c.name,
        ),
        productCount: (products.data as { total: number }).total,
        thisMonth: month.data,
      });
    },
  );

  tool(
    'search_products',
    {
      description:
        'Search the store catalog by name, SKU or barcode, or find one exact sku. Returns products with price, unit, stock (null for non-stock items) and cost price.',
      inputSchema: {
        q: text(100).optional(),
        sku: text(64).optional().describe('Exact SKU, e.g. UMK-<ref>'),
        categoryId: text(64).optional(),
        stock: z
          .enum(['low', 'out'])
          .optional()
          .describe('Only low or out-of-stock tracked products'),
        page: z.number().int().optional(),
        perPage: z.number().int().optional().describe('1 to 100, default 20'),
      },
      registry: reads(
        'Chat replies, labels and captions that need a product, its price or stock',
        '/catalog/products',
      ),
    },
    async (a) => answer(await get('/catalog/products', a as Query)),
  );

  tool(
    'get_product',
    {
      description:
        'One product with its units, wholesale tiers, barcodes and cost price.',
      inputSchema: { productId: text(64) },
      registry: reads(
        'Any step that works on one product',
        '/catalog/products',
      ),
    },
    async ({ productId }) => {
      const id = idParam(productId);
      return id
        ? answer(await get(`/catalog/products/${id}`))
        : refused(BAD_ID);
    },
  );

  tool(
    'get_product_stock',
    {
      description:
        'Stock on hand of one product, with its batches and their unit cost (FIFO).',
      inputSchema: { productId: text(64) },
      registry: reads(
        'Restock advice and "is it available" replies',
        '/catalog/products',
      ),
    },
    async ({ productId }) => {
      const id = idParam(productId);
      return id ? answer(await get(`/stock/products/${id}`)) : refused(BAD_ID);
    },
  );

  tool(
    'list_categories',
    {
      description: 'Every product category of the store.',
      inputSchema: {},
      registry: reads(
        'Choosing a category before create_product',
        '/catalog/categories',
      ),
    },
    async () => answer(await get('/catalog/categories')),
  );

  tool(
    'store_summary',
    {
      description:
        'Dashboard figures for a period: sales, transactions, gross profit and top products.',
      inputSchema: {
        period: z.enum(['today', 'week', 'month', 'year']).optional(),
      },
      registry: reads(
        'Goal reports and assistants that need a quick picture of the shop',
        '/',
      ),
    },
    async (a) => answer(await get('/reports/dashboard', a as Query)),
  );

  tool(
    'sales_report',
    {
      description:
        'Sales in a date range (store timezone): every completed sale and the totals (gross sales, discounts, tax, revenue, cost, gross profit). Revenue counts kasbon sales too.',
      inputSchema: dateRange,
      registry: reads(
        'Catatan Keuangan, cashflow and capital templates',
        '/laporan',
      ),
    },
    async (a) => answer(await get('/reports/sales', a as Query)),
  );

  tool(
    'product_report',
    {
      description:
        'Per product in a date range: quantity sold (base units), sales, cost of goods and gross profit.',
      inputSchema: dateRange,
      registry: reads(
        'Strategi Harga dan Profit, best-seller insights',
        '/laporan',
      ),
    },
    async (a) => answer(await get('/reports/products', a as Query)),
  );

  tool(
    'product_margins',
    {
      description:
        'Actual margins per product in a date range, for comparing with a UMKMall HPP plan: average selling price, average unit cost, margin percent. hppRef is the UMKMall HPP product ref for products imported with import_hpp_products.',
      inputSchema: dateRange,
      registry: reads(
        'Strategi Harga dan Profit: planned vs actual margin in the goal report',
        '/laporan',
      ),
    },
    async (a) => {
      const r = await get('/reports/products', a as Query);
      if (!r.ok) return refused(r.message);
      const report = r.data as {
        rows: Parameters<typeof withMargins>[0];
      } & Record<string, unknown>;
      return ok({ ...report, rows: withMargins(report.rows) });
    },
  );

  tool(
    'profit_loss',
    {
      description:
        'Profit and loss: revenue (without tax), cost of goods, gross profit, operating expenses by category and net profit, next to the previous period of the same length. Give either period or from and to.',
      inputSchema: {
        period: z.enum(['today', 'week', 'month']).optional(),
        from: text(10).optional(),
        to: text(10).optional(),
      },
      registry: reads(
        'Catatan Keuangan (laba rugi), cashflow and capital templates',
        '/laporan',
      ),
    },
    async (a) => answer(await get('/reports/profit-loss', a as Query)),
  );

  tool(
    'purchasing_report',
    {
      description:
        'Stock purchases received in a date range, per supplier and per product, with unit costs. Real ingredient costs for the next HPP run.',
      inputSchema: dateRange,
      registry: reads(
        'HPP (ingredient costs), Catatan Keuangan (belanja)',
        '/pembelian',
      ),
    },
    async (a) => answer(await get('/reports/purchasing', a as Query)),
  );

  tool(
    'agent_activity',
    {
      description:
        "What UMKMall's agent did in this store: each call with its tool, outcome, goal, assistant, run, consent and the ids it created. For Hasil Saya and the goal report's provenance.",
      inputSchema: {
        days: z.number().int().optional().describe('1 to 90, default 7'),
        limit: z.number().int().optional().describe('1 to 500, default 100'),
      },
      registry: reads(
        'Hasil Saya and Rapor Goal: where each POS result came from',
        null,
      ),
    },
    async (a) => answer(await get('/agent/activity', a as Query)),
  );

  tool(
    'create_category',
    {
      description: 'Create a product category. Preview without confirm.',
      inputSchema: { name: text(200), ...writeControls },
      registry: writes('Setting up a new catalog', '/catalog/categories'),
    },
    async (a, track) =>
      runWrite(
        'create_category',
        a,
        track,
        () =>
          Promise.resolve(ok({ preview: true, wouldCreate: { name: a.name } })),
        () => create('/catalog/categories', { name: a.name }),
      ),
  );

  tool(
    'create_product',
    {
      description:
        'Create a product with one base price (name, categoryId and sellingPrice required; no extra units or wholesale tiers). type "non_stock" for a menu item made to order; "product" tracks stock. The agent cannot change a product afterwards: price changes are the owner\'s, in the POS. Preview without confirm.',
      inputSchema: {
        name: text(200),
        categoryId: text(64),
        sellingPrice: z.number().describe('Integer rupiah'),
        sku: text(100).optional(),
        unit: text(40).optional(),
        costPrice: z.number().optional().describe('Integer rupiah'),
        type: z.enum(['product', 'service', 'non_stock']).optional(),
        lowStockThreshold: z.number().optional(),
        barcodes: z.array(text(100)).max(20).optional(),
        ...writeControls,
      },
      registry: writes(
        'Adding products the owner named in chat or a photo',
        '/catalog/products',
      ),
    },
    async (a, track) => {
      const { confirm: _c, idempotencyKey: _k, ...body } = a;
      void _c;
      void _k;
      return runWrite(
        'create_product',
        a,
        track,
        () => Promise.resolve(ok({ preview: true, wouldCreate: body })),
        () => create('/catalog/products', body),
      );
    },
  );

  tool(
    'import_hpp_products',
    {
      description:
        'Put UMKMall HPP results into the POS catalog as NEW products. Each row: ref (the UMKMall HPP product id), name, cogs (variable cost per unit: ingredients and modal; NEVER the HPP with fixed costs, which the POS books as expenses), price (the chosen selling price), unit. A new ref creates a non-stock product in category "Dari HPP UMKMall" with SKU UMK-<ref>, cost rounded up to whole rupiah. A ref whose SKU already exists is left untouched (action "exists", with its current and the proposed figures): the agent never changes an existing product\'s price; the owner does that in the POS. Preview without confirm.',
      inputSchema: {
        products: z
          .array(
            z.object({
              ref: text(40),
              name: text(200),
              cogs: z.number(),
              price: z.number(),
              unit: text(20).optional(),
            }),
          )
          .describe(`1 to ${HPP_MAX_ROWS} rows`),
        ...writeControls,
      },
      registry: writes(
        'Strategi Harga dan Profit and the HPP calculator: "Pakai di POS"',
        '/catalog/products',
      ),
    },
    async (a, track) => {
      const parsed = HppRows.safeParse(a.products);
      if (!parsed.success)
        return refused(
          parsed.error.issues
            .map((i) =>
              i.path.length > 0
                ? `produk ${i.path.join('.')}: ${i.message}`
                : i.message,
            )
            .join('; '),
        );
      const rows = parsed.data;

      type PlanRow = {
        ref: string;
        sku: string;
        name: string;
        unit?: string;
        productId: string | null;
        action: 'create' | 'exists';
        costPrice: number;
        sellingPrice: number;
        current: { costPrice: number | null; sellingPrice: number } | null;
      };
      const plan = async (): Promise<
        { error: string; status: number } | { rows: PlanRow[] }
      > => {
        const out: PlanRow[] = [];
        for (const row of rows) {
          const sku = hppSku(row.ref);
          const r = await get('/catalog/products', { sku, perPage: 1 });
          if (!r.ok) return { error: r.message, status: r.status };
          const hit = (r.data as { data: Product[] }).data.find(
            (p) => p.sku === sku,
          );
          out.push({
            ref: row.ref,
            sku,
            name: hit?.name ?? row.name,
            unit: row.unit,
            productId: hit?.id ?? null,
            action: hit ? 'exists' : 'create',
            costPrice: costFromCogs(row.cogs),
            sellingPrice: row.price,
            current: hit
              ? {
                  costPrice: hit.costPrice ?? null,
                  sellingPrice: hit.sellingPrice,
                }
              : null,
          });
        }
        return { rows: out };
      };

      return runWrite(
        'import_hpp_products',
        { ...a, products: rows },
        track,
        async () => {
          const p = await plan();
          return 'error' in p
            ? refused(p.error)
            : ok({ preview: true, rows: p.rows });
        },
        async () => {
          const p = await plan();
          if ('error' in p) return p;
          let categoryId: string | null = null;
          if (p.rows.some((r) => r.action === 'create')) {
            const cats = await get('/catalog/categories');
            if (!cats.ok) return { error: cats.message, status: cats.status };
            const hit = (
              cats.data as { data: { id: string; name: string }[] }
            ).data.find((c) => c.name === HPP_CATEGORY);
            if (hit) categoryId = hit.id;
            else {
              const made = await create('/catalog/categories', {
                name: HPP_CATEGORY,
              });
              if ('error' in made) return made;
              categoryId = (made.data as { id: string }).id;
            }
          }
          const results = [];
          const created: string[] = [];
          for (const row of p.rows) {
            if (row.action === 'exists') {
              results.push({ ...row, result: 'exists' });
              continue;
            }
            const r = await callRoute(ctx, 'POST', '/catalog/products', {
              body: {
                name: row.name,
                categoryId,
                sku: row.sku,
                ...(row.unit && { unit: row.unit }),
                type: 'non_stock',
                costPrice: row.costPrice,
                sellingPrice: row.sellingPrice,
              },
            });
            if (r.ok) {
              const id = (r.data as { id: string }).id;
              created.push(id);
              results.push({ ...row, productId: id, result: 'created' });
            } else {
              const unknown = outcomeUnknown(r.status);
              results.push({
                ...row,
                result: unknown ? 'unknown' : 'error',
                error: unknown ? UNKNOWN_OUTCOME : r.message,
              });
            }
          }
          return { data: { rows: results }, resultRefs: created };
        },
      );
    },
  );

  return server;
}
