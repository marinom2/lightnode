import { NextRequest, NextResponse } from "next/server";
import { ruleFor, consume } from "@/lib/rate-limit";

/**
 * Rate limiting for every /api/* route (the gateway proxy, DAO scans, and
 * operator preview get the tightest budgets - see lib/rate-limit.ts). Keyed by
 * client IP and path class so one noisy client can't starve the rest.
 */
export function middleware(req: NextRequest): NextResponse {
  const rule = ruleFor(req.nextUrl.pathname);
  if (!rule) return NextResponse.next();

  // First hop of x-forwarded-for is the client as seen by the platform edge.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  // Class by top path segment after /api/ so per-route windows stay separate.
  const pathClass = req.nextUrl.pathname.split("/").slice(0, 3).join("/");
  const verdict = consume(`${ip}:${pathClass}`, rule);
  if (verdict.allowed) return NextResponse.next();

  return NextResponse.json(
    { error: "rate limit exceeded, slow down" },
    { status: 429, headers: { "Retry-After": String(verdict.retryAfterSec) } },
  );
}

export const config = {
  matcher: "/api/:path*",
};
