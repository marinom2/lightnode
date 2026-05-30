/**
 * Stateless same-origin proxy to the LightChain consumer gateway
 * (`chat-api.<net>.lightchain.ai`). The browser-side playground calls
 * `/api/gw/<net>/...` instead of the gateway directly so that:
 *
 *   1. CORS is solved (the browser sees a same-origin response).
 *   2. The gateway URL stays in one place (this file), not in the bundle.
 *
 * No state is persisted. The bearer JWT lives only in the user's session and is
 * forwarded one-shot per request. This route is intentionally generic so the
 * SDK and the playground can call any /api/* endpoint the gateway exposes
 * (challenge, verify, models, sessions/select, sessions/prepare, blobs,
 * sessions/:id/token, etc.) without code changes here.
 */

import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic"; // never cache - every prompt/auth is unique
export const runtime = "nodejs";

const ALLOWED_NETS = new Set(["mainnet", "testnet"]);

function upstreamUrl(net: string, path: string[], search: string): string {
  const tail = path.join("/");
  return `https://chat-api.${net}.lightchain.ai/${tail}${search}`;
}

// Headers we forward FROM the browser INTO the upstream. Keep this tight to
// avoid leaking hop-by-hop or sensitive proxy headers; the only ones the
// gateway needs are Authorization (the SIWE-issued JWT) and Content-Type.
const FORWARD_REQ_HEADERS = ["authorization", "content-type", "accept"];

// Headers we forward FROM upstream BACK to the browser. We drop hop-by-hop
// headers (transfer-encoding, connection) so Next.js can stream cleanly.
const FORWARD_RES_HEADERS = ["content-type", "cache-control", "x-request-id"];

function pickHeaders(src: Headers, allow: string[]): Headers {
  const out = new Headers();
  for (const k of allow) {
    const v = src.get(k);
    if (v) out.set(k, v);
  }
  return out;
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ net: string; path: string[] }> }) {
  const { net, path } = await ctx.params;
  if (!ALLOWED_NETS.has(net)) {
    return new Response(JSON.stringify({ error: "unknown network" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const url = upstreamUrl(net, path, req.nextUrl.search);
  const init: RequestInit = {
    method: req.method,
    headers: pickHeaders(req.headers, FORWARD_REQ_HEADERS),
    redirect: "manual",
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    // Read the body as a buffer so we don't pay an extra parse - the upstream
    // sees the exact bytes the browser sent. Important for signature payloads
    // where any reformatting could mismatch.
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 0) init.body = buf;
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return new Response(JSON.stringify({ error: `upstream fetch failed: ${(err as Error).message}` }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
  const headers = pickHeaders(res.headers, FORWARD_RES_HEADERS);
  // 202 (pending) is meaningful for the session-token poll loop - preserve it.
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export { proxy as GET, proxy as POST };
