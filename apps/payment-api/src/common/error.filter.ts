import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

const DEFAULT_MESSAGE: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  404: 'Not found',
  409: 'Conflict',
  422: 'Invalid input',
  503: 'Service unavailable',
};
const SERVER_ERROR = 'Internal error';

type Body = {
  message: string;
  code?: string;
  errors?: Record<string, string>;
  meta?: Record<string, unknown>;
};

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Every refusal leaves the API as `{ message, code?, errors? }`; nothing else reaches a caller.
 * Only bodies this app built on purpose (`{ message, code }`, the validation shape) pass through. Nest's own
 * bodies, Postgres errors and anything unexpected are replaced by a fixed message, so no SQL, stack or
 * internal name is echoed.
 */
export function toResponse(err: unknown): { status: number; body: Body } {
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const raw = err.getResponse();
    const own =
      typeof raw === 'object' && raw !== null
        ? (raw as Record<string, unknown>)
        : {};
    // Nest-built bodies carry `statusCode` (unknown route, malformed JSON, a bare `new XException()`).
    if (own.statusCode !== undefined || typeof own.message !== 'string')
      return {
        status,
        body: { message: DEFAULT_MESSAGE[status] ?? SERVER_ERROR },
      };
    const body: Body = { message: own.message };
    if (typeof own.code === 'string') body.code = own.code;
    if (typeof own.errors === 'object' && own.errors !== null)
      body.errors = own.errors as Record<string, string>;
    // Facts a refusal carries on purpose for the caller's screen (until when a QR stays payable).
    if (typeof own.meta === 'object' && own.meta !== null)
      body.meta = own.meta as Record<string, unknown>;
    return { status, body };
  }
  const e = err as { type?: string } | undefined;
  if (e?.type === 'entity.parse.failed')
    return { status: 400, body: { message: DEFAULT_MESSAGE[400] } };
  if (e?.type === 'entity.too.large')
    return { status: 413, body: { message: 'Request too large' } };
  switch (pgCode(err)) {
    case '23505':
      return { status: 409, body: { message: DEFAULT_MESSAGE[409] } };
    case '22P02':
    case '22003':
      return { status: 422, body: { message: DEFAULT_MESSAGE[422] } };
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
      // Route pattern and error class/code only: no body, params or messages.
      const name = err instanceof Error ? err.name : typeof err;
      this.logger.error(
        `${req.method ?? ''} ${req.route?.path ?? '?'} → ${name}${pgCode(err) ? ` (${pgCode(err)})` : ''}`,
      );
    }
    res.status(status).type('json').json(body);
  }
}
