// The audit log never holds a PIN, token, phone number or customer name (design 32). `details` is built from ids,
// amounts and reason codes by the call site, and this is the second wall: it drops every key that names a secret or
// a person's contact, and masks anything shaped like a phone number or a token inside a value.

/** Words of a key that never survive, whatever the value (`pinHash`, `access_token`, `customerName`). */
const SENSITIVE_WORDS = new Set([
  'pin',
  'token',
  'secret',
  'password',
  'passcode',
  'hash',
  'cookie',
  'authorization',
  'otp',
  'phone',
  'telp',
  'telepon',
  'whatsapp',
  'hp',
  'customer',
  'pelanggan',
  'member',
  'buyer',
  'pembeli',
  'email',
]);

const isSensitiveKey = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((w) => SENSITIVE_WORDS.has(w));

/** A timestamp (`2026-11-26T14:07:06.598Z`): its digits are not a phone number. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 8 or more digits, also split by spaces, dots, dashes or a leading plus: a phone or an account number. */
const DIGIT_RUN = /\+?\d(?:[\s.\-()]?\d){7,}/g;
/** A long unbroken token-like run (JWT parts, hex or base64 secrets). */
const TOKEN_RUN = /[A-Za-z0-9_+/=.]{32,}/g;

export const MASK = '[disembunyikan]';
const MAX_STRING = 200;
const MAX_DEPTH = 4;
const MAX_ITEMS = 50;

/** A string for the log: secrets and numbers shaped like a phone masked, cut at 200 characters. */
export function scrubString(value: string): string {
  if (UUID.test(value) || ISO_TIME.test(value)) return value;
  return value
    .replace(DIGIT_RUN, MASK)
    .replace(TOKEN_RUN, MASK)
    .slice(0, MAX_STRING);
}

function scrubValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return scrubString(value);
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value))
    return value
      .slice(0, MAX_ITEMS)
      .map((v) => scrubValue(v, depth + 1))
      .filter((v) => v !== undefined);
  if (typeof value === 'object') return scrubDetails(value, depth + 1);
  return undefined;
}

/** The details object of a log row with every sensitive key and value removed. */
export function scrubDetails(
  details: object,
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (isSensitiveKey(key)) continue;
    const v = scrubValue(value, depth);
    if (v !== undefined) out[key] = v;
  }
  return out;
}
