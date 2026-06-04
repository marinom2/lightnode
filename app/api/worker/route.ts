import { NextRequest, NextResponse } from "next/server";
import { LightNode } from "lightnode-sdk";
import { fetchWorker, fetchWorkerJobs, fetchWorkerModels, isLive } from "@/lib/subgraph";
import { fetchOnchainRegistered, fetchOnchainEligibleModels } from "@/lib/onchain-status";
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
    // liveness: read-only SDK diagnostic that flags a staked-but-offline worker
    // with jobs stuck past their deadline (the silent pre-slash failure). It reads
    // live protocol config from the chain, so it never blocks the response - null
    // on any error and the UI simply omits the banner.
    const [jobs, models, liveness] = await Promise.all([
      fetchWorkerJobs(net, address, 50),
      fetchWorkerModels(net, address),
      new LightNode(net).getWorkerLiveness(address).catch(() => null),
    ]);
    // Reconcile the subgraph's served-models list (which goes stale after a
    // deregister/re-register - it never indexes removals) against on-chain
    // isEligible. Tag each model with onchainEligible so the UI can hide/flag the
    // ones the chain says the worker no longer actually serves.
    const eligible = await fetchOnchainEligibleModels(net, address, models.map((m) => m.modelId)).catch(() => null);
    const reconciledModels = eligible
      ? models.map((m) => ({ ...m, onchainEligible: eligible.get(m.modelId.toLowerCase()) ?? null }))
      : models.map((m) => ({ ...m, onchainEligible: null }));
    return NextResponse.json({ ok: true, worker, live: isLive(worker), jobs, models: reconciledModels, onchainRegistered, liveness });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
