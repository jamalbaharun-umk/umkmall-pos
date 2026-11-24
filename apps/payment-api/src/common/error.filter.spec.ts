import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { toResponse } from './error.filter';
import { fieldError } from './validation';

describe('toResponse', () => {
  it('passes through a refusal this app built: message, code, errors', () => {
    expect(
      toResponse(new ConflictException({ message: 'No', code: 'nope' })),
    ).toEqual({ status: 409, body: { message: 'No', code: 'nope' } });
    expect(toResponse(fieldError('amount', 'Bad'))).toEqual({
      status: 422,
      body: { message: 'Bad', errors: { amount: 'Bad' } },
    });
  });

  it('drops keys a refusal did not mean to send', () => {
    const { body } = toResponse(
      new ConflictException({ message: 'No', sql: 'select secret' }),
    );
    expect(body).toEqual({ message: 'No' });
  });

  it('replaces Nest-built bodies with a fixed message', () => {
    expect(
      toResponse(new NotFoundException('Cannot GET /x?token=abc')),
    ).toEqual({ status: 404, body: { message: 'Not found' } });
    expect(toResponse(new ServiceUnavailableException())).toEqual({
      status: 503,
      body: { message: 'Service unavailable' },
    });
  });

  it('never echoes an unexpected error or a Postgres message', () => {
    expect(
      toResponse(new Error('connect ECONNREFUSED postgres://u:p@host/db')),
    ).toEqual({ status: 500, body: { message: 'Internal error' } });
    const pg = Object.assign(new Error('duplicate key value (secret)'), {
      code: '23505',
    });
    expect(toResponse(pg)).toEqual({
      status: 409,
      body: { message: 'Conflict' },
    });
    expect(toResponse({ type: 'entity.parse.failed' })).toEqual({
      status: 400,
      body: { message: 'Bad request' },
    });
  });
});
