import { recordAudit } from './record';
import { MASK, scrubDetails, scrubString } from './scrub';

describe('audit log scrub (UMK-1969)', () => {
  it('drops every key that names a secret or a contact, in any spelling', () => {
    const out = scrubDetails({
      pin: '123456',
      pinHash: 'x',
      newPin: '1',
      access_token: 't',
      sessionToken: 't',
      phone: '0812',
      phoneNumber: '0812',
      customerName: 'Bu Sari',
      memberId: 'm',
      email: 'a@b.c',
      password: 'p',
      amount: 5000,
      reasonCode: 'other',
      openingCash: 1,
    });
    expect(out).toEqual({ amount: 5000, reasonCode: 'other', openingCash: 1 });
  });

  it('masks a phone-like number and a token-like run inside a value', () => {
    expect(scrubString('hubungi 0812-3456-7890 segera')).toBe(
      `hubungi ${MASK} segera`,
    );
    expect(scrubString('+62 812 3456 7890')).toBe(MASK);
    expect(scrubString('a'.repeat(40))).toBe(MASK);
    expect(scrubString('Teh Botol 350 ml')).toBe('Teh Botol 350 ml');
    // A timestamp is kept, a date with other digits next to it is not.
    expect(scrubString('2026-11-26T14:07:06.598Z')).toBe(
      '2026-11-26T14:07:06.598Z',
    );
    expect(scrubString('2026-11-26 0812')).toBe(MASK);
  });

  it('keeps ids and amounts, and recurses into nested values', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(
      scrubDetails({
        saleId: id,
        nested: { pin: '1', n: 2 },
        list: ['0812 3456 7890', 3],
      }),
    ).toEqual({
      saleId: id,
      nested: { n: 2 },
      list: [MASK, 3],
    });
  });

  it('cuts long strings and drops what JSON cannot hold', () => {
    const out = scrubDetails({ s: 'x y '.repeat(200), f: () => 1, n: NaN });
    expect((out.s as string).length).toBe(200);
    expect(out).not.toHaveProperty('f');
    expect(out.n).toBeNull();
  });

  it('is applied to whatever a call site hands recordAudit', async () => {
    const written: Record<string, unknown>[] = [];
    const writer = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          written.push(v);
          return Promise.resolve();
        },
      }),
    } as never;
    await recordAudit(
      writer,
      { tenantId: 't', actorId: 'a', kind: 'cashier' },
      'void',
      {
        target: { type: 'sale', label: '#1 telp 0812 3456 7890' },
        details: { total: 9000, pin: '123456', note: 'hp 081234567890' },
      },
    );
    expect(written).toHaveLength(1);
    expect(written[0].details).toEqual({ total: 9000, note: `hp ${MASK}` });
    expect(written[0].targetLabel).toBe(`#1 telp ${MASK}`);
    await expect(
      recordAudit(
        writer,
        { tenantId: 't', actorId: 'a', kind: 'owner' },
        'nope' as never,
      ),
    ).rejects.toThrow();
  });
});
