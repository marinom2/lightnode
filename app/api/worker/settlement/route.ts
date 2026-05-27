import { NextRequest, NextResponse } from "next/server";
import { encodeFunctionData } from "viem";
import { fetchWorkerJobs } from "@/lib/subgraph";
import { NETWORKS, type NetworkId } from "@/lib/network";

export const dynamic = "force-dynamic";

// A completed job is held in a release/dispute window before it settles. On-chain
// `releaseJob` reverts with ReleaseNotReady(jobId, releaseAt, now) = 0x98f5b6c5
// until the window passes. We simulate it per job to read each job's claimable
// time, so the UI can show "X jobs settling, claimable in ~Yh" instead of a
// silent hold.
const RELEASE_NOT_READY = "0x98f5b6c5";
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
  const net = (req.nextUrl.searchParams.get("net") as NetworkId) || "mainnet";
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
        if (errData && errData.toLowerCase().startsWith(RELEASE_NOT_READY)) {
          const releaseAt = Number(BigInt("0x" + errData.slice(74, 138))); // 2nd 32-byte word
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
      perJobLcai: 0.016,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
