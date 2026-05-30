/**
 * Stateless proxy to the LightChain consumer gateway
 * (`chat-api.<net>.lightchain.ai`). Two callers use it:
 *
 *   1. The lightnode.app playground (same-origin): `/api/gw/<net>/...`
 *      removes the CORS problem the gateway has when called cross-origin.
 *   2. Third-party SDK consumers running in browser-like contexts
 *      (StackBlitz WebContainer, Codespaces browser, a builder's own dApp
 *      frontend). The gateway does not return Access-Control-Allow-Origin,
 *      so direct calls throw "fetch failed". The SDK routes through here
 *      by default in those contexts. CORS headers below open this proxy
 *      to any origin so the SDK works from anywhere.
 *
 * No state is persisted. The bearer JWT lives only in the request and is
 * forwarded one-shot. This route is intentionally generic so the SDK and
 * the playground can call any /api/* endpoint the gateway exposes
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

// Permissive CORS so any third-party origin (StackBlitz WebContainer, a builder's
// own frontend, Codespaces) can use this proxy. The upstream endpoints are public
// (anyone can call them server-side), so opening the proxy adds no new attack
// surface - it just lifts the browser-only CORS restriction.
function corsHeaders(req: NextRequest): Record<string, string> {
  const reqHeaders = req.headers.get("access-control-request-headers") ?? "authorization, content-type, accept";
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    "access-control-allow-headers": reqHeaders,
    "access-control-max-age": "600",
  };
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ net: string; path: string[] }> }) {
  const { net, path } = await ctx.params;
  const cors = corsHeaders(req);
  if (!ALLOWED_NETS.has(net)) {
    return new Response(JSON.stringify({ error: "unknown network" }), {
      status: 400,
      headers: { "content-type": "application/json", ...cors },
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
      headers: { "content-type": "application/json", ...cors },
    });
  }
  const headers = pickHeaders(res.headers, FORWARD_RES_HEADERS);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  // 202 (pending) is meaningful for the session-token poll loop - preserve it.
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function preflight(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export { proxy as GET, proxy as POST, preflight as OPTIONS };
