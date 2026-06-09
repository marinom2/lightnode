/**
 * Protocol fee-revenue + FeePool/Treasury flow (holder / analyst view).
 * Reconstructs network protocol revenue from the settled-job sample and the live
 * fee split, and reads the FeePool + Treasury native balances on-chain. Nothing
 * on LightChain's side reports this.
 *
 *   GET /api/fee-flow?net=mainnet|testnet
 */
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { WorkerOperator, NETWORKS } from "lightnode-sdk";
import { fetchRecentJobs, fetchModels } from "@/lib/subgraph";
import { aggregateFeeRevenue } from "@/lib/analytics";
import type { NetworkId } from "@/lib/network";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SENTINEL: `0x${string}` = "0x0000000000000000000000000000000000000001";

export async function GET(req: NextRequest) {
  const net = (req.nextUrl.searchParams.get("net") as NetworkId) || "mainnet";
  const cfg = NETWORKS[net];
  if (!cfg) return NextResponse.json({ ok: false, error: "unknown network" }, { status: 400 });
  try {
    const publicClient = createPublicClient({ transport: http(cfg.rpc) });
    const op = new WorkerOperator(net, {
      publicClient: publicClient as unknown as ConstructorParameters<typeof WorkerOperator>[1]["publicClient"],
      workerAddress: SENTINEL,
    });
    const [jobs, models, config, feePoolWei, treasuryWei] = await Promise.all([
      fetchRecentJobs(net, 1000),
      fetchModels(net),
      op.config().catch(() => null),
      cfg.feePool ? publicClient.getBalance({ address: cfg.feePool as `0x${string}` }).catch(() => null) : Promise.resolve(null),
      cfg.treasury ? publicClient.getBalance({ address: cfg.treasury as `0x${string}` }).catch(() => null) : Promise.resolve(null),
    ]);
    const feeBps = config?.feeBps ?? { worker: 8000, protocol: 1500, feePool: 500 };
    const revenue = aggregateFeeRevenue(jobs, models, feeBps, Math.floor(Date.now() / 1000));
    return NextResponse.json({
      ok: true,
      net,
      feeBps,
      revenue,
      feePoolLcai: feePoolWei != null ? Number(feePoolWei) / 1e18 : null,
      treasuryLcai: treasuryWei != null ? Number(treasuryWei) / 1e18 : null,
      sampled: jobs.length,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
