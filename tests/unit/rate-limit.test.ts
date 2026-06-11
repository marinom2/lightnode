import { describe, it, expect, beforeEach } from "vitest";
import { consume, ruleFor, resetRateLimiter, API_RULES } from "@/lib/rate-limit";

const RULE = { limit: 3, windowMs: 60_000 };

describe("ruleFor", () => {
  it("gives the gateway proxy, DAO scans, and operator preview the tight budget", () => {
    for (const p of ["/api/gw/mainnet/api/models", "/api/dao-proposals", "/api/operator-preview"]) {
      expect(ruleFor(p)?.limit).toBe(30);
    }
  });
  it("covers every other api route with the default budget and skips pages", () => {
    expect(ruleFor("/api/network")?.limit).toBe(120);
    expect(ruleFor("/build/dao")).toBeNull();
    expect(ruleFor("/")).toBeNull();
  });
  it("orders prefixes most-specific-first so the catch-all cannot shadow them", () => {
    const catchAll = API_RULES.findIndex((r) => r.prefix === "/api/");
    expect(catchAll).toBe(API_RULES.length - 1);
  });
});

describe("consume", () => {
  beforeEach(() => resetRateLimiter());

  it("allows up to the limit inside one window, then rejects with a retry hint", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(consume("k", RULE, t0 + i).allowed).toBe(true);
    const rejected = consume("k", RULE, t0 + 10);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSec).toBeGreaterThan(0);
    expect(rejected.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("resets after the window elapses", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) consume("k", RULE, t0);
    expect(consume("k", RULE, t0 + 60_001).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) consume("a", RULE, t0);
    expect(consume("a", RULE, t0).allowed).toBe(false);
    expect(consume("b", RULE, t0).allowed).toBe(true);
  });
});
