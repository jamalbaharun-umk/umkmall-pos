import { adapterListed, loadEnv } from './config';

const base = {
  DATABASE_URL: 'postgres://payment_app:x@localhost:5544/payment',
  PAYMENT_SERVICE_KEY: 'a-service-key-of-32-characters!!',
};

describe('environment', () => {
  it('loads with the defaults', () => {
    expect(loadEnv(base)).toMatchObject({
      PAYMENT_EXPIRY_GRACE_SECONDS: 600,
      PAYMENT_LATE_SWEEP_SECONDS: 3600,
    });
  });

  it('refuses to boot when the late-money sweep ends before the expiry grace does, naming the variable and no value', () => {
    expect(() =>
      loadEnv({
        ...base,
        PAYMENT_EXPIRY_GRACE_SECONDS: '600',
        PAYMENT_LATE_SWEEP_SECONDS: '599',
      }),
    ).toThrow('Invalid environment: PAYMENT_LATE_SWEEP_SECONDS');
    expect(() =>
      loadEnv({
        ...base,
        PAYMENT_EXPIRY_GRACE_SECONDS: '600',
        PAYMENT_LATE_SWEEP_SECONDS: '600',
      }),
    ).not.toThrow();
  });

  describe('gateway mode', () => {
    it('is fake by default, with the live switch off', () => {
      expect(loadEnv(base)).toMatchObject({
        PAYMENT_GATEWAY_MODE: 'fake',
        PAYMENT_LIVE_ENABLED: false,
      });
      expect(
        loadEnv({ ...base, PAYMENT_GATEWAY_MODE: 'sandbox' })
          .PAYMENT_GATEWAY_MODE,
      ).toBe('sandbox');
    });

    it('refuses to boot in live mode unless PAYMENT_LIVE_ENABLED is on', () => {
      expect(() => loadEnv({ ...base, PAYMENT_GATEWAY_MODE: 'live' })).toThrow(
        'Invalid environment: PAYMENT_LIVE_ENABLED',
      );
      expect(() =>
        loadEnv({
          ...base,
          PAYMENT_GATEWAY_MODE: 'live',
          PAYMENT_LIVE_ENABLED: 'false',
        }),
      ).toThrow('Invalid environment: PAYMENT_LIVE_ENABLED');
      expect(
        loadEnv({
          ...base,
          PAYMENT_GATEWAY_MODE: 'live',
          PAYMENT_LIVE_ENABLED: 'true',
        }),
      ).toMatchObject({
        PAYMENT_GATEWAY_MODE: 'live',
        PAYMENT_LIVE_ENABLED: true,
      });
      expect(() => loadEnv({ ...base, PAYMENT_GATEWAY_MODE: 'prod' })).toThrow(
        'Invalid environment: PAYMENT_GATEWAY_MODE',
      );
    });
  });

  describe('PAYMENT_ADAPTERS', () => {
    it('is empty by default and reads a comma list', () => {
      expect(loadEnv(base).PAYMENT_ADAPTERS).toEqual([]);
      expect(
        loadEnv({ ...base, PAYMENT_ADAPTERS: '' }).PAYMENT_ADAPTERS,
      ).toEqual([]);
      expect(
        loadEnv({ ...base, NODE_ENV: 'test', PAYMENT_ADAPTERS: ' fake ,' })
          .PAYMENT_ADAPTERS,
      ).toEqual(['fake']);
      expect(adapterListed('fake', {})).toBe(false);
      expect(adapterListed('fake', { PAYMENT_ADAPTERS: 'fake' })).toBe(true);
    });

    it('refuses a name that is not an adapter', () => {
      expect(() =>
        loadEnv({ ...base, PAYMENT_ADAPTERS: 'fake,xendit' }),
      ).toThrow('Invalid environment: PAYMENT_ADAPTERS');
    });

    it('refuses the fake gateway in production, and only there', () => {
      expect(() =>
        loadEnv({ ...base, NODE_ENV: 'production', PAYMENT_ADAPTERS: 'fake' }),
      ).toThrow('Invalid environment: PAYMENT_ADAPTERS');
      // An unset NODE_ENV counts as nothing: the fake needs an explicit development or test.
      expect(() => loadEnv({ ...base, PAYMENT_ADAPTERS: 'fake' })).toThrow(
        'Invalid environment: PAYMENT_ADAPTERS',
      );
      expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).not.toThrow();
      for (const NODE_ENV of ['development', 'test'])
        expect(() =>
          loadEnv({ ...base, NODE_ENV, PAYMENT_ADAPTERS: 'fake' }),
        ).not.toThrow();
    });
  });
});
