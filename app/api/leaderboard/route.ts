import { NextRequest, NextResponse } from "next/server";
import { fetchWorkers, fetchModels, summarize, isLive } from "@/lib/subgraph";
import { fromWei } from "@/lib/utils";
import { parseNet } from "@/lib/api-validate";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const net = parseNet(req.nextUrl.searchParams.get("net"));
  if (!net) return NextResponse.json({ ok: false, error: "invalid net" }, { status: 400 });
  try {
    const [workers, models] = await Promise.all([fetchWorkers(net), fetchModels(net)]);
    const stats = summarize(workers, models);

    const ranked = workers
      .map((w) => ({
        id: w.id,
        status: w.status,
        live: isLive(w),
        jobs_completed: Number(w.jobs_completed ?? 0),
        earnedLcai: fromWei(w.total_earned),
        last_seen_at: w.last_seen_at ?? 0,
      }))
      .sort((a, b) => b.jobs_completed - a.jobs_completed || b.earnedLcai - a.earnedLcai)
      .slice(0, 50);

    return NextResponse.json(
      { ok: true, stats, workers: ranked },
      { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60" } },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
