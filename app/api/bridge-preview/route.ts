/**
 * Bridge "Run preview" endpoint - parameterized version of /api/bridge-quote.
 * Used by the BridgeRecipe widget on /build/sdks to give the visitor a real,
 * CLI-runner-style JSON response when they click Run.
 *
 *   POST /api/bridge-preview
 *   Body: { amount: string, direction: "eth-to-lc" | "lc-to-eth", recipient?: string }
 *
 * Returns: a structured "this is what the transaction WOULD look like" object:
 *   - the IGP fee quote (always 0 LCAI for our current pre-paid IGP setup)
 *   - the route addresses being used
 *   - amount in human + wei
 *   - the projected transferRemote calldata shape (call params, not encoded
 *     bytes - the bytes are deterministic from these inputs)
 *   - estimated source-chain gas (the only real cost the visitor pays)
 *   - estimated relay window
 *
 * The endpoint does NOT submit any transaction. The visitor would do that
 * themselves with the snippet shown below the Run button.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createPublicClient, http, parseEther, isAddress } from "viem";
import { BRIDGE_ROUTE, quoteBridgeFee } from "lightnode-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ETH_RPC = process.env.LIGHTNODE_ETH_RPC ?? "https://ethereum-rpc.publicnode.com";

type MinimalPublicClient = Parameters<typeof quoteBridgeFee>[0];

export async function POST(req: NextRequest) {
  let body: { amount?: string; direction?: "eth-to-lc" | "lc-to-eth"; recipient?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const direction = body.direction === "lc-to-eth" ? "lc-to-eth" : "eth-to-lc";
  const amountStr = (body.amount ?? "").trim() || "100";
  const recipientInput = (body.recipient ?? "").trim();
  const recipient = recipientInput && isAddress(recipientInput) ? recipientInput : null;

  let amountWei: bigint;
  try {
    amountWei = parseEther(amountStr);
    if (amountWei <= 0n) throw new Error("amount must be > 0");
  } catch {
    return NextResponse.json({ error: `amount '${amountStr}' is not a valid decimal LCAI amount` }, { status: 400 });
  }

  const from = direction === "eth-to-lc" ? "ethereum" : "lightchain-mainnet";
  const to = direction === "eth-to-lc" ? "lightchain-mainnet" : "ethereum";
  const sourceRpc = direction === "eth-to-lc" ? ETH_RPC : BRIDGE_ROUTE["lightchain-mainnet"].rpc;

  let feeWei: string | null = null;
  let feeError: string | null = null;
  try {
    const pub = createPublicClient({ transport: http(sourceRpc) }) as unknown as MinimalPublicClient;
    const wei = await quoteBridgeFee(pub, from, to);
    feeWei = wei.toString();
  } catch (e) {
    feeError = (e as Error).message?.split("\n")[0] ?? "fee quote failed";
  }

  const sourceUnit = direction === "eth-to-lc" ? "ETH" : "LCAI";
  const arrivesUnit = direction === "eth-to-lc" ? "native LCAI on LightChain (chain 9200)" : "LCAI ERC-20 on Ethereum mainnet";
  const estRelayMinutes = "30 to 60";
  // Hyperlane source-side gas for transferRemote on this Warp route - a generous range
  // covering Ethereum priority fees (eth->lc) and LightChain's tiny gas (lc->eth).
  const estSourceGas = direction === "eth-to-lc" ? "approx 0.50 to 2 USD in ETH" : "less than 0.01 LCAI";

  return NextResponse.json({
    ok: true,
    direction,
    amountLcai: amountStr,
    amountWei: amountWei.toString(),
    igpFee: feeError
      ? { ok: false, error: feeError }
      : { ok: true, wei: feeWei, [sourceUnit === "ETH" ? "eth" : "lcai"]: feeWei != null ? Number(feeWei) / 1e18 : null, note: "Pre-paid IGP - you pay 0 here. Source-chain gas below is the only cost." },
    estimatedSourceGas: estSourceGas,
    estimatedRelayMinutes: estRelayMinutes,
    arrives: arrivesUnit,
    route: {
      from: { chain: from, ...BRIDGE_ROUTE[from] },
      to: { chain: to, ...BRIDGE_ROUTE[to] },
    },
    projectedCall: {
      contract: BRIDGE_ROUTE[from].router,
      method: "transferRemote(uint32 destination, bytes32 recipient, uint256 amount)",
      destinationDomain: BRIDGE_ROUTE[to].hyperlaneDomain,
      amount: amountWei.toString(),
      recipientGiven: recipient,
      recipientHint: recipient ? null : "Pass a destination address as the 'recipient' input above for a complete preview.",
      value: feeWei ?? "0",
    },
    note: "This is a dry-run preview only. To execute, run the snippet below in your project (it signs with your own wallet).",
    fetchedAt: Date.now(),
  });
}
