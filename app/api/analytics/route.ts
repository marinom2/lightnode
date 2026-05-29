import { NextRequest, NextResponse } from "next/server";
import { fetchRecentJobs, fetchModels } from "@/lib/subgraph";
import { aggregateModelStats, networkAnalytics } from "@/lib/analytics";
import type { NetworkId } from "@/lib/network";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const net = (req.nextUrl.searchParams.get("net") as NetworkId) || "mainnet";
  try {
    const [jobs, models] = await Promise.all([fetchRecentJobs(net, 1000), fetchModels(net)]);
    const stats = aggregateModelStats(jobs, models, Math.floor(Date.now() / 1000));
    return NextResponse.json({ ok: true, stats, summary: networkAnalytics(stats), sampled: jobs.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
