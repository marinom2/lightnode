import { NextRequest, NextResponse } from "next/server";
import { encodeFunctionData } from "viem";
import { fetchWorkerJobs } from "@/lib/subgraph";
import { NETWORKS } from "@/lib/network";
import { parseNet } from "@/lib/api-validate";

export const dynamic = "force-dynamic";

// A completed job is held in a release/dispute window before it settles. On-chain
// `releaseJob` reverts with DisputeWindowNotElapsed(jobId, releaseAt, now) =
// 0x98f5b6c5 until the window passes (verified live; the args are jobId, the unix
// time it becomes releasable, and now). We simulate it per job to read each job's
// claimable time, so the UI can show "X jobs settling, claimable in ~Yh" instead
// of a silent hold.
const DISPUTE_WINDOW_NOT_ELAPSED = "0x98f5b6c5";
const releaseAbi = [
  { type: "function", name: "releaseJob", inputs: [{ type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
] as const;

async function ethCall(rpc: string, to: string, data: string): Promise<{ ok: boolean; errData?: string }> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    cache: "no-store",
  });
  const j = await res.json();
  if (j.error) return { ok: false, errData: typeof j.error.data === "string" ? j.error.data : j.error.data?.data };
  return { ok: true };
}

export async function GET(req: NextRequest) {
  const net = parseNet(req.nextUrl.searchParams.get("net"));
  if (!net) return NextResponse.json({ ok: false, error: "invalid net" }, { status: 400 });
  const address = req.nextUrl.searchParams.get("address") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "invalid address" }, { status: 400 });
  }
  const cfg = NETWORKS[net];
  try {
    const jobs = await fetchWorkerJobs(net, address, 50);
    const completed = jobs.filter((j) => /complet/i.test(j.state));
    const now = Math.floor(Date.now() / 1000);

    const results = await Promise.all(
      completed.map(async (job) => {
        const data = encodeFunctionData({ abi: releaseAbi, functionName: "releaseJob", args: [BigInt(job.id)] });
        const { ok, errData } = await ethCall(cfg.rpc, cfg.jobRegistry, data);
        if (ok) return { jobId: Number(job.id), ready: true, claimableAt: now };
        if (errData && errData.toLowerCase().startsWith(DISPUTE_WINDOW_NOT_ELAPSED)) {
          // Decode the 2nd 32-byte word (releaseAt). Guard against a malformed /
          // truncated revert blob: a bad slice makes BigInt throw or yields a
          // non-finite number, which would render a NaN ETA. Fail closed.
          let releaseAt = NaN;
          try {
            releaseAt = Number(BigInt("0x" + errData.slice(74, 138)));
          } catch {
            releaseAt = NaN;
          }
          if (!Number.isFinite(releaseAt) || releaseAt < 0) {
            return { jobId: Number(job.id), ready: false, claimableAt: 0 };
          }
          return { jobId: Number(job.id), ready: releaseAt <= now, claimableAt: releaseAt };
        }
        // Unknown revert (e.g. already disputed) - treat as not-ready, no ETA.
        return { jobId: Number(job.id), ready: false, claimableAt: 0 };
      }),
    );

    const ready = results.filter((r) => r.ready).length;
    const pendingTimes = results.filter((r) => !r.ready && r.claimableAt > now).map((r) => r.claimableAt);
    const nextClaimableAt = pendingTimes.length ? Math.min(...pendingTimes) : 0;
    const allClaimableAt = pendingTimes.length ? Math.max(...pendingTimes) : 0;

    return NextResponse.json({
      ok: true,
      total: completed.length,
      ready,
      waiting: completed.length - ready,
      nextClaimableAt,
      allClaimableAt,
      // Static estimate of the worker share per settled job, not read from
      // chain. Matches the value observed on released jobs on both networks
      // and the "approx" framing the Operations panel renders it with.
      perJobLcai: 0.016,
      estimate: true,
    });
  } catch (e) {
    // Keep the real error server-side; RPC/subgraph URLs must not reach clients.
    console.error("worker/settlement:", e);
    return NextResponse.json({ ok: false, error: "upstream unavailable" }, { status: 502 });
  }
}
