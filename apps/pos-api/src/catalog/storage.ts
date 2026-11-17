import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Where product images live. Keys are tenant-prefixed; nothing here is ever a public URL. */
export interface ObjectStorage {
  put(key: string, body: Buffer): Promise<void>;
  /** null when the object does not exist. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

const KEY = /^tenants\/[0-9a-f-]{36}\/[a-z0-9/.-]+$/;

/** v1 adapter: files under POS_STORAGE_DIR. */
export class LocalDiskStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  private file(key: string): string {
    // Keys are built by the service, but refuse anything that could escape the root.
    if (!KEY.test(key) || key.includes('..'))
      throw new Error('bad storage key');
    return path.join(this.root, key);
  }

  async put(key: string, body: Buffer) {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string) {
    try {
      return await readFile(this.file(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

/** Detects the image type from magic bytes; the client's content type is never trusted. */
export function detectImage(
  buf: Buffer,
): { contentType: string; ext: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { contentType: 'image/jpeg', ext: 'jpg' };
  if (
    buf.length >= 8 &&
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return { contentType: 'image/png', ext: 'png' };
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return { contentType: 'image/webp', ext: 'webp' };
  return null;
}
