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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const DEMO_KEY = (process.env.LIGHTNODE_DEMO_PRIVATE_KEY ?? "").trim() as `0x${string}` | "";

const HITS: Map<string, { count: number; firstAt: number }> = new Map();
const WINDOW_MS = 60 * 60 * 1000; // 1h
const MAX_PER_WINDOW = 2;

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function rateLimit(ip: string): { ok: boolean; remaining: number } {
  const now = Date.now();
  const entry = HITS.get(ip);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    HITS.set(ip, { count: 1, firstAt: now });
    return { ok: true, remaining: MAX_PER_WINDOW - 1 };
  }
  if (entry.count >= MAX_PER_WINDOW) return { ok: false, remaining: 0 };
  entry.count++;
  return { ok: true, remaining: MAX_PER_WINDOW - entry.count };
}

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

  // Retry on gateway-state churn. The gateway returns 409
  // selection_mismatch when a prior session for this wallet has not
  // aged out - common on a shared demo wallet. workerPreflight folds the
  // error into a `failed` verdict with the message in summary instead of
  // throwing, so we inspect the verdict + summary for the retry signal.
  type PreflightResult = Awaited<ReturnType<typeof workerPreflight>>;
  let result: PreflightResult | null = null;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      // 1.5s, then 3s - same backoff as the chat-demo retry path.
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    try {
      result = await workerPreflight({
        network: "testnet",
        privateKey: DEMO_KEY,
        model,
        deadlineMs,
      });
      const summary = result.summary ?? "";
      const failedOnSelection =
        result.verdict !== "ok" && /selection_mismatch|selection was superseded|409/.test(summary);
      if (!failedOnSelection) break;
      result = null; // try again
    } catch (e) {
      lastErr = e as Error;
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
      if (!/selection_mismatch|selection was superseded|409/.test(lastErr.message ?? "")) break;
    }
  }
  if (result) {
    return NextResponse.json({
      verdict: result.verdict,
      elapsedMs: result.elapsedMs ?? null,
      worker: result.worker ?? null,
      submitJobTx: result.txs?.submitJob ?? null,
      summary: result.summary ?? "",
      remaining: rl.remaining,
    });
  }
  // Friendly translation of the gateway state error.
  return NextResponse.json(
    {
      error:
        lastErr && !/selection_mismatch|selection was superseded|409/.test(lastErr.message ?? "")
          ? lastErr.message.split("\n")[0]
          : "The demo wallet has a session in flight from another visitor. Try again in 30 s, or open the example in StackBlitz with your own key.",
      runLocally: true,
    },
    { status: 500 },
  );
}
