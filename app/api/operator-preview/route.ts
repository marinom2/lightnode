/**
 * Read-only preview endpoint for the WorkerOperator SDK. Drives the
 * /build/sdks/operator stepper.
 *
 *   GET /api/operator-preview?action=config&net=testnet|mainnet
 *   GET /api/operator-preview?action=status&net=...&worker=0x...
 *
 * Returns plain JSON safe to render in the widget. Write actions
 * (claimTimeout, releaseAll, withdraw, deregister, ...) live in the
 * SDK only - the visitor runs them with their own funded key in
 * StackBlitz or a local Node script.
 */
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { WorkerOperator, NETWORKS, type NetworkId } from "lightnode-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "";
    const netParam = (url.searchParams.get("net") ?? "mainnet") as NetworkId;
    const net: NetworkId = netParam === "testnet" ? "testnet" : "mainnet";
    const network = NETWORKS[net];
    if (!network) return bad("unknown network");
    const publicClient = createPublicClient({ transport: http(network.rpc) });
    if (action === "config") {
      const op = new WorkerOperator(network, {
        publicClient: publicClient as unknown as ConstructorParameters<typeof WorkerOperator>[1]["publicClient"],
      });
      const cfg = await op.config();
      // Coerce bigints to strings for safe JSON.
      return NextResponse.json({
        action: "config",
        net,
        config: {
          minStakeLcai: cfg.minStakeLcai,
          completionTimeoutSec: cfg.completionTimeoutSec,
          ackTimeoutSec: cfg.ackTimeoutSec,
          resolutionTimeoutSec: cfg.resolutionTimeoutSec,
          disputeWindowSec: cfg.disputeWindowSec,
          slashBps: cfg.slashBps,
          feeBps: cfg.feeBps,
          suspensionThreshold: cfg.suspensionThreshold,
          suspensionCooldownSec: cfg.suspensionCooldownSec,
        },
      });
    }
    if (action === "status") {
      const worker = url.searchParams.get("worker") ?? "";
      if (!/^0x[0-9a-fA-F]{40}$/.test(worker)) return bad("worker: pass a valid 0x address");
      const op = new WorkerOperator(network, {
        publicClient: publicClient as unknown as ConstructorParameters<typeof WorkerOperator>[1]["publicClient"],
        workerAddress: worker as `0x${string}`,
      });
      const st = await op.status();
      return NextResponse.json({ action: "status", net, worker, status: st });
    }
    return bad("unknown action - try 'config' or 'status'");
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message?.split("\n")[0] ?? "fetch failed" },
      { status: 500 },
    );
  }
}
