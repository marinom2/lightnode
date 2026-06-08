/**
 * Tiny in-memory per-IP rate limiter for the public demo routes (chat-demo,
 * preflight-demo). Memory-only and best-effort: it resets on a cold start and
 * is per-instance, which is fine because it only guards a faucet-funded demo
 * wallet, not a security boundary.
 *
 * Unlike the original inline versions, this one PRUNES expired entries so a
 * long-lived warm serverless instance that sees many distinct IPs doesn't
 * accumulate stale records without bound.
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
}

export interface RateLimiterOptions {
  /** Window length in ms (e.g. 1h). */
  windowMs: number;
  /** Max requests per IP per window. */
  max: number;
  /** Hard cap on tracked IPs; a sweep is forced when exceeded. Default 10,000. */
  maxEntries?: number;
  /** Clock override for tests. Defaults to Date.now. */
  now?: () => number;
}

/** A rate-limit function plus a test/observability hook for the tracked-IP count. */
export interface RateLimiter {
  (ip: string): RateLimitResult;
  /** Number of IPs currently tracked (after any pruning). */
  entryCount(): number;
}

/**
 * Build a per-IP rate limiter with opportunistic pruning. Pruning runs at most
 * once per window (or when the map exceeds `maxEntries`), so the common path
 * stays O(1) and memory stays bounded instead of growing with every distinct IP
 * a warm instance ever sees.
 */
export function createInMemoryRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { windowMs, max, maxEntries = 10_000, now = Date.now } = opts;
  const hits = new Map<string, { count: number; firstAt: number }>();
  let lastSweep = 0;

  const prune = (t: number): void => {
    if (t - lastSweep < windowMs && hits.size < maxEntries) return;
    lastSweep = t;
    for (const [ip, entry] of hits) {
      if (t - entry.firstAt > windowMs) hits.delete(ip);
    }
  };

  const rateLimit = (ip: string): RateLimitResult => {
    const t = now();
    prune(t);
    const entry = hits.get(ip);
    if (!entry || t - entry.firstAt > windowMs) {
      hits.set(ip, { count: 1, firstAt: t });
      return { ok: true, remaining: max - 1 };
    }
    if (entry.count >= max) return { ok: false, remaining: 0 };
    entry.count++;
    return { ok: true, remaining: max - entry.count };
  };
  (rateLimit as RateLimiter).entryCount = () => hits.size;
  return rateLimit as RateLimiter;
}

/** First client IP from the standard proxy headers, or "unknown". */
export function getClientIp(req: { headers: Headers }): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
