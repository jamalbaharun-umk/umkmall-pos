import {
  createHash,
  randomBytes,
  scrypt,
  ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';

// PINs are low-entropy: a slow salted hash (scrypt) plus the sign-in lockout. Device secrets are 32 random
// bytes, so a plain SHA-256 is enough for them.

const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

function scryptAsync(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(pin, salt, KEYLEN, SCRYPT, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pin, salt);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await scryptAsync(pin, Buffer.from(salt, 'base64url'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newDeviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
