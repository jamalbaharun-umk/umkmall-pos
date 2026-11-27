import { HttpException, HttpStatus } from '@nestjs/common';

// Limits of the report PDF (design feature 37): at most `MAX_CONCURRENT` documents are made at once on this
// instance (each holds a few MB while it is drawn), one that takes longer than `TIMEOUT_MS` is given up, and a
// document over `MAX_BYTES` is refused after it is built. A refusal is a 503 the screen turns into the error dialog.

export const MAX_CONCURRENT = 3;
/** Slots one store may hold at once. */
export const MAX_PER_TENANT = 1;
export const TIMEOUT_MS = 20_000;
export const MAX_BYTES = 8 * 1024 * 1024;
/** Table rows one PDF prints; the CSV carries every row. */
export const MAX_TABLE_ROWS = 400;

let running = 0;
const perTenant = new Map<string, number>();

const refuse = (code: string, message: string) =>
  new HttpException(
    { message, errors: { _: message }, code },
    HttpStatus.SERVICE_UNAVAILABLE,
  );

/**
 * Runs `job` in one of the free slots, or refuses at once; gives up waiting after the time limit. The slot is held
 * until the job really settles (a timed-out job keeps running and its memory with it), and one tenant holds at most
 * `MAX_PER_TENANT` slots so it cannot starve the others.
 */
export async function withExportSlot<T>(
  tenantId: string,
  job: () => Promise<T>,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  if (
    running >= MAX_CONCURRENT ||
    (perTenant.get(tenantId) ?? 0) >= MAX_PER_TENANT
  )
    throw refuse(
      'EXPORT_BUSY',
      'Server sedang membuat banyak PDF. Coba lagi sebentar lagi.',
    );
  running += 1;
  perTenant.set(tenantId, (perTenant.get(tenantId) ?? 0) + 1);
  const work = job();
  const release = () => {
    running -= 1;
    const left = (perTenant.get(tenantId) ?? 1) - 1;
    if (left <= 0) perTenant.delete(tenantId);
    else perTenant.set(tenantId, left);
  };
  // Released by the job's own end, however it ends; the race below only decides what the caller hears.
  work.then(release, release);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              refuse(
                'EXPORT_TIMEOUT',
                'Membuat PDF terlalu lama. Pilih rentang lebih pendek lalu coba lagi.',
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function runningExports(): number {
  return running;
}
