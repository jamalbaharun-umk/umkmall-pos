import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PosSession } from '../tenancy/session';
import {
  costDataRows,
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
const UNKNOWN_REPLAYABLE =
  'Hasilnya belum pasti karena POS tidak menjawab. Kirim lagi dengan kunci yang SAMA: POS menjawab hasil pertama dan tidak mencatat dua kali. Jangan pakai kunci baru.';
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
/** A read of personal data (members, kasbon) or of the till: it needs the write consent. */
const readsWithWrite = (suits: string, manualPath: string): Registry => ({
  ...reads(suits, manualPath),
  scope: 'pos.write',
});
/** The route's own Idempotency-Key for an agent key: same agent key, same route key, so the route dedupes too. */
const routeKey = (key: string) =>
  `agent-${createHash('sha256').update(key).digest('hex').slice(0, 40)}`;
const NO_SHIFT =
  'Belum ada shift yang dibuka. Tanyakan ke pemilik apakah shift perlu dibuka (open_shift) dan berapa modal awalnya.';
const NO_ONLINE =
  'Metode pembayaran online belum bisa dipakai lewat agent. Pilih tunai, debit, QRIS toko atau kasbon.';

const writes = (suits: string, manualPath: string): Registry => ({
  scope: 'pos.write',
  modes: ['agentic', 'guided'],
  suits,
  manualPath,
  connection: 'UMKMall POS',
  coinCost: 0,
});

/** A create's preview: the name a confirm would refuse is refused here too. */
const previewCreate = (body: Record<string, unknown>): CallToolResult =>
  typeof body.name !== 'string' || !body.name.trim()
    ? refused('Nama wajib diisi.')
    : ok({ preview: true, wouldCreate: body });

/** Keys never kept in pos.agent_requests: contact details and customer names (a replay answers without them). */
const PII_KEYS = new Set(['phone', 'address', 'memberName', 'customerName']);
export function redact(tool: string, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(tool, v));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([k]) =>
          !PII_KEYS.has(k) && !(tool === 'create_member' && k === 'name'),
      )
      .map(([k, v]) => [k, redact(tool, v)]),
  );
}

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
  'hpp_product_data',
  'create_category',
  'create_product',
  'import_hpp_products',
  // UMK-1981
  'list_payment_methods',
  'list_suppliers',
  'current_shift',
  'search_members',
  'list_receivables',
  'open_shift',
  'record_sale',
  'create_member',
  'record_receivable_payment',
  'create_supplier',
  'ledger_entries',
  'add_product_photo',
  'stock_in',
] as const;

/** The purchase route's line bounds (`purchasing.service.ts` Line, orderFields), for the stock_in preview. */
const StockLines = z
  .array(
    z.object({
      productId: z.string(),
      qty: z
        .number()
        .int('Jumlah harus bilangan bulat')
        .positive('Jumlah harus lebih dari 0')
        .max(100_000, 'Jumlah maksimal 100.000'),
      unitCost: z
        .number()
        .int('Harga beli harus bilangan bulat rupiah')
        .nonnegative('Harga beli tidak boleh negatif')
        .max(1_000_000_000, 'Harga beli maksimal Rp1.000.000.000'),
    }),
  )
  .min(1)
  .max(200, 'Maksimal 200 baris')
  .refine(
    (l) => new Set(l.map((x) => x.productId)).size === l.length,
    'Satu produk cukup satu baris',
  );

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
  | { data: object; resultRefs?: string[] }
  | { error: string; status: number; replay?: unknown };
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
    run: (replay?: unknown) => Promise<RunResult>,
    // The route dedupes by its own Idempotency-Key (derived from the agent key): after a lost answer the same call is
    // REPLAYED, never retried under a new key, which could sell twice.
    routeIdempotent = false,
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
    let replayOf: unknown;
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
      if (!stored.unknownOutcome) return ok(claim.answer);
      if (!routeIdempotent) return refused(stored.message ?? UNKNOWN_OUTCOME);
      // Fall through: the route answers the first result, or writes it now.
      replayOf = (stored as { replay?: unknown }).replay;
    }
    const unknownText = routeIdempotent ? UNKNOWN_REPLAYABLE : UNKNOWN_OUTCOME;
    let result: RunResult;
    try {
      result = await run(replayOf);
    } catch {
      result = { error: unknownText, status: 0 };
    }
    if ('error' in result) {
      if (outcomeUnknown(result.status)) {
        // The route may have committed before its answer was lost: the key stays taken.
        await deps.idempotency.unknown(
          session.tenantId,
          key,
          unknownText,
          'replay' in result ? result.replay : undefined,
        );
        return refused(unknownText);
      }
      // Refused (4xx): nothing was written, so the key is free for a corrected retry.
      await deps.idempotency.release(session.tenantId, key);
      return refused(result.error);
    }
    const data = { ...result.data, provenance: provenance(toolName) };
    // The stored answer (kept 7 days for replays) carries no contact or customer data; this answer has it all.
    await deps.idempotency.finish(
      session.tenantId,
      key,
      redact(toolName, data),
    );
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
    async (a) => {
      const r = await get('/reports/sales', a as Query);
      if (!r.ok) return refused(r.message);
      // Staff names stay in the POS: the agent gets the figures, not who rang each line up.
      const report = r.data as { rows: Record<string, unknown>[] };
      return ok({
        ...report,
        rows: report.rows.map(({ cashier: _c, ...row }) => {
          void _c;
          return row;
        }),
      });
    },
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
        'Profit and loss: revenue (without tax), cost of goods, gross profit, stock shrinkage (shrinkage: the batch cost of units approved stock counts found missing, less the cost of units they found in surplus in the same period, never below 0), operating expenses by category and net profit (gross profit minus shrinkage minus expenses), next to the previous period of the same length. Give either period or from and to.',
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
    'hpp_product_data',
    {
      description:
        "Everything UMKMall's HPP calculators need from the POS, one row per product: selling price, cost price, units and wholesale tiers, stock, what sold in the period (qty, sales, cost, average price and unit cost) and what buying it really cost (qty, total, average and last unit cost), plus the store's operating expenses by category for the period (fixed-cost candidates). The POS provides the data; UMKMall does the calculation. Paged by products.",
      inputSchema: {
        ...dateRange,
        q: text(100)
          .optional()
          .describe('Only products matching a name, SKU or barcode'),
        page: z.number().int().optional(),
        perPage: z.number().int().optional().describe('1 to 100, default 50'),
      },
      registry: reads(
        'Strategi Harga dan Profit and the HPP calculator: pull products with their real costs',
        '/catalog/products',
      ),
    },
    async (a) => {
      const range = { from: a.from as string, to: a.to as string };
      const [catalog, sold, bought, pl] = await Promise.all([
        get('/catalog/products', {
          q: a.q as string | undefined,
          page: a.page as number | undefined,
          perPage: (a.perPage as number | undefined) ?? 50,
        }),
        get('/reports/products', range),
        get('/reports/purchasing', range),
        get('/reports/profit-loss', range),
      ]);
      if (!catalog.ok) return refused(catalog.message);
      if (!sold.ok) return refused(sold.message);
      if (!bought.ok) return refused(bought.message);
      if (!pl.ok) return refused(pl.message);
      const page = catalog.data as {
        data: Parameters<typeof costDataRows>[0];
        page: number;
        perPage: number;
        total: number;
      };
      const purchases = bought.data as {
        truncated: boolean;
        rows: Parameters<typeof costDataRows>[2];
      };
      const profit = pl.data as {
        timezone: string;
        current: { revenue: number; grossProfit: number; expenses: number };
        topExpenses: { category: string; label: string; total: number }[];
      };
      return ok({
        ...range,
        timezone: profit.timezone,
        page: page.page,
        perPage: page.perPage,
        total: page.total,
        products: costDataRows(
          page.data,
          (sold.data as { rows: Parameters<typeof costDataRows>[1] }).rows,
          purchases.rows,
        ),
        // The purchase lines of a very busy period are capped by the report; averages then cover the first lines.
        purchasesTruncated: purchases.truncated,
        operatingExpenses: {
          total: profit.current.expenses,
          byCategory: profit.topExpenses.map(({ category, label, total }) => ({
            category,
            label,
            total,
          })),
        },
        period: {
          revenue: profit.current.revenue,
          grossProfit: profit.current.grossProfit,
        },
      });
    },
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
        () => Promise.resolve(previewCreate(body)),
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

  tool(
    'list_payment_methods',
    {
      description:
        "The store's payment methods (Tunai, debit, QRIS toko, kasbon, ...) with their kind. Pick paymentMethodId for record_sale from here.",
      inputSchema: {},
      registry: reads(
        'Recording a sale or a kasbon payment',
        '/metode-pembayaran',
      ),
    },
    async () => answer(await get('/payment-methods')),
  );

  tool(
    'list_suppliers',
    {
      description:
        "The store's suppliers, with phone and address. Contact data: needs the pos.write consent.",
      inputSchema: {},
      registry: readsWithWrite('Purchases and ingredient sources', '/pemasok'),
    },
    async () => answer(await get('/suppliers')),
  );

  tool(
    'current_shift',
    {
      description:
        "The owner's open shift (the till sales go into), with its sales and expected cash, or null when none is open. Needs the pos.write consent.",
      inputSchema: {},
      registry: readsWithWrite('Before recording a sale', '/kasir/shift'),
    },
    async () => answer(await get('/shifts/current')),
  );

  tool(
    'search_members',
    {
      description:
        'Find a customer (member) by name or code, for a kasbon sale or a kasbon payment. Personal data: needs the pos.write consent.',
      inputSchema: { q: text(60).optional() },
      registry: readsWithWrite('Chat Jadi Order: who is buying', '/pelanggan'),
    },
    async (a) => answer(await get('/members/picker', a as Query)),
  );

  tool(
    'list_receivables',
    {
      description:
        'Kasbon (receivables): who owes what, with the balance left. Filter by memberId or status. Personal data: needs the pos.write consent.',
      inputSchema: {
        memberId: text(64).optional(),
        status: z.enum(['open', 'settled', 'cancelled']).optional(),
        q: text(60).optional(),
        page: z.number().int().optional(),
        perPage: z.number().int().optional(),
      },
      registry: readsWithWrite('Kasbon follow-up and reminders', '/piutang'),
    },
    async (a) => answer(await get('/receivables', a as Query)),
  );

  tool(
    'open_shift',
    {
      description:
        "Open the owner's shift with the opening cash in the drawer. ONLY when the owner asks for it: never open a shift on your own to record a sale. Preview without confirm.",
      inputSchema: {
        openingCash: z
          .number()
          .describe('Integer rupiah counted in the drawer'),
        ...writeControls,
      },
      registry: writes('Starting the day when the owner asks', '/kasir/shift'),
    },
    async (a, track) =>
      runWrite(
        'open_shift',
        a,
        track,
        async () => {
          const cur = await get('/shifts/current');
          if (!cur.ok) return refused(cur.message);
          const open = (cur.data as { shift: unknown }).shift;
          return open
            ? refused('Shift sudah terbuka; tidak perlu dibuka lagi.')
            : ok({ preview: true, wouldOpen: { openingCash: a.openingCash } });
        },
        () => create('/shifts/open', { openingCash: a.openingCash }),
      ),
  );

  tool(
    'record_sale',
    {
      description:
        "Record a sale into the owner's open shift. The agent never sends a price or a discount: the server prices every line (units, wholesale tiers), applies the voucher and tax, and the tool pays the exact amount due (cash is rounded up to Rp100). For kasbon give memberId and downPayment (default 0). Online payment methods are refused. With no open shift the tool says so and records nothing, except in a store without staff, where the sale opens the owner's shift itself. Preview without confirm shows the server's total.",
      inputSchema: {
        lines: z
          .array(
            z.object({
              productId: text(64),
              qty: z.number(),
              unit: text(20)
                .optional()
                .describe('Another unit of the product, e.g. Dus'),
              price: z
                .number()
                .optional()
                .describe(
                  'IGNORED: the server prices every line; a price sent here is echoed back in ignored, never used',
                ),
              discountPercent: z
                .number()
                .optional()
                .describe(
                  'IGNORED: no line discount from the agent; echoed back in ignored',
                ),
              discountAmount: z
                .number()
                .optional()
                .describe(
                  'IGNORED: no line discount from the agent; echoed back in ignored',
                ),
            }),
          )
          .describe('1 or more cart lines'),
        memberId: text(64).optional(),
        voucherCode: text(40).optional(),
        paymentMethodId: text(64)
          .optional()
          .describe('From list_payment_methods; default Tunai'),
        downPayment: z
          .number()
          .optional()
          .describe('Kasbon only: what the customer pays now, integer rupiah'),
        note: text(200).optional(),
        discount: z
          .number()
          .optional()
          .describe(
            'IGNORED: the agent cannot give a discount; echoed back in ignored',
          ),
        ...writeControls,
      },
      registry: writes(
        'Chat Jadi Order: an order from chat becomes a sale',
        '/kasir',
      ),
    },
    async (a, track) => {
      // UMK-2069: a price or discount the agent sent is never used, and the answer says so (it was dropped silently).
      const sent = a.lines as {
        productId: string;
        qty: number;
        unit?: string;
        price?: number;
        discountPercent?: number;
        discountAmount?: number;
      }[];
      const cart = sent.map(({ productId, qty, unit }) => ({
        productId,
        qty,
        ...(unit !== undefined && { unit }),
      }));
      // Echoed only as whole numbers: anything else is not a price or discount at all, and is dropped as well.
      const whole = (v: unknown) =>
        typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined;
      const ignoredPrices = sent
        .map((l) => ({
          productId: l.productId,
          sentPrice: whole(l.price),
          sentDiscountPercent: whole(l.discountPercent),
          sentDiscountAmount: whole(l.discountAmount),
        }))
        .filter(
          (l) =>
            l.sentPrice !== undefined ||
            l.sentDiscountPercent !== undefined ||
            l.sentDiscountAmount !== undefined,
        )
        .map((l) =>
          Object.fromEntries(
            Object.entries(l).filter(([, v]) => v !== undefined),
          ),
        );
      const discount = whole(a.discount);
      const ignored =
        ignoredPrices.length > 0 || discount !== undefined
          ? {
              ignored: {
                ...(ignoredPrices.length > 0 && { linePrices: ignoredPrices }),
                ...(discount !== undefined && { discount }),
                message:
                  'Harga atau diskon dari agent diabaikan: POS memakai harga di katalog (lihat quote).',
              },
            }
          : {};
      const quoteBody = {
        lines: cart,
        ...(a.voucherCode !== undefined && { voucherCode: a.voucherCode }),
      };
      type Quote = {
        total: number;
        amountDue: number;
        paymentMethod: {
          isCash: boolean;
          isCredit: boolean;
          isOnline: boolean;
        };
      };
      const check = async (): Promise<
        { error: string; status: number } | { quote: Quote }
      > => {
        const cur = await get('/shifts/current');
        if (!cur.ok) return { error: cur.message, status: cur.status };
        // UMK-2120: in a store without staff the sale itself opens the owner's shift (`autoOpen`).
        const current = cur.data as { shift: unknown; autoOpen?: boolean };
        if (!current.shift && !current.autoOpen)
          return { error: NO_SHIFT, status: 422 };
        // Quoted with a method so the quote carries tax, rounding and the method's kind: the one given, else the
        // store's cash method (the default of a sale).
        let methodId = a.paymentMethodId as string | undefined;
        if (!methodId) {
          const methods = await get('/payment-methods');
          if (!methods.ok)
            return { error: methods.message, status: methods.status };
          methodId = (
            methods.data as { data: { id: string; kind: string }[] }
          ).data.find((m) => m.kind === 'cash')?.id;
        }
        const q = await callRoute(ctx, 'POST', '/sales/quote', {
          body: { ...quoteBody, paymentMethodId: methodId },
        });
        if (!q.ok) return { error: q.message, status: q.status };
        const quote = q.data as Quote;
        if (!quote.paymentMethod) return { error: SERVER_TROUBLE, status: 500 };
        if (quote.paymentMethod.isOnline)
          return { error: NO_ONLINE, status: 422 };
        return { quote };
      };
      return runWrite(
        'record_sale',
        a,
        track,
        async () => {
          const c = await check();
          if ('error' in c) return refused(c.error);
          const m = c.quote.paymentMethod;
          const down = (a.downPayment as number | undefined) ?? 0;
          if (m.isCredit && !a.memberId)
            return refused(
              'Pilih member untuk kasbon (memberId dari search_members).',
            );
          if (m.isCredit && down >= c.quote.total)
            return refused(
              'Kasbon harus menyisakan sisa tagihan: downPayment kurang dari total.',
            );
          return ok({
            preview: true,
            ...ignored,
            quote: c.quote,
            wouldPay: m.isCredit
              ? down
              : m.isCash
                ? c.quote.amountDue
                : c.quote.total,
            ...(m.isCredit && { kasbonRest: c.quote.total - down }),
          });
        },
        async (replay) => {
          // A replay sends exactly the body of the lost call; prices or the shift may have changed since.
          let body = replay;
          if (body === undefined) {
            const c = await check();
            if ('error' in c) return c;
            const m = c.quote.paymentMethod;
            const paid = m.isCredit
              ? ((a.downPayment as number | undefined) ?? 0)
              : m.isCash
                ? c.quote.amountDue
                : c.quote.total;
            body = {
              lines: cart,
              ...(a.memberId !== undefined && { memberId: a.memberId }),
              ...(a.voucherCode !== undefined && {
                voucherCode: a.voucherCode,
              }),
              ...(a.paymentMethodId !== undefined && {
                paymentMethodId: a.paymentMethodId,
              }),
              ...(a.note !== undefined && { note: a.note }),
              paid,
            };
          }
          const r = await callRoute(ctx, 'POST', '/sales', {
            headers: {
              'idempotency-key': routeKey(a.idempotencyKey as string),
            },
            body,
          });
          if (!r.ok)
            return { error: r.message, status: r.status, replay: body };
          const sale = r.data as { id: string };
          return { data: { ...sale, ...ignored }, resultRefs: [sale.id] };
        },
        true,
      );
    },
  );

  tool(
    'create_member',
    {
      description:
        "Add a customer (member): name, and optionally code (no spaces; send the store's own code when known, else one is made up from the key), phone, address. Preview without confirm.",
      inputSchema: {
        name: text(120),
        code: text(40).optional(),
        phone: text(20).optional(),
        address: text(500).optional(),
        ...writeControls,
      },
      registry: writes('A new customer from chat', '/pelanggan'),
    },
    async (a, track) => {
      const { confirm: _c, idempotencyKey: _k, ...given } = a;
      void _c;
      void _k;
      // A code the agent did not give is derived from its key, so a retry sends the same one.
      const body = {
        ...given,
        code:
          given.code ??
          `AG${createHash('sha256').update(String(a.idempotencyKey)).digest('hex').slice(0, 10).toUpperCase()}`,
      };
      return runWrite(
        'create_member',
        a,
        track,
        () => Promise.resolve(previewCreate(body)),
        () => create('/members', body),
      );
    },
  );

  tool(
    'record_receivable_payment',
    {
      description:
        "Record a kasbon instalment: receivableId (from list_receivables), amount (integer rupiah, at most the balance left), paymentMethodId (default Tunai; cash goes into the owner's open shift). Preview without confirm shows the balance before and after.",
      inputSchema: {
        receivableId: text(64),
        amount: z.number(),
        paymentMethodId: text(64).optional(),
        ...writeControls,
      },
      registry: writes('Kasbon follow-up: a customer paid', '/piutang'),
    },
    async (a, track) => {
      const id = idParam(a.receivableId);
      if (!id)
        return refused(
          'receivableId tidak valid: kirim id dari list_receivables.',
        );
      return runWrite(
        'record_receivable_payment',
        a,
        track,
        async () => {
          const r = await get(`/receivables/${id}`);
          if (!r.ok) return refused(r.message);
          const left = (r.data as { rest?: number }).rest ?? null;
          if (
            typeof a.amount !== 'number' ||
            !Number.isInteger(a.amount) ||
            a.amount <= 0
          )
            return refused('amount harus bilangan bulat rupiah lebih dari 0.');
          if (typeof left === 'number' && a.amount > left)
            return refused(`Pembayaran melebihi sisa piutang (Rp${left}).`);
          return ok({
            preview: true,
            receivableId: id,
            amount: a.amount,
            balanceBefore: left,
            balanceAfter:
              typeof left === 'number' && typeof a.amount === 'number'
                ? left - a.amount
                : null,
          });
        },
        async () => {
          const r = await callRoute(
            ctx,
            'POST',
            `/receivables/${id}/payments`,
            {
              headers: {
                'idempotency-key': routeKey(a.idempotencyKey as string),
              },
              body: {
                amount: a.amount,
                ...(a.paymentMethodId !== undefined && {
                  paymentMethodId: a.paymentMethodId,
                }),
              },
            },
          );
          if (!r.ok) return { error: r.message, status: r.status };
          const p = r.data as { id?: string };
          return { data: r.data as object, resultRefs: p.id ? [p.id] : [] };
        },
        true,
      );
    },
  );

  tool(
    'create_supplier',
    {
      description:
        'Add a supplier: name, and optionally phone and address. Preview without confirm.',
      inputSchema: {
        name: text(120),
        phone: text(20).optional(),
        address: text(500).optional(),
        ...writeControls,
      },
      registry: writes('A new ingredient source', '/pemasok'),
    },
    async (a, track) => {
      const { confirm: _c, idempotencyKey: _k, ...body } = a;
      void _c;
      void _k;
      return runWrite(
        'create_supplier',
        a,
        track,
        () => Promise.resolve(previewCreate(body)),
        () => create('/suppliers', body),
      );
    },
  );

  tool(
    'ledger_entries',
    {
      description:
        "The POS's money movements as ledger entries for UMKMall's Catatan Keuangan (cash basis), each with a stable id to dedupe repeated pulls: sales by non-kasbon methods (in, money received), kasbon payments incl. down payments (in), money given back on a void (out), live expenses and supplier payments (out), drawer cash put in or taken out by hand (cash_in / cash_out, with the reason). Data only: map the POS categories to the ledger's own. At most 2000 entries per call (truncated = ask shorter periods).",
      inputSchema: dateRange,
      registry: reads(
        'Rapikan Catatan Keuangan: pull POS transactions into the ledger',
        '/laporan',
      ),
    },
    async (a) => answer(await get('/agent/ledger', a as Query)),
  );

  tool(
    'add_product_photo',
    {
      description:
        "Add a photo to a product, e.g. one UMKMall's Upgrade Foto Produk made: imageBase64 is the JPG, PNG or WebP file (at most 2 MB) in base64, without a data: prefix. Append only: the agent never deletes or replaces a photo and never changes the product. Preview without confirm checks the product and the size.",
      inputSchema: {
        productId: text(64),
        imageBase64: z.string().max(2_900_000),
        ...writeControls,
      },
      registry: writes(
        'Upgrade Foto Produk, Feed 9 Kotak, Kemasan Siap Jual: the result goes to the catalog',
        '/catalog/products',
      ),
    },
    async (a, track) => {
      const id = idParam(a.productId);
      if (!id) return refused(BAD_ID);
      const bytes =
        typeof a.imageBase64 === 'string'
          ? Buffer.from(a.imageBase64, 'base64')
          : Buffer.alloc(0);
      if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024)
        return refused('Gambar harus JPG, PNG atau WebP, maksimal 2 MB.');
      return runWrite(
        'add_product_photo',
        // Hash the photo, not its base64, so the idempotency record stays small.
        {
          productId: id,
          photoSha256: createHash('sha256').update(bytes).digest('hex'),
          idempotencyKey: a.idempotencyKey,
          confirm: a.confirm,
        },
        track,
        async () => {
          const p = await get(`/catalog/products/${id}`);
          if (!p.ok) return refused(p.message);
          return ok({
            preview: true,
            productId: id,
            product: (p.data as { name: string }).name,
            sizeBytes: bytes.length,
          });
        },
        async () => {
          const form = new FormData();
          form.append('file', new Blob([bytes]), 'photo');
          const r = await callRoute(
            ctx,
            'POST',
            `/catalog/products/${id}/images`,
            { body: form },
          );
          if (!r.ok) return { error: r.message, status: r.status };
          const img = r.data as { id: string };
          return { data: { productId: id, ...img }, resultRefs: [img.id] };
        },
      );
    },
  );

  tool(
    'stock_in',
    {
      description:
        "Record goods received (stock in, UMK-2070): a purchase from a supplier (supplierId from list_suppliers, or create_supplier first) with lines { productId, qty, unitCost }, written as a purchase order and approved at once, which adds the stock at that cost (FIFO). Only stock-tracked products (type product). unitCost is what the store paid per unit, integer rupiah; it never changes a selling price. Preview without confirm shows each product's stock before and after.",
      inputSchema: {
        supplierId: text(64),
        lines: z
          .array(
            z.object({
              productId: text(64),
              qty: z.number(),
              unitCost: z.number(),
            }),
          )
          .describe('1 to 200 lines, one per product'),
        paymentMethod: text(60)
          .optional()
          .describe('How it was paid, e.g. Tunai, Transfer'),
        note: text(500).optional(),
        ...writeControls,
      },
      registry: writes(
        'A delivery from a supplier, from a photo of the invoice',
        '/pembelian',
      ),
    },
    async (a, track) => {
      const lines = a.lines as {
        productId: string;
        qty: number;
        unitCost: number;
      }[];
      const ids = lines.map((l) => idParam(l.productId));
      if (lines.length === 0 || ids.some((id) => !id)) return refused(BAD_ID);
      // The route's own bounds, checked before the preview too, so a preview never shows what a confirm refuses.
      const bounds = StockLines.safeParse(lines);
      if (!bounds.success)
        return refused(
          bounds.error.issues
            .map((i) =>
              i.path.length > 0
                ? `baris ${i.path.join('.')}: ${i.message}`
                : i.message,
            )
            .join('; '),
        );
      const body = {
        supplierId: a.supplierId,
        lines,
        ...(a.paymentMethod !== undefined && {
          paymentMethod: a.paymentMethod,
        }),
        ...(a.note !== undefined && { note: a.note }),
      };
      return runWrite(
        'stock_in',
        a,
        track,
        async () => {
          const rows = [];
          for (const l of lines) {
            const p = await get(`/catalog/products/${l.productId}`);
            if (!p.ok) return refused(p.message);
            const prod = p.data as { name: string; type: string };
            if (prod.type !== 'product' && prod.type !== 'ingredient')
              return refused(
                `${prod.name} tidak dilacak stoknya (bukan tipe product atau ingredient).`,
              );
            const st = await get(`/stock/products/${l.productId}`);
            if (!st.ok) return refused(st.message);
            const onHand = (st.data as { onHand: number | null }).onHand ?? 0;
            rows.push({
              productId: l.productId,
              name: prod.name,
              qty: l.qty,
              unitCost: l.unitCost,
              stockBefore: onHand,
              stockAfter: onHand + l.qty,
            });
          }
          return ok({
            preview: true,
            lines: rows,
            total: lines.reduce((n, l) => n + l.qty * l.unitCost, 0),
          });
        },
        async () => {
          // One route, one transaction, the route's own Idempotency-Key (derived from the agent key): a retry with the
          // same key answers the first purchase, so stock never comes in twice.
          const r = await callRoute(
            ctx,
            'POST',
            '/purchasing/orders/stock-in',
            {
              headers: {
                'idempotency-key': routeKey(a.idempotencyKey as string),
              },
              body,
            },
          );
          if (!r.ok) return { error: r.message, status: r.status };
          const order = r.data as { id: string };
          return { data: order, resultRefs: [order.id] };
        },
        true,
      );
    },
  );

  return server;
}
