import { loadEnv } from '../config';
import {
  BANKS_CACHE_MS,
  PaymentSync,
  RENEW_INTENT_CALLS,
  renewStrandedMsOf,
} from './payment-sync.service';
import { PaymentApiError, type PaymentsClient } from './payments.client';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BANKS = [
  { code: 'FAKE', name: 'Bank Fake' },
  { code: 'FAKE2', name: 'Bank Fake 2' },
];

/** A PaymentSync whose only collaborator in use is the client's `merchantAccounts` (no database is touched). */
function syncWith(merchantAccounts: jest.Mock) {
  const client = { merchantAccounts } as unknown as PaymentsClient;
  return new PaymentSync({} as never, client, {} as never);
}

const answer = () =>
  Promise.resolve({
    mode: 'fake',
    accounts: [
      {
        methods: [
          { method: 'fake_va', banks: BANKS },
          { method: 'fake_qris', banks: [] },
        ],
      },
    ],
  });

describe('PaymentSync.banksOf: the banks cache (UMK-2037, UMK-2055)', () => {
  let now = 1_000_000;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it('a hit within BANKS_CACHE_MS asks payment-api once, for every method of the store', async () => {
    const ask = jest.fn(answer);
    const sync = syncWith(ask);
    expect(await sync.banksOf(TENANT, 'fake_va')).toEqual(BANKS);
    now += BANKS_CACHE_MS - 1;
    expect(await sync.banksOf(TENANT, 'fake_va')).toEqual(BANKS);
    expect(await sync.banksOf(TENANT, 'fake_qris')).toEqual([]);
    // A method the store does not have needs no bank.
    expect(await sync.banksOf(TENANT, 'fake_checkout')).toEqual([]);
    expect(ask).toHaveBeenCalledTimes(1);
    // Per store: another store is asked for its own.
    await sync.banksOf(OTHER, 'fake_va');
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask).toHaveBeenLastCalledWith(OTHER);
  });

  it('an entry BANKS_CACHE_MS old is asked again, and the new answer is kept', async () => {
    const ask = jest.fn(answer);
    const sync = syncWith(ask);
    await sync.banksOf(TENANT, 'fake_va');
    now += BANKS_CACHE_MS;
    ask.mockImplementationOnce(() =>
      Promise.resolve({
        mode: 'fake',
        accounts: [{ methods: [{ method: 'fake_va', banks: [BANKS[1]] }] }],
      }),
    );
    expect(await sync.banksOf(TENANT, 'fake_va')).toEqual([BANKS[1]]);
    expect(await sync.banksOf(TENANT, 'fake_va')).toEqual([BANKS[1]]);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('"no answer" is null and never kept: the next sale asks again', async () => {
    const ask = jest.fn((): Promise<unknown> =>
      Promise.reject(new PaymentApiError('unavailable', null, null)),
    );
    const sync = syncWith(ask);
    expect(await sync.banksOf(TENANT, 'fake_va')).toBeNull();
    ask.mockImplementation(answer);
    expect(await sync.banksOf(TENANT, 'fake_va')).toEqual(BANKS);
    expect(ask).toHaveBeenCalledTimes(2);
    // An expired entry whose refresh fails is not served either.
    now += BANKS_CACHE_MS;
    ask.mockImplementation(() =>
      Promise.reject(new PaymentApiError('rejected', 403, 'x')),
    );
    expect(await sync.banksOf(TENANT, 'fake_va')).toBeNull();
  });

  it('an error that is not payment-api\'s answer is thrown, not taken for "no answer"', async () => {
    const sync = syncWith(jest.fn(() => Promise.reject(new TypeError('bug'))));
    await expect(sync.banksOf(TENANT, 'fake_va')).rejects.toThrow('bug');
  });
});

describe('renewStrandedMsOf: the bound of a request for a new bill (UMK-2042, PR 44 review)', () => {
  const BASE = {
    DATABASE_URL: 'postgres://u:p@localhost:5544/pos',
    POS_SESSION_SECRET: 'x'.repeat(32),
    UMKMALL_WEB_URL: 'http://127.0.0.1:9',
    POS_SERVICE_KEY: 'k'.repeat(16),
    PAYMENT_API_URL: 'http://payment.internal:3001/',
    PAYMENT_SERVICE_KEY: 'service-key-0123456789',
  };

  it('at the smallest settings loadEnv allows, the intent outlives every call it waits on, with slack', () => {
    for (const timeoutMs of [1000, 5000, 30_000]) {
      const smallestAfterSeconds = Math.ceil((2 * timeoutMs) / 1000);
      const env = loadEnv({
        ...BASE,
        PAYMENT_API_TIMEOUT_MS: String(timeoutMs),
        POS_PAYMENT_RECONCILE_AFTER_SECONDS: String(smallestAfterSeconds),
      });
      const bound = renewStrandedMsOf(
        env.POS_PAYMENT_RECONCILE_AFTER_SECONDS * 1000,
        env.PAYMENT_API_TIMEOUT_MS,
      );
      // Every call the holder waits on runs to its timeout, and two more timeouts are left for the database.
      expect(bound - RENEW_INTENT_CALLS * timeoutMs).toBeGreaterThanOrEqual(
        2 * timeoutMs,
      );
      // The assumption under it: a shorter wait than two timeouts does not boot.
      expect(() =>
        loadEnv({
          ...BASE,
          PAYMENT_API_TIMEOUT_MS: String(timeoutMs),
          POS_PAYMENT_RECONCILE_AFTER_SECONDS: String(smallestAfterSeconds - 1),
        }),
      ).toThrow('POS_PAYMENT_RECONCILE_AFTER_SECONDS');
    }
  });
});
