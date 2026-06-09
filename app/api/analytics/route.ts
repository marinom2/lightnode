import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { LightNode, WorkerOperator, NETWORKS } from "lightnode-sdk";
import { fetchRecentJobs, fetchModels } from "@/lib/subgraph";
import { aggregateModelStats, aggregateWorkerStats, networkAnalytics } from "@/lib/analytics";
import type { NetworkId } from "@/lib/network";

export const dynamic = "force-dynamic";

const SENTINEL: `0x${string}` = "0x0000000000000000000000000000000000000001";

interface RiskWorker {
  address: string;
  total: number;
  completionRate: number | null;
  p50: number | null;
  p95: number | null;
  earnings: number;
  stuck: number;
  // Risk enrichment (only present with ?risk=1).
  stakeLcai?: number | null;
  lifetimeTimeouts?: number | null;
  status?: string | null;
  belowFloor?: boolean;
  suspensionRisk?: boolean;
  slashExposureLcai?: number;
}

export async function GET(req: NextRequest) {
  const net = (req.nextUrl.searchParams.get("net") as NetworkId) || "mainnet";
  // Risk enrichment is opt-in (the reliability/risk leaderboard) so the cheaper
  // model-analytics consumers don't pay for the extra worker + config reads.
  const wantRisk = req.nextUrl.searchParams.get("risk") === "1";
  try {
    const [jobs, models] = await Promise.all([fetchRecentJobs(net, 1000), fetchModels(net)]);
    const now = Math.floor(Date.now() / 1000);
    const stats = aggregateModelStats(jobs, models, now);
    const baseWorkers = aggregateWorkerStats(jobs, now, wantRisk ? 50 : 25);

    if (!wantRisk) {
      return NextResponse.json({ ok: true, stats, workers: baseWorkers, summary: networkAnalytics(stats), sampled: jobs.length });
    }

    // Join per-worker stake + lifetime timeouts (subgraph) and the live protocol
    // thresholds (AIConfig) - 2 extra calls total, NOT one per worker.
    const cfg = NETWORKS[net];
    const ln = new LightNode(net);
    const publicClient = createPublicClient({ transport: http(cfg.rpc) });
    const op = new WorkerOperator(net, {
      publicClient: publicClient as unknown as ConstructorParameters<typeof WorkerOperator>[1]["publicClient"],
      workerAddress: SENTINEL,
    });
    const [allWorkers, config] = await Promise.all([ln.getWorkers(200).catch(() => []), op.config().catch(() => null)]);
    const byAddr = new Map(allWorkers.map((w) => [w.id.toLowerCase(), w]));
    const minStakeLcai = config?.minStakeLcai ?? cfg.minStakeLcai;
    const completionBps = config?.slashBps.completionTimeout ?? null;
    const maxBps = config?.slashBps.max ?? null;
    const suspensionThreshold = config?.suspensionThreshold ?? null;

    const workers: RiskWorker[] = baseWorkers.map((ws) => {
      const w = byAddr.get(ws.address.toLowerCase());
      const stakeLcai = w?.stake ? Number(BigInt(w.stake)) / 1e18 : null;
      const lifetimeTimeouts = w?.jobs_timed_out ?? null;
      const belowFloor = stakeLcai != null ? stakeLcai < minStakeLcai : false;
      const suspensionRisk =
        lifetimeTimeouts != null && suspensionThreshold != null && suspensionThreshold > 0
          ? lifetimeTimeouts >= suspensionThreshold
          : false;
      let slashExposureLcai = 0;
      if (stakeLcai != null && completionBps != null && ws.stuck > 0) {
        const rawBps = ws.stuck * completionBps;
        const cappedBps = maxBps != null ? Math.min(rawBps, maxBps) : rawBps;
        slashExposureLcai = (stakeLcai * cappedBps) / 10000;
      }
      return {
        address: ws.address,
        total: ws.total,
        completionRate: ws.completionRate,
        p50: ws.p50,
        p95: ws.p95,
        earnings: ws.earnings,
        stuck: ws.stuck,
        stakeLcai,
        lifetimeTimeouts,
        status: w?.status ?? null,
        belowFloor,
        suspensionRisk,
        slashExposureLcai,
      };
    });

    return NextResponse.json({
      ok: true,
      stats,
      workers,
      summary: networkAnalytics(stats),
      sampled: jobs.length,
      thresholds: { minStakeLcai, suspensionThreshold, completionBps, maxBps },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
