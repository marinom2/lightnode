/**
 * The on-chain inference budget: how many seconds a worker gets, from the moment
 * it acknowledges a job to the protocol deadline, to produce its answer. Miss it
 * and the job times out (slash risk), so the Speed test compares a machine's
 * worst-case inference time against this number.
 *
 * The JobRegistry stores an absolute deadline per job; `deadline - acknowledged`
 * is the real compute window (a steady 120s on both nets today). We read it from
 * a recent settled job rather than hardcoding it, so the check stays correct if
 * LightChain ever retunes the protocol. Best-effort: falls back to 120s.
 */
import { createPublicClient, http } from "viem";
import { NETWORKS, type NetworkId } from "@/lib/network";

export const DEFAULT_BUDGET_SEC = 120;

// getJob(uint256) - the returned struct's word 7 is acknowledgedAt and word 9 is
// the deadline (both unix seconds). Verified against live testnet jobs.
const GET_JOB_SELECTOR = "0xbf22c457";
const WORD_ACKNOWLEDGED = 7;
const WORD_DEADLINE = 9;

async function latestSettledJobId(subgraph: string): Promise<number | null> {
  const query = `{ jobs(first:1, orderBy: id, orderDirection: desc, where:{state:"Released"}){ id } }`;
  const r = await fetch(subgraph, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const id = j?.data?.jobs?.[0]?.id;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

function wordAt(hex: string, index: number): bigint {
  const start = index * 64;
  return BigInt("0x" + hex.slice(start, start + 64));
}

export async function fetchInferenceBudgetSec(net: NetworkId): Promise<number> {
  try {
    const cfg = NETWORKS[net];
    const jobId = await latestSettledJobId(cfg.subgraph);
    if (jobId === null) return DEFAULT_BUDGET_SEC;

    const client = createPublicClient({ transport: http(cfg.rpc) });
    const data = `${GET_JOB_SELECTOR}${jobId.toString(16).padStart(64, "0")}` as `0x${string}`;
    const res = await client.call({ to: cfg.jobRegistry as `0x${string}`, data });
    const hex = (res.data ?? "0x").slice(2);
    if (hex.length < (WORD_DEADLINE + 1) * 64) return DEFAULT_BUDGET_SEC;

    const budget = Number(wordAt(hex, WORD_DEADLINE) - wordAt(hex, WORD_ACKNOWLEDGED));
    // Sanity-gate the decoded value so a struct-layout change can't feed the UI
    // a nonsense deadline; anything outside 30s..600s falls back to the default.
    if (budget >= 30 && budget <= 600) return budget;
    return DEFAULT_BUDGET_SEC;
  } catch {
    return DEFAULT_BUDGET_SEC;
  }
}
