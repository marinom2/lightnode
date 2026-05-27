import { NextResponse } from "next/server";

// Current server build. The client compares this against its baked-in
// NEXT_PUBLIC_BUILD_ID; a mismatch means a newer deploy is live, so the
// (possibly cached) desktop UI self-reloads. Always no-store.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { build: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    { headers: { "Cache-Control": "no-store, must-revalidate" } },
  );
}
