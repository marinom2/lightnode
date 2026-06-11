import { NextRequest, NextResponse } from "next/server";
import { LightNode } from "lightnode-sdk";
import { parseNet } from "@/lib/api-validate";

export const dynamic = "force-dynamic";

/**
 * Flat, grep-friendly alert summary for the keep-online watchdog. The watchdog
 * runs on a schedule even when the desktop app is CLOSED, so it can't run the SDK
 * itself - it curls this endpoint and parses a handful of fields with sed. All the
 * on-chain + analysis work (gas balance, stuck jobs, claimable, settle-now) is the
 * same tested getWorkerActions the dashboard uses, so the alert matches the UI.
 *
 *   GET /api/worker-alert?net=mainnet&address=0x...
 *   -> { ok, registered, outOfGas, gasLcai, stuck, claimableLcai, settleNow, activity }
 *
 * Fields are flat scalars (no nesting) on purpose, so a watchdog can extract each
 * with a single sed without jq.
 */
export async function GET(req: NextRequest) {
  const net = parseNet(req.nextUrl.searchParams.get("net"));
  if (!net) return NextResponse.json({ ok: false, error: "invalid net" }, { status: 400 });
  const address = req.nextUrl.searchParams.get("address") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "invalid address" }, { status: 400 });
  }
  try {
    const a = await new LightNode(net).getWorkerActions(address);
    return NextResponse.json(
      {
        ok: true,
        registered: a.registered,
        activity: a.liveness.activity,
        outOfGas: a.outOfGas,
        gasLcai: a.walletGasLcai,
        stuck: a.liveness.stuckJobs.length,
        slashRiskLcai: a.liveness.slashExposureLcai,
        claimableLcai: a.claimableLcai,
        settleNow: a.settlement.releasableNowCount,
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (e) {
    // Keep the real error server-side; RPC/subgraph URLs must not reach the
    // watchdog's logs or any other client.
    console.error("worker-alert:", e);
    return NextResponse.json({ ok: false, error: "upstream unavailable" }, { status: 502 });
  }
}
