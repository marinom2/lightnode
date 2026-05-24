import { NextRequest, NextResponse } from "next/server";
import { fetchWorker, isLive } from "@/lib/subgraph";
import type { NetworkId } from "@/lib/network";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const net = (req.nextUrl.searchParams.get("net") as NetworkId) || "mainnet";
  const address = req.nextUrl.searchParams.get("address") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "invalid address" }, { status: 400 });
  }
  try {
    const worker = await fetchWorker(net, address);
    if (!worker) return NextResponse.json({ ok: true, worker: null });
    return NextResponse.json({ ok: true, worker, live: isLive(worker) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
