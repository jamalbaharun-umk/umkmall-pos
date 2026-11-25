import { Clock } from '../../config';
import { LocalFakeGateway } from './local-fake-gateway';

describe('LocalFakeGateway', () => {
  const nodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
  });

  it('refuses to exist in production or with NODE_ENV unset, whatever the configuration check said', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new LocalFakeGateway(new Clock())).toThrow(
      'loads only when NODE_ENV is development or test',
    );
    delete process.env.NODE_ENV;
    expect(() => new LocalFakeGateway(new Clock())).toThrow(
      'loads only when NODE_ENV is development or test',
    );
  });

  it('is two online, refund-only adapters of one provider', () => {
    const adapters = new LocalFakeGateway(new Clock()).adapters();
    expect(
      adapters.map((a) => [a.method, a.kind, a.provider, a.singleUseQr]),
    ).toEqual([
      ['fake_qris', 'online', 'fake', true],
      ['fake_va', 'online', 'fake', false],
    ]);
    for (const a of adapters)
      expect(a).toMatchObject({
        supportsVoid: false,
        supportsRefund: true,
        canCancel: true,
      });
  });

  it('signs with a secret of its own: another instance does not verify its notifications', async () => {
    const [one] = new LocalFakeGateway(new Clock()).adapters();
    const other = new LocalFakeGateway(new Clock());
    const hook = other.notification({ paymentId: 'p' } as never);
    await expect(
      one.handleWebhook({
        headers: { 'x-fake-signature': hook.signature },
        rawBody: Buffer.from(hook.body),
      }),
    ).rejects.toMatchObject({ name: 'WebhookSignatureError' });
  });
});
