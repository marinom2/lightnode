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

  try {
    const r = await workerPreflight({
      network: "testnet",
      privateKey: DEMO_KEY,
      model,
      deadlineMs,
    });
    return NextResponse.json({
      verdict: r.verdict,
      elapsedMs: r.elapsedMs ?? null,
      worker: r.worker ?? null,
      submitJobTx: r.txs?.submitJob ?? null,
      summary: r.summary ?? "",
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
    return NextResponse.json(
      { error: (e as Error).message?.split("\n")[0] ?? "preflight failed", runLocally: true },
      { status: 500 },
    );
  }
}
