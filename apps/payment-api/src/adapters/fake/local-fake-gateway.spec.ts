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

  it('is three online, refund-only adapters of one provider', () => {
    const adapters = new LocalFakeGateway(new Clock()).adapters();
    expect(
      adapters.map((a) => [a.method, a.kind, a.provider, a.singleUseQr]),
    ).toEqual([
      ['fake_qris', 'online', 'fake', true],
      ['fake_va', 'online', 'fake', false],
      ['fake_checkout', 'online', 'fake', true],
    ]);
    for (const a of adapters)
      expect(a).toMatchObject({
        supportsVoid: false,
        supportsRefund: true,
        canCancel: true,
      });
  });

  it('onboards as a hosted provider of mode fake, with a toggle for each of its methods', () => {
    const gateway = new LocalFakeGateway(new Clock());
    const onboarding = gateway.onboarding();
    expect(onboarding).toMatchObject({
      provider: 'fake',
      verification: 'hosted',
      modes: ['fake'],
    });
    expect([...onboarding.methods]).toEqual(
      gateway.adapters().map((a) => a.method),
    );
  });

  it('reads an account notification only when its signature verifies and it is about an account', async () => {
    const gateway = new LocalFakeGateway(new Clock());
    const onboarding = gateway.onboarding();
    const merchant = { id: 'm-1', tenantId: 't-1', providerAccountId: null };
    await onboarding.createAccount(merchant, {
      businessType: 'individual',
      businessName: 'Warung',
      email: 'a@example.test',
      phone: '+628123456789',
    });
    const hook = gateway.accountNotification(gateway.accountOf('t-1')!);
    const input = (body: string, signature: string) => ({
      headers: { 'x-fake-signature': signature },
      rawBody: Buffer.from(body),
    });
    await expect(
      onboarding.handleAccountWebhook(input(hook.body, hook.signature)),
    ).resolves.toEqual({ eventId: hook.eventId, reference: 'm-1' });
    await expect(
      onboarding.handleAccountWebhook(input(`${hook.body} `, hook.signature)),
    ).rejects.toMatchObject({ name: 'WebhookSignatureError' });
    // A signed payment notification is not an account notification.
    const bill = gateway.notification({ paymentId: 'p' } as never);
    await expect(
      onboarding.handleAccountWebhook(input(bill.body, bill.signature)),
    ).rejects.toThrow('not an account notification');
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
