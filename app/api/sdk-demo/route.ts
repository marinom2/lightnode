/**
 * Server-side runner for the interactive "Try a CLI command" widget on
 * /build. Executes one of the read-only LightNode methods server-side and
 * returns the JSON result. Mirrors the `lightnode <command>` CLI shape so
 * what the user sees on the page is literally what the CLI would print.
 *
 * All operations here are read-only (no key required, no writes). Anything
 * that would write or cost LCAI is excluded by design.
 *
 * POST /api/sdk-demo
 * Body: { command: "network" | "models" | "worker" | "jobs" | "registered" | "fee" | "analytics" | "reliability" | "job",
 *         net?: "mainnet" | "testnet",
 *         arg?: string }
 */
import { NextResponse, type NextRequest } from "next/server";
import { LightNode, type NetworkId } from "lightnode-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_COMMANDS = new Set([
  "network",
  "models",
  "worker",
  "jobs",
  "registered",
  "fee",
  "analytics",
  "reliability",
  "job",
]);

// Replacer for JSON.stringify that handles bigint values (subgraph + on-chain
// reads sometimes return them).
function safeStringify(v: unknown): string {
  return JSON.stringify(
    v,
    (_k, val) => (typeof val === "bigint" ? val.toString() : val),
    2,
  );
}

function isValidAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

export async function POST(req: NextRequest) {
  let body: { command?: string; net?: string; arg?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { command, net: netParam, arg } = body;
  if (!command || !ALLOWED_COMMANDS.has(command)) {
    return NextResponse.json(
      { error: `unknown command. Allowed: ${[...ALLOWED_COMMANDS].join(", ")}` },
      { status: 400 },
    );
  }
  const net = (netParam === "testnet" ? "testnet" : "mainnet") as NetworkId;
  const ln = new LightNode(net);

  try {
    let result: unknown;
    switch (command) {
      case "network":
        result = await ln.getNetworkStats();
        break;
      case "models":
        result = await ln.getModels();
        break;
      case "worker":
        if (!arg || !isValidAddress(arg)) return NextResponse.json({ error: "worker: arg must be a 0x address" }, { status: 400 });
        result = {
          onchainRegistered: await ln.isRegistered(arg),
          worker: await ln.getWorker(arg),
          recentJobs: (await ln.getWorkerJobs(arg, 5)).map((j) => ({ id: j.id, state: j.state })),
        };
        break;
      case "jobs":
        if (!arg || !isValidAddress(arg)) return NextResponse.json({ error: "jobs: arg must be a 0x address" }, { status: 400 });
        result = await ln.getWorkerJobs(arg, 100);
        break;
      case "registered":
        if (!arg || !isValidAddress(arg)) return NextResponse.json({ error: "registered: arg must be a 0x address" }, { status: 400 });
        result = await ln.isRegistered(arg);
        break;
      case "fee":
        result = `${await ln.estimateFee(arg || "llama3-8b")} LCAI per job (${arg || "llama3-8b"})`;
        break;
      case "analytics":
        result = await ln.getModelStats();
        break;
      case "reliability":
        result = await ln.getWorkerStats(1000, 20);
        break;
      case "job":
        if (!arg) return NextResponse.json({ error: "job: arg must be a job id" }, { status: 400 });
        result = (await ln.getJobStatus(arg)) ?? { jobId: arg, status: "not-indexed" };
        break;
    }
    // Round-trip through safeStringify so bigints become strings for the wire.
    return new NextResponse(safeStringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.split("\n")[0] ?? "unknown error" }, { status: 500 });
  }
}
