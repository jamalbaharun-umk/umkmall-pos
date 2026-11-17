import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { LocalDate, Phone, Rupiah, validate } from './validation';

const refusal = (schema: z.ZodTypeAny, input: unknown) => {
  try {
    validate(schema, input);
  } catch (e) {
    const ex = e as HttpException;
    return {
      status: ex.getStatus(),
      body: ex.getResponse() as {
        message: string;
        errors: Record<string, string>;
      },
    };
  }
  throw new Error('accepted');
};

describe('validate', () => {
  const Schema = z
    .object({ name: z.string().trim().min(1), qty: Rupiah, day: LocalDate })
    .strict();

  it('returns the parsed value', () => {
    expect(
      validate(Schema, { name: ' a ', qty: 1, day: '2026-02-28' }),
    ).toEqual({ name: 'a', qty: 1, day: '2026-02-28' });
  });

  it('answers 422 with an Indonesian message per field', () => {
    const r = refusal(Schema, {
      name: '',
      qty: 1.5,
      day: '2026-02-31',
      extra: 1,
    });
    expect(r.status).toBe(422);
    expect(r.body.errors).toEqual({
      name: 'Wajib diisi',
      qty: 'Harus bilangan bulat rupiah',
      day: 'Tanggal tidak valid',
      extra: 'Isian tidak dikenal',
    });
    expect(r.body.message).toBe('Periksa kembali isian kamu');
  });

  it('names a missing field and a wrong type', () => {
    expect(
      refusal(Schema, { qty: '5', day: '2026-01-01' }).body.errors,
    ).toEqual({
      name: 'Wajib diisi',
      qty: 'Harus berupa angka',
    });
    expect(refusal(z.object({ a: z.string() }), {}).body.message).toBe(
      'Wajib diisi',
    );
  });

  it('checks phone numbers', () => {
    expect(validate(Phone, '0812-3456-7890')).toBe('0812-3456-7890');
    expect(refusal(Phone, 'abc').body.errors).toEqual({
      _: 'Nomor telepon tidak valid',
    });
  });
});
