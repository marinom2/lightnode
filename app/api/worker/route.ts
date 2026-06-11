import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { LightNode, WorkerOperator, type MinimalPublicClient } from "lightnode-sdk";
import { fetchWorker, fetchWorkerJobs, fetchWorkerModels, fetchModels, isLive } from "@/lib/subgraph";
import { fetchOnchainRegistered, fetchOnchainEligibleModels } from "@/lib/onchain-status";
import { NETWORKS, type NetworkId } from "@/lib/network";
import { parseNet } from "@/lib/api-validate";

/**
 * Read-only profitability for the worker's primary served model: worker fee per
 * job (its share of the model fee), gas per job, net, and a projection at the
 * worker's observed throughput. Best-effort - null on any error.
 */
async function computeProfitability(
  net: NetworkId,
  address: string,
  primaryModelId: string | undefined,
  jobsCompleted: number,
  createdAt: number | undefined,
) {
  if (!primaryModelId) return null;
  try {
    const registry = await fetchModels(net);
    const info = registry.find((r) => r.id.toLowerCase() === primaryModelId.toLowerCase());
    if (!info || !/^[0-9]+$/.test(String(info.fee))) return null; // need an integer-wei fee
    const pc = createPublicClient({ transport: http(NETWORKS[net].rpc) }) as unknown as MinimalPublicClient;
    const op = new WorkerOperator(net, { publicClient: pc, workerAddress: address as `0x${string}` });
    const days = createdAt ? Math.max(1, (Date.now() / 1000 - createdAt) / 86400) : 1;
    const jobsPerDay = jobsCompleted / days;
    const p = await op.profitability({ modelFeeWei: BigInt(info.fee), jobsPerDay });
    return { ...p, modelName: info.name, jobsPerDay: Math.round(jobsPerDay * 10) / 10 };
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const net = parseNet(req.nextUrl.searchParams.get("net"));
  if (!net) return NextResponse.json({ ok: false, error: "invalid net" }, { status: 400 });
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
    // actions: the SDK "action center" - claimable earnings, worker-wallet gas
    // (the outOfGas flag that explains silent settle/claim failures), settle-now
    // vs in-window jobs, the liveness / stuck-job picture, and a prioritized to-do
    // list. It reads live protocol config + balances from chain, so it never
    // blocks the response (null on any error and the UI degrades gracefully).
    // liveness is carried inside actions, so this is one composite read, not two.
    const [jobs, models, actions] = await Promise.all([
      fetchWorkerJobs(net, address, 50),
      fetchWorkerModels(net, address),
      new LightNode(net).getWorkerActions(address).catch(() => null),
    ]);
    const liveness = actions?.liveness ?? null;
    // Reconcile the subgraph's served-models list (which goes stale after a
    // deregister/re-register - it never indexes removals) against on-chain
    // isEligible. Tag each model with onchainEligible so the UI can hide/flag the
    // ones the chain says the worker no longer actually serves.
    const eligible = await fetchOnchainEligibleModels(net, address, models.map((m) => m.modelId)).catch(() => null);
    const reconciledModels = eligible
      ? models.map((m) => ({ ...m, onchainEligible: eligible.get(m.modelId.toLowerCase()) ?? null }))
      : models.map((m) => ({ ...m, onchainEligible: null }));
    const primary = reconciledModels.find((m) => m.onchainEligible) ?? reconciledModels[0];
    const profitability = await computeProfitability(net, address, primary?.modelId, worker.jobs_completed ?? 0, worker.created_at);
    return NextResponse.json({ ok: true, worker, live: isLive(worker), jobs, models: reconciledModels, onchainRegistered, liveness, actions, profitability });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
