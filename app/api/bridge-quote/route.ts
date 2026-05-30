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

async function safeQuote(
  client: MinimalPublicClient,
  from: "ethereum" | "lightchain-mainnet",
  to: "ethereum" | "lightchain-mainnet",
): Promise<{ ok: true; wei: string } | { ok: false; error: string }> {
  try {
    const wei = await quoteBridgeFee(client, from, to);
    return { ok: true, wei: wei.toString() };
  } catch (e) {
    const msg = (e as Error).message ?? "unknown";
    return { ok: false, error: msg.split("\n")[0] };
  }
}

export async function GET() {
  try {
    const ethPub = createPublicClient({ transport: http(ETH_RPC) }) as unknown as MinimalPublicClient;
    const lcPub = createPublicClient({ transport: http(BRIDGE_ROUTE["lightchain-mainnet"].rpc) }) as unknown as MinimalPublicClient;
    const [ethToLc, lcToEth] = await Promise.all([
      safeQuote(ethPub, "ethereum", "lightchain-mainnet"),
      safeQuote(lcPub, "lightchain-mainnet", "ethereum"),
    ]);
    return NextResponse.json({
      ethereumToLightChain: ethToLc.ok
        ? { feeWei: ethToLc.wei, feeEth: Number(ethToLc.wei) / 1e18, ok: true }
        : { ok: false, error: ethToLc.error },
      lightChainToEthereum: lcToEth.ok
        ? { feeWei: lcToEth.wei, feeLcai: Number(lcToEth.wei) / 1e18, ok: true }
        : { ok: false, error: lcToEth.error },
      route: BRIDGE_ROUTE,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.split("\n")[0] ?? "fetch failed" }, { status: 500 });
  }
}
