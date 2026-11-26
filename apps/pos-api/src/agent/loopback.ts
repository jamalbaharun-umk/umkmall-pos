// An agent tool calls the existing pos-api route with the caller's own agent token (UMK-1979), so validation,
// tenant filters, permissions and cost hiding stay the route's. Nothing here reads a tenant id.

export type Loopback = { base: string; authorization: string };

export type RouteAnswer =
  { ok: true; data: unknown } | { ok: false; status: number; message: string };

const TIMEOUT_MS = 15_000;
const SERVER_TROUBLE = 'Terjadi kesalahan di POS. Coba lagi sebentar lagi.';

/** The route's own Indonesian message and field errors as one line; a 5xx or no answer is one generic sentence. */
export function refusalText(status: number, body: unknown): string {
  if (status >= 500 || status === 0) return SERVER_TROUBLE;
  const b = (body ?? {}) as { message?: unknown; errors?: unknown };
  const message =
    typeof b.message === 'string' ? b.message : 'Permintaan ditolak POS';
  const errors =
    b.errors && typeof b.errors === 'object'
      ? Object.entries(b.errors as Record<string, unknown>).flatMap(([k, v]) =>
          typeof v === 'string' && v !== message ? [`${k}: ${v}`] : [],
        )
      : [];
  return errors.length > 0 ? `${message} (${errors.join('; ')})` : message;
}

export async function callRoute(
  ctx: Loopback,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  options: {
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<RouteAnswer> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(options.query ?? {}))
    if (v !== undefined && v !== '') qs.set(k, String(v));
  const url = `${ctx.base}${path}${qs.size > 0 ? `?${qs}` : ''}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...options.headers,
        authorization: ctx.authorization,
        accept: 'application/json',
        ...(options.body !== undefined && {
          'content-type': 'application/json',
        }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 0, message: SERVER_TROUBLE };
  }
  const data: unknown =
    res.status === 204 ? null : await res.json().catch(() => null);
  if (res.ok) return { ok: true, data };
  return {
    ok: false,
    status: res.status,
    message: refusalText(res.status, data),
  };
}
