import { Logger } from '@nestjs/common';

/**
 * UMKMall apps/api's native auth (`/mobile/v1/auth/**`, UMK-921), the surface UMKMall's own app signs in through
 * (UMK-2065). Credentials travel in JSON bodies both ways, never as cookies. Only pos-api calls it, server to server.
 * Never log a phone number, a code or a token: only the path and the status.
 */
export type NativeAnswer = {
  /** HTTP status; 0 when UMKMall could not be reached or did not answer in time. */
  status: number;
  body: Record<string, unknown>;
};

const TIMEOUT_MS = 10_000; // an OTP send waits on WhatsApp's provider, slower than /auth/me

export class UmkmallNative {
  private readonly logger = new Logger(UmkmallNative.name);

  constructor(private readonly origin: string) {}

  async call(
    method: 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    bearer?: string,
  ): Promise<NativeAnswer> {
    try {
      const res = await fetch(`${this.origin.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body !== undefined && { 'content-type': 'application/json' }),
          ...(bearer && { authorization: `Bearer ${bearer}` }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const parsed: unknown = await res.json().catch(() => ({}));
      if (res.status >= 500)
        this.logger.warn(`UMKMall ${path} answered ${res.status}`);
      return {
        status: res.status,
        body:
          parsed && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : {},
      };
    } catch (error) {
      this.logger.warn(`UMKMall ${path} unreachable: ${(error as Error).name}`);
      return { status: 0, body: {} };
    }
  }
}
