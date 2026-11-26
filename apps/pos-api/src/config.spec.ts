import { loadEnv } from './config';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5544/pos',
  POS_SESSION_SECRET: 'x'.repeat(32),
  UMKMALL_WEB_URL: 'http://localhost:9099',
  POS_SERVICE_KEY: 'purge-key-purge-key',
  NODE_ENV: 'test',
};

describe('loadEnv: the agent key (UMK-1978 review)', () => {
  it('accepts no agent key (agent sessions off) or its own key of 32+ characters', () => {
    expect(loadEnv(base).POS_AGENT_SERVICE_KEY).toBeUndefined();
    expect(
      loadEnv({ ...base, POS_AGENT_SERVICE_KEY: '' }).POS_AGENT_SERVICE_KEY,
    ).toBeUndefined();
    const key = 'a'.repeat(32);
    expect(
      loadEnv({ ...base, POS_AGENT_SERVICE_KEY: key }).POS_AGENT_SERVICE_KEY,
    ).toBe(key);
  });

  it('refuses to boot with a short agent key or the purge key reused, naming the variable only', () => {
    expect(() =>
      loadEnv({ ...base, POS_AGENT_SERVICE_KEY: 'short-key' }),
    ).toThrow('Invalid environment: POS_AGENT_SERVICE_KEY');
    const shared = 'b'.repeat(40);
    expect(() =>
      loadEnv({
        ...base,
        POS_SERVICE_KEY: shared,
        POS_AGENT_SERVICE_KEY: shared,
      }),
    ).toThrow('Invalid environment: POS_AGENT_SERVICE_KEY');
    try {
      loadEnv({
        ...base,
        POS_SERVICE_KEY: shared,
        POS_AGENT_SERVICE_KEY: shared,
      });
    } catch (e) {
      expect((e as Error).message).not.toContain(shared);
    }
  });
});
