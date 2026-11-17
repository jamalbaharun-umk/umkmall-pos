import {
  ConflictException,
  HttpException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { toResponse } from './error.filter';
import { fieldError } from './validation';

describe('error filter', () => {
  it('keeps a refusal body, minus Nest keys', () => {
    expect(toResponse(fieldError('name', 'Nama wajib diisi'))).toEqual({
      status: 422,
      body: {
        message: 'Nama wajib diisi',
        errors: { name: 'Nama wajib diisi' },
      },
    });
    expect(toResponse(new ConflictException('Opname sudah disetujui'))).toEqual(
      {
        status: 409,
        body: { message: 'Opname sudah disetujui' },
      },
    );
    expect(
      toResponse(new HttpException({ message: 'Tunggu', retryAfter: 30 }, 429))
        .body,
    ).toEqual({ message: 'Tunggu', retryAfter: 30 });
  });

  it('replaces English defaults', () => {
    expect(toResponse(new UnauthorizedException()).body.message).toBe(
      'Sesi berakhir, silakan masuk lagi',
    );
  });

  it('maps an oversize upload to a file field error', () => {
    expect(toResponse(new PayloadTooLargeException('File too large'))).toEqual({
      status: 422,
      body: {
        message: 'Ukuran gambar maksimal 2 MB',
        errors: { file: 'Ukuran gambar maksimal 2 MB' },
      },
    });
  });

  it('maps Postgres codes, wrapped or not, and hides everything else', () => {
    expect(toResponse({ cause: { code: '23505' } }).status).toBe(409);
    expect(toResponse({ code: '23503' }).status).toBe(409);
    expect(toResponse({ cause: { code: '22P02' } }).status).toBe(422);
    expect(toResponse({ type: 'entity.parse.failed' })).toEqual({
      status: 400,
      body: { message: 'Format data tidak valid' },
    });
    const secret = new Error('duplicate key value (phone)=(0812…)');
    expect(toResponse(secret)).toEqual({
      status: 500,
      body: {
        message: 'Terjadi kesalahan di server. Coba lagi sebentar lagi.',
      },
    });
  });
});
