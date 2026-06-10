/**
 * Bridge balances for one address on both sides of the LCAI Warp Route:
 * LCAI ERC-20 on Ethereum + native LCAI on LightChain. Read-only; one server
 * call so the bridge card can show real local + remote balances without the
 * browser juggling two chains.
 *
 *   GET /api/bridge-balances?address=0x...
 */
import { NextResponse, type NextRequest } from "next/server";
import { createPublicClient, http, isAddress } from "viem";
import { BRIDGE_ROUTE, ERC20_ABI } from "lightnode-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "").trim();
  if (!isAddress(address)) {
    return NextResponse.json({ ok: false, error: "pass a valid 0x address" }, { status: 400 });
  }
  const eth = BRIDGE_ROUTE.ethereum;
  const lc = BRIDGE_ROUTE["lightchain-mainnet"];
  const ethClient = createPublicClient({ transport: http(eth.rpc) });
  const lcClient = createPublicClient({ transport: http(lc.rpc) });
  const [ethWei, lcWei] = await Promise.all([
    eth.underlying
      ? ethClient
          .readContract({ address: eth.underlying, abi: ERC20_ABI, functionName: "balanceOf", args: [address as `0x${string}`] })
          .catch(() => 0n)
      : Promise.resolve(0n),
    lcClient.getBalance({ address: address as `0x${string}` }).catch(() => 0n),
  ]);
  return NextResponse.json({
    ok: true,
    address,
    ethereumLcai: Number(ethWei as bigint) / 1e18,
    lightchainLcai: Number(lcWei) / 1e18,
  });
}
