import { NextRequest, NextResponse } from "next/server";
import { LightNode } from "lightnode-sdk";
import type { NetworkId } from "@/lib/network";

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
  const net = (req.nextUrl.searchParams.get("net") as NetworkId) || "mainnet";
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
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
