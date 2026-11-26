/**
 * A fixed-window counter in memory, per key: at most `limit` hits per `windowMs`. Per process: with several pos-api
 * instances each counts its own (the limit then applies per instance), which is enough to stop a runaway agent loop
 * or a key being guessed at speed. shortcut: in-memory per instance; move to Postgres or Redis if pos-api scales out.
 */
export class WindowLimiter {
  private readonly windows = new Map<string, { start: number; hits: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Counts one hit; false when the key is over its limit in the current window. */
  hit(key: string, now = Date.now()): boolean {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      if (!w && this.windows.size >= this.maxKeys) this.prune(now);
      this.windows.set(key, { start: now, hits: 1 });
      return true;
    }
    w.hits += 1;
    return w.hits <= this.limit;
  }

  private prune(now: number): void {
    for (const [k, w] of this.windows)
      if (now - w.start >= this.windowMs) this.windows.delete(k);
    // Still full: drop the oldest window rather than grow without bound.
    if (this.windows.size >= this.maxKeys) {
      const [oldest] = this.windows.keys();
      if (oldest !== undefined) this.windows.delete(oldest);
    }
  }
}
