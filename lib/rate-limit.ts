/**
 * In-memory sliding-window rate limiter for the API routes, used by
 * middleware.ts. State lives per server instance (per edge isolate / lambda),
 * which bounds single-source bursts without external infrastructure; a
 * distributed store can replace `windows` later without changing callers.
 */

export interface RateLimitRule {
  /** Max requests allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Expensive routes fan out to chains/subgraphs or relay upstream; everything
 *  else is a cheap cached read. Matched by path prefix, first hit wins. */
export const API_RULES: { prefix: string; rule: RateLimitRule }[] = [
  { prefix: "/api/gw/", rule: { limit: 30, windowMs: 60_000 } },
  { prefix: "/api/dao-", rule: { limit: 30, windowMs: 60_000 } },
  { prefix: "/api/operator-preview", rule: { limit: 30, windowMs: 60_000 } },
  { prefix: "/api/sdk-demo", rule: { limit: 20, windowMs: 60_000 } },
  { prefix: "/api/", rule: { limit: 120, windowMs: 60_000 } },
];

export function ruleFor(pathname: string): RateLimitRule | null {
  const hit = API_RULES.find((r) => pathname.startsWith(r.prefix));
  return hit ? hit.rule : null;
}

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_KEYS = 10_000; // hard cap so a key-spray can't grow memory unbounded

/** Drop expired windows; called opportunistically so no timer is needed. */
function sweep(now: number): void {
  if (windows.size < MAX_KEYS) return;
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
  // Still over the cap after sweeping live keys: refuse to grow (fail open).
  if (windows.size >= MAX_KEYS) windows.clear();
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (for the Retry-After header). */
  retryAfterSec: number;
}

/**
 * Count one request for `key` (caller-chosen, e.g. "ip:path-class") against a
 * rule. Fixed-window counting: simple, allocation-light, good enough to stop
 * abuse without punishing humans. `now` is injectable for tests.
 */
export function consume(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
  sweep(now);
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  w.count += 1;
  if (w.count <= rule.limit) return { allowed: true, retryAfterSec: 0 };
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
}

/** Test hook: reset all state between cases. */
export function resetRateLimiter(): void {
  windows.clear();
}
