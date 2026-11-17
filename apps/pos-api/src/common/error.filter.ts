import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/** Indonesian text for a status whose exception carried no message of its own (Nest's English defaults). */
const DEFAULT_MESSAGE: Record<number, string> = {
  400: 'Permintaan tidak valid',
  401: 'Sesi berakhir, silakan masuk lagi',
  403: 'Kamu tidak punya izin untuk ini',
  404: 'Data tidak ditemukan',
  409: 'Data bentrok dengan data lain',
  422: 'Periksa kembali isian kamu',
  429: 'Terlalu banyak percobaan, coba lagi nanti',
  503: 'Layanan sedang tidak bisa dihubungi, coba lagi',
};
const SERVER_ERROR = 'Terjadi kesalahan di server. Coba lagi sebentar lagi.';

type Body = { message: string; errors?: Record<string, string> };

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Every refusal leaves the API as `{ message, errors? }` with Indonesian text; nothing else reaches a client.
 * HttpExceptions keep their own body (the `validation.ts` shape) unless it is Nest's English default; Postgres
 * constraint errors become 409/422; a body that is not JSON is 400; an oversize upload is a field error on `file`;
 * anything else is a 500 with a safe message, logged without the request body or the error's values.
 */
export function toResponse(err: unknown): { status: number; body: Body } {
  if (err instanceof HttpException) {
    const status = err.getStatus();
    if (status === 413) {
      const message = 'Ukuran gambar maksimal 2 MB';
      return { status: 422, body: { message, errors: { file: message } } };
    }
    const raw = err.getResponse();
    const own =
      typeof raw === 'object' && raw !== null
        ? (raw as {
            message?: unknown;
            errors?: Record<string, string>;
            statusCode?: unknown;
            error?: unknown;
          })
        : { message: raw };
    // Nest's built-in body: `{ message: <English status text>, statusCode }` when no message was given
    // (`error` is added only alongside a description). A Nest-built 400 is body-parser's JSON error.
    const nestBuilt = own.statusCode !== undefined;
    if (nestBuilt && status === 400)
      return { status, body: { message: 'Format data tidak valid' } };
    const isDefault =
      typeof own.message !== 'string' ||
      (nestBuilt &&
        (own.error === undefined ||
          own.message === own.error ||
          // the router's own 404 for an unknown path
          (status === 404 && own.message.startsWith('Cannot '))));
    const message = isDefault
      ? (DEFAULT_MESSAGE[status] ?? SERVER_ERROR)
      : (own.message as string);
    // Extra keys a refusal carries on purpose (retryAfter, productIds) pass through; Nest's own do not.
    const {
      statusCode: _s,
      error: _e,
      ...rest
    } = own as Record<string, unknown>;
    void _s;
    void _e;
    return { status, body: { ...rest, message } };
  }
  const e = err as { type?: string; status?: number } | undefined;
  if (e?.type === 'entity.parse.failed')
    return { status: 400, body: { message: 'Format data tidak valid' } };
  switch (pgCode(err)) {
    case '23505':
      return { status: 409, body: { message: 'Data ini sudah ada' } };
    case '23503':
      return {
        status: 409,
        body: { message: 'Data masih dipakai atau tidak ditemukan' },
      };
    case '22P02':
    case '22003':
      return { status: 422, body: { message: 'Format tidak valid' } };
  }
  return { status: 500, body: { message: SERVER_ERROR } };
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host
      .switchToHttp()
      .getRequest<{ method?: string; route?: { path?: string } }>();
    const { status, body } = toResponse(err);
    if (status >= 500) {
      // Route pattern and error class/code only: no body, params, or messages that may hold customer data.
      const name = err instanceof Error ? err.name : typeof err;
      this.logger.error(
        `${req.method ?? ''} ${req.route?.path ?? '?'} → ${name}${pgCode(err) ? ` (${pgCode(err)})` : ''}`,
      );
    }
    res.status(status).type('json').json(body);
  }
}
