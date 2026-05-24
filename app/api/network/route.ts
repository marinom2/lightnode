import { NextRequest, NextResponse } from "next/server";
import { fetchWorkers, fetchModels, summarize, isLive } from "@/lib/subgraph";
import type { NetworkId } from "@/lib/network";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const net = (req.nextUrl.searchParams.get("net") as NetworkId) || "mainnet";
  try {
    const [workers, models] = await Promise.all([fetchWorkers(net), fetchModels(net)]);
    const stats = summarize(workers, models);

    // throughput proxy: lifetime jobs spread across currently-live workers,
    // used only to seed a conservative default in the reward estimator.
    const liveCount = Math.max(stats.live, 1);
    const avgJobsPerLiveWorker = stats.jobsCompleted / liveCount;

    return NextResponse.json(
      {
        ok: true,
        stats,
        avgJobsPerLiveWorker,
        models: models.map((m) => ({ name: m.name, fee: m.fee, max_output_tokens: m.max_output_tokens })),
        liveWorkers: workers
          .filter(isLive)
          .slice(0, 8)
          .map((w) => ({ id: w.id, jobs_completed: w.jobs_completed ?? 0, total_earned: w.total_earned ?? "0" })),
      },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45" } },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
