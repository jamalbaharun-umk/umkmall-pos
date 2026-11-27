import { HttpException, HttpStatus } from '@nestjs/common';

// Limits of the report PDF (design feature 37): at most `MAX_CONCURRENT` documents are made at once on this
// instance (each holds a few MB while it is drawn), one that takes longer than `TIMEOUT_MS` is given up, and the
// document is cut off at `MAX_BYTES`. A refusal is a 503 the screen turns into the error dialog.

export const MAX_CONCURRENT = 3;
export const TIMEOUT_MS = 20_000;
export const MAX_BYTES = 8 * 1024 * 1024;
/** Table rows one PDF prints; the CSV carries every row. */
export const MAX_TABLE_ROWS = 400;

let running = 0;

const refuse = (code: string, message: string) =>
  new HttpException(
    { message, errors: { _: message }, code },
    HttpStatus.SERVICE_UNAVAILABLE,
  );

/** Runs `job` in one of the free slots, or refuses at once; gives up after the time limit. */
export async function withExportSlot<T>(
  job: () => Promise<T>,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  if (running >= MAX_CONCURRENT)
    throw refuse(
      'EXPORT_BUSY',
      'Server sedang membuat banyak PDF. Coba lagi sebentar lagi.',
    );
  running += 1;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      job(),
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
    running -= 1;
  }
}

export function runningExports(): number {
  return running;
}
