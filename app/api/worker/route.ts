import { NextRequest, NextResponse } from "next/server";
import { fetchWorker, fetchWorkerJobs, fetchWorkerModels, isLive } from "@/lib/subgraph";
import { fetchOnchainRegistered } from "@/lib/onchain-status";
import type { NetworkId } from "@/lib/network";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const net = (req.nextUrl.searchParams.get("net") as NetworkId) || "mainnet";
  const address = req.nextUrl.searchParams.get("address") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "invalid address" }, { status: 400 });
  }
  try {
    // Read the index AND the chain in parallel. onchainRegistered is the truth we
    // use to correct the index's stale "deregistered" - it never blocks or fails
    // the response (returns null on any error, so the UI falls back to the index).
    const [worker, onchainRegistered] = await Promise.all([
      fetchWorker(net, address),
      fetchOnchainRegistered(net, address).catch(() => null),
    ]);
    if (!worker) return NextResponse.json({ ok: true, worker: null, jobs: [], onchainRegistered });
    // first=50 so Operations can see all completed (unreleased) jobs to settle.
    const [jobs, models] = await Promise.all([fetchWorkerJobs(net, address, 50), fetchWorkerModels(net, address)]);
    return NextResponse.json({ ok: true, worker, live: isLive(worker), jobs, models, onchainRegistered });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
