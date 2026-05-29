import { NextRequest, NextResponse } from "next/server";
import { fetchRecentJobs, fetchModels } from "@/lib/subgraph";
import { aggregateModelStats, aggregateWorkerStats, networkAnalytics } from "@/lib/analytics";
import type { NetworkId } from "@/lib/network";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const net = (req.nextUrl.searchParams.get("net") as NetworkId) || "mainnet";
  try {
    const [jobs, models] = await Promise.all([fetchRecentJobs(net, 1000), fetchModels(net)]);
    const now = Math.floor(Date.now() / 1000);
    const stats = aggregateModelStats(jobs, models, now);
    const workers = aggregateWorkerStats(jobs, now, 25);
    return NextResponse.json({ ok: true, stats, workers, summary: networkAnalytics(stats), sampled: jobs.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
