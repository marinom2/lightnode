import { NextRequest, NextResponse } from "next/server";
import { fetchRecentJobs, fetchModels } from "@/lib/subgraph";
import { fromWei } from "@/lib/utils";
import type { NetworkId } from "@/lib/network";

export const dynamic = "force-dynamic";

/**
 * Recent network jobs for the live activity stream on /network - the "a lot is
 * happening here" ticker. Joins each job's model_id to a human model name (so the
 * UI doesn't show keccak hashes) and converts worker_share to LCAI. Read-only,
 * short CDN cache; the page polls it on a fast interval.
 */
export async function GET(req: NextRequest) {
  const net = (req.nextUrl.searchParams.get("net") as NetworkId) || "mainnet";
  try {
    const [jobs, models] = await Promise.all([fetchRecentJobs(net, 40), fetchModels(net)]);
    const nameById = new Map(models.map((m) => [m.id.toLowerCase(), m.name]));
    const rows = jobs.map((j) => ({
      id: j.id,
      state: j.state,
      model: j.model_id ? (nameById.get(j.model_id.toLowerCase()) ?? null) : null,
      worker: j.worker ?? null,
      shareLcai: fromWei(j.worker_share),
      submittedAt: j.submitted_at ?? 0,
    }));
    return NextResponse.json(
      { ok: true, jobs: rows },
      { headers: { "Cache-Control": "public, s-maxage=8, stale-while-revalidate=30" } },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
