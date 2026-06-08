/**
 * Free testnet preflight demo for the Preflight SDK widget on
 * /build/sdks/preflight.
 *
 * Runs a real `workerPreflight` against the testnet worker pool using the
 * demo wallet (LIGHTNODE_DEMO_PRIVATE_KEY env), so the visitor gets a real
 * verdict for the cost of one testnet inference (free on testnet).
 *
 * Per-IP rate limited so a single visitor cannot drain the demo wallet.
 *
 *   POST /api/preflight-demo
 *   Body: { model?: string, deadlineMs?: number }
 *   Returns: { verdict, elapsedMs, worker, jobId, summary }
 *          | { error, runLocally?: true }
 */
import { NextResponse, type NextRequest } from "next/server";
import { workerPreflight, isStalledWorker } from "lightnode-sdk";
import { preflightMutex } from "@/lib/demo-wallet-mutex";
import { createInMemoryRateLimiter, getClientIp } from "@/lib/demo-rate-limit";

// Budget: maxDuration is 60s. Reserve up to ~45s for the actual SDK
// retry, leave ~10s for the mutex acquire. Fail fast on queueing so a
// queued caller is not eaten by the function timeout.
const MUTEX_TIMEOUT_MS = 10_000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const DEMO_KEY = (process.env.LIGHTNODE_DEMO_PRIVATE_KEY ?? "").trim() as `0x${string}` | "";

// Per-IP throttle (shared limiter, prunes expired entries) so a single visitor
// cannot drain the demo wallet. Memory-only; resets on cold start.
const MAX_PER_WINDOW = 2;
const rateLimit = createInMemoryRateLimiter({ windowMs: 60 * 60 * 1000, max: MAX_PER_WINDOW });

export async function POST(req: NextRequest) {
  if (!DEMO_KEY || !DEMO_KEY.startsWith("0x") || DEMO_KEY.length !== 66) {
    return NextResponse.json(
      {
        error: "Live preflight demo is not configured. Run the example locally to try it.",
        runLocally: true,
      },
      { status: 503 },
    );
  }
  const ip = getClientIp(req);
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Demo rate limit hit (${MAX_PER_WINDOW} per hour per IP). Run the example locally to try again.` },
      { status: 429 },
    );
  }
  let body: { model?: string; deadlineMs?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const model = typeof body.model === "string" ? body.model : "llama3-8b";
  const deadlineMs =
    typeof body.deadlineMs === "number" && body.deadlineMs >= 5_000 && body.deadlineMs <= 60_000
      ? body.deadlineMs
      : 45_000;

  // Wait for our turn at the shared wallet. Without this, two concurrent
  // visitors race the gateway's per-wallet selectSession and the loser
  // sees 409 selection_mismatch.
  const release = await preflightMutex.acquire(MUTEX_TIMEOUT_MS);
  if (!release) {
    return NextResponse.json(
      {
        error: "The demo wallet is busy with another preflight. Try again in 30 s, or open the example in StackBlitz with your own key.",
        runLocally: true,
      },
      { status: 503 },
    );
  }
  try {
    // SDK 0.7.8 auto-retries the inner selectSession/prepareSession dance
    // on 409. The mutex below serialises us at the wallet level so we do
    // not collide with our OWN parallel requests. Both together fix the
    // class of error: SDK handles transient, mutex handles concurrent.
    const result = await workerPreflight({
      network: "testnet",
      privateKey: DEMO_KEY,
      model,
      deadlineMs,
    });
    return NextResponse.json({
      verdict: result.verdict,
      elapsedMs: result.elapsedMs ?? null,
      worker: result.worker ?? null,
      submitJobTx: result.txs?.submitJob ?? null,
      summary: result.summary ?? "",
      remaining: rl.remaining,
    });
  } catch (e) {
    if (isStalledWorker(e)) {
      return NextResponse.json(
        {
          verdict: "stalled",
          elapsedMs: null,
          worker: null,
          submitJobTx: null,
          summary: "Workers stalled in a row. The protocol refunds the fees; try again later.",
          remaining: rl.remaining,
        },
        { status: 200 },
      );
    }
    const msg = (e as Error).message ?? "preflight failed";
    return NextResponse.json(
      {
        error: /selection_mismatch|selection was superseded|409/.test(msg)
          ? "The demo wallet has a session in flight from another visitor. Try again in 30 s, or open the example in StackBlitz with your own key."
          : msg.split("\n")[0],
        runLocally: true,
      },
      { status: 500 },
    );
  } finally {
    release();
  }
}
