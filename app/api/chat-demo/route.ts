/**
 * Free testnet chat demo for the Multi-turn Conversation widget on /build.
 *
 * Uses a server-side wallet (LIGHTNODE_DEMO_PRIVATE_KEY env) to fire ONE
 * encrypted inference per request against testnet (no real LCAI spent
 * since testnet is free). Per-IP rate limited so a single visitor can't
 * drain the wallet's faucet balance.
 *
 * If the env var isn't configured, the route 503s with a clear pointer to
 * the runnable example - the widget renders "demo wallet not configured"
 * with a Clone-and-run code block so the user can still try the SDK.
 *
 * POST /api/chat-demo
 * Body: { message: string, history?: ChatMessage[] }
 * Returns: { answer, jobId, worker } | { error, runLocally: true }
 */
import { NextResponse, type NextRequest } from "next/server";
import { Conversation, type ChatMessage } from "lightnode-sdk";

export const dynamic = "force-dynamic";
// Edge runtime gives 30s wall clock on Hobby vs 10s for serverless functions,
// which is the cap that matters for an end-to-end encrypted inference (worker
// pickup + decode + answer typically lands in 5-25s). The SDK's WebSocket
// auto-resolution falls through to `globalThis.WebSocket` which Edge provides.
export const runtime = "edge";
export const maxDuration = 30;

// `echo 0x... | vercel env add ...` puts a trailing newline into the stored
// value, which silently breaks a strict length check downstream. Trim
// defensively so future re-stores don't have to be perfect.
const DEMO_KEY = (process.env.LIGHTNODE_DEMO_PRIVATE_KEY ?? "").trim() as `0x${string}` | "";

// Per-IP throttle so one visitor can't drain the demo wallet's faucet
// balance. Memory only - resets on cold-start, which is fine since
// faucet refills daily anyway.
const HITS: Map<string, { count: number; firstAt: number }> = new Map();
const WINDOW_MS = 60 * 60 * 1000; // 1h
const MAX_PER_WINDOW = 3;

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
        error: "Live chat demo is not configured. Run the runnable example locally to try it.",
        runLocally: true,
        howTo:
          "git clone https://github.com/marinom2/lightnode-examples\ncd lightnode-examples/multi-turn-chat\nnpm install && npm start",
      },
      { status: 503 },
    );
  }
  const ip = getClientIp(req);
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Demo rate limit hit (${MAX_PER_WINDOW} per hour per IP). Try the runnable example or your own wallet.` },
      { status: 429 },
    );
  }
  let body: { message?: string; history?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });
  if (message.length > 500) return NextResponse.json({ error: "message too long (max 500 chars)" }, { status: 400 });

  try {
    const chat = new Conversation({
      network: "testnet",
      privateKey: DEMO_KEY,
      model: "llama3-8b",
      system: "You are a concise assistant. Reply in one or two short sentences.",
      maxHistoryTurns: 10,
    });
    // Replay history if provided so the model sees the conversation.
    for (const m of (body.history ?? []).slice(-10)) {
      if (m.role === "user") {
        // Push without calling send so we don't burn an inference per replay turn.
        (chat as unknown as { history: ChatMessage[] }).history.push(m);
      } else if (m.role === "assistant") {
        (chat as unknown as { history: ChatMessage[] }).history.push(m);
      }
    }
    const result = await chat.send(message);
    return NextResponse.json({
      answer: result.answer,
      jobId: result.jobId.toString(),
      worker: result.worker,
      remaining: rl.remaining,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message?.split("\n")[0] ?? "chat failed", runLocally: true },
      { status: 500 },
    );
  }
}
