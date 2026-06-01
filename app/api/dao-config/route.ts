/**
 * Read the live voting config of a Governor: voting delay (blocks),
 * voting period (blocks + approx seconds), proposal threshold (wei).
 *
 *   GET /api/dao-config?chain=ethereum|lightchain
 *
 * Used by the DAO stepper widget on /build/sdks/dao so the 'Read voting
 * config' option returns real on-chain values without the visitor needing
 * to wire a viem client.
 */
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { DAO, DAO_ADDRESSES } from "lightnode-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RPCS_BY_CHAIN: Record<"ethereum" | "lightchain", string[]> = {
  ethereum: process.env.LIGHTNODE_ETH_RPC
    ? [process.env.LIGHTNODE_ETH_RPC]
    : ["https://ethereum-rpc.publicnode.com", "https://eth.merkle.io", "https://rpc.ankr.com/eth", "https://eth.drpc.org"],
  lightchain: ["https://rpc.mainnet.lightchain.ai"],
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const chainParam = (url.searchParams.get("chain") ?? "ethereum") as "ethereum" | "lightchain";
    const chain = chainParam === "lightchain" ? "lightchain" : "ethereum";
    const errors: string[] = [];
    for (const rpc of RPCS_BY_CHAIN[chain]) {
      try {
        const publicClient = createPublicClient({ transport: http(rpc) });
        // viem's strict PublicClient union vs the SDK's structural Minimal
        // shape - same intentional boundary cast used by the existing
        // bridge endpoints.
        const dao = new DAO(publicClient as unknown as ConstructorParameters<typeof DAO>[0], chain);
        const cfg = await dao.config();
        return NextResponse.json({
          chain,
          addresses: DAO_ADDRESSES[chain],
          config: {
            votingDelayBlocks: cfg.votingDelayBlocks.toString(),
            votingPeriodBlocks: cfg.votingPeriodBlocks.toString(),
            proposalThresholdWei: cfg.proposalThresholdWei.toString(),
            votingPeriodSecs: cfg.votingPeriodSecs,
          },
          fetchedAt: Date.now(),
        });
      } catch (e) {
        errors.push(`${rpc}: ${(e as Error).message?.split("\n")[0] ?? "fetch failed"}`);
      }
    }
    return NextResponse.json(
      { error: `Could not read Governor config on ${chain}. Tried ${RPCS_BY_CHAIN[chain].length} RPC(s).`, details: errors },
      { status: 502 },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.split("\n")[0] ?? "fetch failed" }, { status: 500 });
  }
}
