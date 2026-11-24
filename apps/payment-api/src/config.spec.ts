import { loadEnv } from './config';

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
});
