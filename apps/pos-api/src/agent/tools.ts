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

// The MCP tools UMKMall's agent calls (UMK-1979, UMK-1980). Each read tool is one existing route; each write tool
// previews without `confirm: true` and runs once per `idempotencyKey`. Inputs stay loose where a route validates:
// the route answers Indonesian field errors the agent can read back. docs/agent-integration.md lists every tool
// (test/agent.e2e-spec.ts fails when the list drifts).

const ok = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});
const refused = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: message }],
});
const answer = (r: RouteAnswer) => (r.ok ? ok(r.data) : refused(r.message));

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
  idempotencyKey: z
    .string()
    .min(8)
    .max(100)
    .describe(
      'Unique per intended change; a retry with the same key and input returns the first result',
    ),
};

/** The tool names, in the order the server lists them (the docs test compares against this). */
export const AGENT_TOOL_NAMES = [
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
  'create_category',
  'create_product',
  'update_product',
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

export function buildAgentServer(
  session: PosSession,
  ctx: Loopback,
  idempotency: AgentIdempotency,
): McpServer {
  const server = new McpServer({ name: 'umkmall-pos', version: '1.0.0' });
  const get = (
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ) => callRoute(ctx, 'GET', path, { query });

  /** Preview, or run once per key: the shared shape of every write tool. */
  const write = async (
    tool: string,
    input: { confirm?: boolean; idempotencyKey: string } & Record<
      string,
      unknown
    >,
    preview: () => Promise<CallToolResult>,
    run: () => Promise<{ data: unknown } | { error: string }>,
  ): Promise<CallToolResult> => {
    if (!input.confirm) return preview();
    const { confirm: _c, idempotencyKey, ...rest } = input;
    void _c;
    const claim = await idempotency.claim(
      session.tenantId,
      idempotencyKey,
      tool,
      rest,
    );
    if (claim.kind === 'refused') return refused(claim.message);
    if (claim.kind === 'replay') return ok(claim.answer);
    let result: { data: unknown } | { error: string };
    try {
      result = await run();
    } catch (error) {
      await idempotency.release(session.tenantId, idempotencyKey);
      throw error;
    }
    if ('error' in result) {
      // Nothing was written: the key stays free for a corrected retry.
      await idempotency.release(session.tenantId, idempotencyKey);
      return refused(result.error);
    }
    await idempotency.finish(session.tenantId, idempotencyKey, result.data);
    return ok(result.data);
  };

  server.registerTool(
    'search_products',
    {
      description:
        'Search the store catalog by name, SKU or barcode. Returns products with price, unit, stock (null for non-stock items) and cost price.',
      inputSchema: {
        q: text(100).optional(),
        categoryId: text(64).optional(),
        stock: z
          .enum(['low', 'out'])
          .optional()
          .describe('Only low or out-of-stock tracked products'),
        page: z.number().int().optional(),
        perPage: z.number().int().optional().describe('1 to 100, default 20'),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => answer(await get('/catalog/products', a)),
  );

  server.registerTool(
    'get_product',
    {
      description:
        'One product with its units, wholesale tiers, barcodes and cost price.',
      inputSchema: { productId: text(64) },
      annotations: { readOnlyHint: true },
    },
    async ({ productId }) =>
      answer(await get(`/catalog/products/${encodeURIComponent(productId)}`)),
  );

  server.registerTool(
    'get_product_stock',
    {
      description:
        'Stock on hand of one product, with its batches and their unit cost (FIFO).',
      inputSchema: { productId: text(64) },
      annotations: { readOnlyHint: true },
    },
    async ({ productId }) =>
      answer(await get(`/stock/products/${encodeURIComponent(productId)}`)),
  );

  server.registerTool(
    'list_categories',
    {
      description: 'Every product category of the store.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => answer(await get('/catalog/categories')),
  );

  server.registerTool(
    'store_summary',
    {
      description:
        'Dashboard figures for a period: sales, transactions, gross profit and top products.',
      inputSchema: {
        period: z.enum(['today', 'week', 'month', 'year']).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => answer(await get('/reports/dashboard', a)),
  );

  server.registerTool(
    'sales_report',
    {
      description:
        'Sales in a date range (store timezone): every completed sale and the totals (gross sales, discounts, tax, revenue, cost, gross profit). Revenue counts kasbon sales too.',
      inputSchema: dateRange,
      annotations: { readOnlyHint: true },
    },
    async (a) => answer(await get('/reports/sales', a)),
  );

  server.registerTool(
    'product_report',
    {
      description:
        'Per product in a date range: quantity sold (base units), sales, cost of goods and gross profit.',
      inputSchema: dateRange,
      annotations: { readOnlyHint: true },
    },
    async (a) => answer(await get('/reports/products', a)),
  );

  server.registerTool(
    'product_margins',
    {
      description:
        'Actual margins per product in a date range, for comparing with a UMKMall HPP plan: average selling price, average unit cost, margin percent. hppRef is the UMKMall HPP product ref for products imported with import_hpp_products.',
      inputSchema: dateRange,
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = await get('/reports/products', a);
      if (!r.ok) return refused(r.message);
      const report = r.data as {
        rows: Parameters<typeof withMargins>[0];
      } & Record<string, unknown>;
      return ok({ ...report, rows: withMargins(report.rows) });
    },
  );

  server.registerTool(
    'profit_loss',
    {
      description:
        'Profit and loss: revenue (without tax), cost of goods, gross profit, operating expenses by category and net profit, next to the previous period of the same length. Give either period or from and to.',
      inputSchema: {
        period: z.enum(['today', 'week', 'month']).optional(),
        from: text(10).optional(),
        to: text(10).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => answer(await get('/reports/profit-loss', a)),
  );

  server.registerTool(
    'purchasing_report',
    {
      description:
        'Stock purchases received in a date range, per supplier and per product, with unit costs. Useful for ingredient costs in an HPP calculation.',
      inputSchema: dateRange,
      annotations: { readOnlyHint: true },
    },
    async (a) => answer(await get('/reports/purchasing', a)),
  );

  server.registerTool(
    'create_category',
    {
      description: 'Create a product category. Preview without confirm.',
      inputSchema: { name: text(200), ...writeControls },
    },
    async (a) =>
      write(
        'create_category',
        a,
        () =>
          Promise.resolve(ok({ preview: true, wouldCreate: { name: a.name } })),
        async () => {
          const r = await callRoute(ctx, 'POST', '/catalog/categories', {
            body: { name: a.name },
          });
          return r.ok ? { data: r.data } : { error: r.message };
        },
      ),
  );

  const productFields = {
    name: text(200).optional(),
    categoryId: text(64).optional(),
    sku: text(100).optional(),
    unit: text(40).optional(),
    costPrice: z.number().optional().describe('Integer rupiah'),
    sellingPrice: z.number().optional().describe('Integer rupiah'),
    type: z.enum(['product', 'service', 'non_stock']).optional(),
    lowStockThreshold: z.number().optional(),
    barcodes: z.array(text(100)).max(20).optional(),
  };

  server.registerTool(
    'create_product',
    {
      description:
        'Create a product (name, categoryId and sellingPrice required). type "non_stock" for a menu item made to order; "product" tracks stock. Preview without confirm.',
      inputSchema: { ...productFields, ...writeControls },
    },
    async (a) => {
      const { confirm: _c, idempotencyKey: _k, ...body } = a;
      void _c;
      void _k;
      return write(
        'create_product',
        a,
        () => Promise.resolve(ok({ preview: true, wouldCreate: body })),
        async () => {
          const r = await callRoute(ctx, 'POST', '/catalog/products', {
            body,
          });
          return r.ok ? { data: r.data } : { error: r.message };
        },
      );
    },
  );

  server.registerTool(
    'update_product',
    {
      description:
        'Change fields of a product (only the fields sent). Preview without confirm shows the current values next to the new ones.',
      inputSchema: { productId: text(64), ...productFields, ...writeControls },
    },
    async (a) => {
      const { confirm: _c, idempotencyKey: _k, productId, ...body } = a;
      void _c;
      void _k;
      const path = `/catalog/products/${encodeURIComponent(productId)}`;
      return write(
        'update_product',
        a,
        async () => {
          const current = await get(path);
          if (!current.ok) return refused(current.message);
          const now = current.data as Record<string, unknown>;
          const before = Object.fromEntries(
            Object.keys(body).map((k) => [k, now[k] ?? null]),
          );
          return ok({ preview: true, productId, before, after: body });
        },
        async () => {
          const r = await callRoute(ctx, 'PATCH', path, { body });
          return r.ok ? { data: r.data } : { error: r.message };
        },
      );
    },
  );

  server.registerTool(
    'import_hpp_products',
    {
      description:
        'Put UMKMall HPP results into the POS catalog. Each row: ref (the UMKMall HPP product id), name, cogs (variable cost per unit: ingredients and modal; NEVER the HPP with fixed costs, which the POS books as expenses), price (the chosen selling price), unit. A ref imported before updates that product\'s cost and price; a new ref creates a non-stock product in category "Dari HPP UMKMall" with SKU UMK-<ref>. Cost is rounded up to whole rupiah. Preview without confirm.',
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
    },
    async (a) => {
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
        action: 'create' | 'update' | 'unchanged';
        costPrice: number;
        sellingPrice: number;
        before: { costPrice: number | null; sellingPrice: number } | null;
      };
      const plan = async (): Promise<
        { error: string } | { rows: PlanRow[] }
      > => {
        const found = new Map<string, Product>();
        for (const row of rows) {
          const sku = hppSku(row.ref);
          const r = await get('/catalog/products', { q: sku, perPage: 100 });
          if (!r.ok) return { error: r.message };
          const hit = (r.data as { data: Product[] }).data.find(
            (p) => p.sku.toLowerCase() === sku.toLowerCase(),
          );
          if (hit) found.set(row.ref, hit);
        }
        return {
          rows: rows.map((row): PlanRow => {
            const cost = costFromCogs(row.cogs);
            const existing = found.get(row.ref);
            const action = !existing
              ? ('create' as const)
              : existing.costPrice === cost &&
                  existing.sellingPrice === row.price
                ? ('unchanged' as const)
                : ('update' as const);
            return {
              ref: row.ref,
              sku: hppSku(row.ref),
              name: existing?.name ?? row.name,
              unit: row.unit,
              productId: existing?.id ?? null,
              action,
              costPrice: cost,
              sellingPrice: row.price,
              before: existing
                ? {
                    costPrice: existing.costPrice ?? null,
                    sellingPrice: existing.sellingPrice,
                  }
                : null,
            };
          }),
        };
      };

      return write(
        'import_hpp_products',
        { ...a, products: rows },
        async () => {
          const p = await plan();
          return 'error' in p
            ? refused(p.error)
            : ok({ preview: true, rows: p.rows });
        },
        async () => {
          const p = await plan();
          if ('error' in p) return { error: p.error };
          let categoryId: string | null = null;
          if (p.rows.some((r) => r.action === 'create')) {
            const cats = await get('/catalog/categories');
            if (!cats.ok) return { error: cats.message };
            const hit = (
              cats.data as { data: { id: string; name: string }[] }
            ).data.find((c) => c.name === HPP_CATEGORY);
            if (hit) categoryId = hit.id;
            else {
              const made = await callRoute(ctx, 'POST', '/catalog/categories', {
                body: { name: HPP_CATEGORY },
              });
              if (!made.ok) return { error: made.message };
              categoryId = (made.data as { id: string }).id;
            }
          }
          const results = [];
          for (const row of p.rows) {
            if (row.action === 'unchanged') {
              results.push({ ...row, result: 'unchanged' });
              continue;
            }
            const r =
              row.action === 'create'
                ? await callRoute(ctx, 'POST', '/catalog/products', {
                    body: {
                      name: row.name,
                      categoryId,
                      sku: row.sku,
                      ...(row.unit && { unit: row.unit }),
                      type: 'non_stock',
                      costPrice: row.costPrice,
                      sellingPrice: row.sellingPrice,
                    },
                  })
                : await callRoute(
                    ctx,
                    'PATCH',
                    `/catalog/products/${row.productId}`,
                    {
                      body: {
                        costPrice: row.costPrice,
                        sellingPrice: row.sellingPrice,
                      },
                    },
                  );
            results.push(
              r.ok
                ? {
                    ...row,
                    productId: (r.data as { id: string }).id,
                    result: row.action === 'create' ? 'created' : 'updated',
                  }
                : { ...row, result: 'error', error: r.message },
            );
          }
          return { data: { rows: results } };
        },
      );
    },
  );

  return server;
}
