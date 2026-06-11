import { NextRequest, NextResponse } from "next/server";
import { fetchModels } from "@/lib/subgraph";
import { parseNet } from "@/lib/api-validate";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const net = parseNet(req.nextUrl.searchParams.get("net"));
  if (!net) return NextResponse.json({ ok: false, error: "invalid net" }, { status: 400 });
  try {
    const models = await fetchModels(net);
    return NextResponse.json(
      { ok: true, models },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
