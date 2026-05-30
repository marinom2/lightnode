/**
 * Live Hyperlane gas-payment quote for the LCAI bridge, both directions.
 * Used by the interactive Bridge card on /build.
 *
 *   GET /api/bridge-quote
 *
 * Returns:
 *   {
 *     ethereumToLightChain: { feeWei, feeEth },
 *     lightChainToEthereum: { feeWei, feeLcai },
 *     route: { ethereum: {...}, lightchain-mainnet: {...} },
 *     fetchedAt
 *   }
 */
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { BRIDGE_ROUTE, quoteBridgeFee } from "lightnode-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ETH_RPC = process.env.LIGHTNODE_ETH_RPC ?? "https://ethereum-rpc.publicnode.com";

type MinimalPublicClient = Parameters<typeof quoteBridgeFee>[0];

export async function GET() {
  try {
    const ethPub = createPublicClient({ transport: http(ETH_RPC) }) as unknown as MinimalPublicClient;
    const lcPub = createPublicClient({ transport: http(BRIDGE_ROUTE["lightchain-mainnet"].rpc) }) as unknown as MinimalPublicClient;
    const [ethToLc, lcToEth] = await Promise.all([
      quoteBridgeFee(ethPub, "ethereum", "lightchain-mainnet").catch(() => 0n),
      quoteBridgeFee(lcPub, "lightchain-mainnet", "ethereum").catch(() => 0n),
    ]);
    return NextResponse.json({
      ethereumToLightChain: { feeWei: ethToLc.toString(), feeEth: Number(ethToLc) / 1e18 },
      lightChainToEthereum: { feeWei: lcToEth.toString(), feeLcai: Number(lcToEth) / 1e18 },
      route: BRIDGE_ROUTE,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.split("\n")[0] ?? "fetch failed" }, { status: 500 });
  }
}
