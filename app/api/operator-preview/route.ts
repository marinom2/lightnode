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
import { WorkerOperator, NETWORKS, LightNode, type NetworkId } from "lightnode-sdk";

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
    // The SDK's WorkerOperator constructor requires a workerAddress or
    // walletClient even when the call doesn't need one (eg. config). Pass
    // a sentinel address for config-only reads.
    const SENTINEL: `0x${string}` = "0x0000000000000000000000000000000000000001";
    if (action === "config") {
      const op = new WorkerOperator(network, {
        publicClient: publicClient as unknown as ConstructorParameters<typeof WorkerOperator>[1]["publicClient"],
        workerAddress: SENTINEL,
      });
      const cfg = await op.config();
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
      // Pull spendable native balance in parallel - this is the LCAI the
      // visitor sees in their wallet after deregister returns the stake.
      // Without this, a deregistered worker looks empty even when it holds
      // its returned stake.
      const [st, walletWei] = await Promise.all([
        op.status(),
        publicClient.getBalance({ address: worker as `0x${string}` }),
      ]);
      return NextResponse.json({
        action: "status",
        net,
        worker,
        status: {
          address: st.address,
          registered: st.registered,
          stakeLcai: st.stakeLcai,
          headroomLcai: st.headroomLcai,
          belowFloor: st.belowFloor,
          claimableLcai: st.claimableLcai,
          walletBalanceLcai: Number(walletWei) / 1e18,
        },
      });
    }
    if (action === "job") {
      // Classify any job by id - the same surface the old Refund SDK card
      // exposed, now living under Worker Operator since both speak to the
      // job lifecycle.
      const jobIdRaw = url.searchParams.get("jobId") ?? "";
      if (!/^\d+$/.test(jobIdRaw)) return bad("jobId: pass a positive integer id");
      const ln = new LightNode(network);
      const status = await ln.getJobStatus(jobIdRaw);
      return NextResponse.json({ action: "job", net, jobId: jobIdRaw, status });
    }
    return bad("unknown action - try 'config', 'status', or 'job'");
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message?.split("\n")[0] ?? "fetch failed" },
      { status: 500 },
    );
  }
}
