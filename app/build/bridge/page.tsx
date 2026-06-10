"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ChevronDown, ArrowLeftRight, CreditCard, Loader2, ExternalLink, CheckCircle2, AlertTriangle } from "lucide-react";
import { useAccount, useWalletClient, useSwitchChain, useChainId } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { createPublicClient, http, parseEther } from "viem";
import { BRIDGE_ROUTE, HYPERLANE_ROUTER_ABI, ERC20_ABI, addressToBytes32 } from "lightnode-sdk";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { humanizeError } from "@/lib/humanize-error";
import { shortAddr, cn } from "@/lib/utils";

type Dir = "eth-to-lc" | "lc-to-eth";
type ChainKey = "ethereum" | "lightchain";

interface ChainBrand {
  key: ChainKey;
  label: string;
  sub: string;
  token: string;
  badge: string;
}

const CHAIN_BRAND: Record<ChainKey, ChainBrand> = {
  ethereum: { key: "ethereum", label: "Ethereum", sub: "LCAI ERC-20", token: "/logos/lcai.png", badge: "/logos/eth.svg" },
  lightchain: { key: "lightchain", label: "LightchainAI", sub: "native LCAI", token: "/logos/lcai.png", badge: "/logos/lcai.png" },
};
const ENDPOINTS: Record<Dir, [ChainKey, ChainKey]> = {
  "eth-to-lc": ["ethereum", "lightchain"],
  "lc-to-eth": ["lightchain", "ethereum"],
};
const routeOf = (k: ChainKey) => (k === "ethereum" ? BRIDGE_ROUTE.ethereum : BRIDGE_ROUTE["lightchain-mainnet"]);

function TokenChainIcon({ brand, size = 36 }: { brand: ChainBrand; size?: number }) {
  const badge = Math.max(14, Math.round(size * 0.45));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-[#14152C]">
        <Image src={brand.token} alt="LCAI" width={size} height={size} className="h-full w-full object-contain p-0.5" />
      </span>
      <span
        className="absolute -bottom-0.5 -right-0.5 grid place-items-center overflow-hidden rounded-full bg-[#1A1B38] ring-2 ring-[#070710]"
        style={{ width: badge, height: badge }}
      >
        <Image src={brand.badge} alt={brand.label} width={badge} height={badge} className="h-full w-full object-contain" />
      </span>
    </div>
  );
}

function TokenButton({ brand, reverse = false }: { brand: ChainBrand; reverse?: boolean }) {
  return (
    <div className={cn("flex w-full items-center rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2.5 sm:px-4", reverse && "flex-row-reverse")}>
      <div className={cn("flex items-center gap-3", reverse && "flex-row-reverse")}>
        <TokenChainIcon brand={brand} size={36} />
        <div className={cn("flex flex-col gap-0.5", reverse ? "items-end" : "items-start")}>
          <span className="text-sm font-semibold leading-tight text-content-primary sm:text-base">LCAI</span>
          <span className="text-[10px] font-normal leading-tight text-content-soft sm:text-xs">{brand.label}</span>
        </div>
      </div>
      <ChevronDown className={cn("size-4 shrink-0 text-content-soft", reverse ? "mr-auto" : "ml-auto")} />
    </div>
  );
}

function bridgeSnippet(dir: Dir, amount: string, recipient: string): string {
  const amt = amount.trim() || "100";
  const recip = recipient.trim() ? `"${recipient.trim()}"` : "account.address";
  if (dir === "eth-to-lc") {
    return `import { createWalletClient, custom, parseEther } from "viem";
import { quoteBridgeFee, approveBridge, bridgeTransfer } from "lightnode-sdk";

// Signer on Ethereum mainnet (LCAI is an ERC-20 there):
const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
const fee = await quoteBridgeFee(pub, "ethereum", "lightchain-mainnet");

await approveBridge(wallet, parseEther("${amt}"));      // ERC-20 approve, once
await bridgeTransfer(wallet, {
  from: "ethereum", to: "lightchain-mainnet",
  amount: parseEther("${amt}"), recipient: ${recip}, fee,   // arrives NATIVE on chain 9200
});`;
  }
  return `import { createWalletClient, custom, parseEther } from "viem";
import { quoteBridgeFee, bridgeTransfer } from "lightnode-sdk";

// Signer on LightChain mainnet - native LCAI, no approve:
const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
const fee = await quoteBridgeFee(pub, "lightchain-mainnet", "ethereum");

await bridgeTransfer(wallet, {
  from: "lightchain-mainnet", to: "ethereum",
  amount: parseEther("${amt}"), recipient: ${recip}, fee,   // value = amount + fee
});`;
}

interface Balances {
  ethereumLcai: number;
  lightchainLcai: number;
}
interface Fee {
  estimatedSourceGas: string;
}

const bal4 = (n: number | null) => (n == null ? "0.00" : n.toFixed(4));

export default function BridgePanel() {
  const { address, isConnected } = useAccount();
  const { open } = useAppKit();
  const [dir, setDir] = useState<Dir>("eth-to-lc");
  const [amount, setAmount] = useState("");
  const [bal, setBal] = useState<Balances | null>(null);
  const [fee, setFee] = useState<Fee | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);

  const [fromKey, toKey] = ENDPOINTS[dir];
  const fromBrand = CHAIN_BRAND[fromKey];
  const toBrand = CHAIN_BRAND[toKey];
  const originBalance = bal ? (fromKey === "ethereum" ? bal.ethereumLcai : bal.lightchainLcai) : null;
  const remoteBalance = bal ? (toKey === "ethereum" ? bal.ethereumLcai : bal.lightchainLcai) : null;

  const flip = () => {
    setDir((d) => (d === "eth-to-lc" ? "lc-to-eth" : "eth-to-lc"));
    setAmount("");
  };

  const loadBalances = useCallback(() => {
    if (!isConnected || !address) {
      setBal(null);
      return;
    }
    fetch(`/api/bridge-balances?address=${address}`)
      .then((r) => r.json())
      .then((j: Balances & { ok?: boolean }) => j.ok && setBal(j))
      .catch(() => {});
  }, [isConnected, address]);
  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  const loadFee = useCallback(async () => {
    const amt = amount.trim();
    if (!amt || Number(amt) <= 0) {
      setFee(null);
      return;
    }
    setFeeLoading(true);
    try {
      const res = await fetch("/api/bridge-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: dir, amount: amt }),
      });
      const d = (await res.json()) as Fee & { ok?: boolean };
      if (d.ok) setFee(d);
    } catch {
      /* ignore */
    } finally {
      setFeeLoading(false);
    }
  }, [amount, dir]);
  useEffect(() => {
    const t = setTimeout(loadFee, 400);
    return () => clearTimeout(t);
  }, [loadFee]);

  const feeText = feeLoading ? "..." : fee ? `${fee.estimatedSourceGas} + 0 IGP` : "-";

  // ---- Live execution: sign transferRemote on the SOURCE chain ----
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const chainId = useChainId();
  const [exec, setExec] = useState<{ phase: "idle" | "working" | "done" | "error"; msg: string; tx?: string }>({ phase: "idle", msg: "" });

  const executeBridge = async () => {
    if (!isConnected || !walletClient || !address) {
      open();
      return;
    }
    let amt: bigint;
    try {
      amt = parseEther(amount || "0");
    } catch {
      amt = 0n;
    }
    if (amt <= 0n) {
      setExec({ phase: "error", msg: "Enter an amount first." });
      return;
    }
    if (originBalance != null && Number(amount) > originBalance + 1e-9) {
      setExec({ phase: "error", msg: "Amount exceeds your balance on this chain." });
      return;
    }
    const src = routeOf(fromKey);
    const dst = routeOf(toKey);
    setExec({ phase: "working", msg: chainId !== src.chainId ? `Switching your wallet to ${src.label}...` : "Preparing..." });
    try {
      if (chainId !== src.chainId) await switchChainAsync({ chainId: src.chainId });
      const pub = createPublicClient({ transport: http(src.rpc) });
      const fee = (await pub.readContract({ address: src.router, abi: HYPERLANE_ROUTER_ABI, functionName: "quoteGasPayment", args: [dst.hyperlaneDomain] })) as bigint;
      // ERC-20 side (Ethereum): approve the router for the amount, once.
      if (src.underlying) {
        const allowance = (await pub.readContract({ address: src.underlying, abi: ERC20_ABI, functionName: "allowance", args: [address, src.router] })) as bigint;
        if (allowance < amt) {
          setExec({ phase: "working", msg: "Approve LCAI in your wallet (one-time)..." });
          const approveTx = await walletClient.writeContract({ address: src.underlying, abi: ERC20_ABI, functionName: "approve", args: [src.router, amt] });
          await pub.waitForTransactionReceipt({ hash: approveTx });
        }
      }
      // Pin chain-estimated fees so MetaMask can render LightChain's tiny gas.
      let feeParams: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | { gasPrice: bigint } | undefined;
      try {
        const f = await pub.estimateFeesPerGas();
        feeParams = f?.maxFeePerGas ? { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas ?? f.maxFeePerGas } : { gasPrice: await pub.getGasPrice() };
      } catch {
        try {
          feeParams = { gasPrice: await pub.getGasPrice() };
        } catch {
          feeParams = undefined;
        }
      }
      // HypNative (LightChain): value = amount + fee. HypERC20 (Ethereum): value = fee.
      const value = src.underlying ? fee : amt + fee;
      setExec({ phase: "working", msg: "Confirm the bridge transfer in your wallet..." });
      const tx = await walletClient.writeContract({
        address: src.router,
        abi: HYPERLANE_ROUTER_ABI,
        functionName: "transferRemote",
        args: [dst.hyperlaneDomain, addressToBytes32(address), amt],
        value,
        gas: 500_000n,
        ...(feeParams ?? {}),
      });
      setExec({ phase: "done", msg: "", tx });
      setAmount("");
      // Refresh balances once the source-chain tx confirms (the source side
      // drops immediately; the relayed amount lands on the destination later, so
      // poll a couple more times to catch the remote balance updating).
      pub
        .waitForTransactionReceipt({ hash: tx })
        .then(() => {
          loadBalances();
          setTimeout(loadBalances, 15_000);
          setTimeout(loadBalances, 45_000);
        })
        .catch(() => {});
    } catch (e) {
      setExec({ phase: "error", msg: humanizeError(e, { action: "the bridge transfer" }) });
    }
  };
  const working = exec.phase === "working";

  return (
    <div className="space-y-8">
      <div className="mx-auto max-w-[480px] overflow-hidden rounded-2xl border border-primary/30 shadow-2xl">
        <div className="bg-[#14152C] px-3 py-5 text-center">
          <h2 className="text-xl font-semibold leading-tight text-content-primary">LCAI Bridge</h2>
        </div>

        <div className="space-y-2.5 bg-[#070710] p-4 sm:p-5">
          {/* token-pair row + center flip */}
          <div className="relative grid grid-cols-2 gap-[33px]">
            <TokenButton brand={fromBrand} />
            <TokenButton brand={toBrand} reverse />
            <div className="absolute left-1/2 top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 rounded-md border-4 border-[#070710] sm:border-[6px]">
              <button
                type="button"
                onClick={flip}
                aria-label="Flip direction"
                className="grid size-8 place-items-center rounded-md bg-[#1A1B38] text-primary transition-colors hover:bg-[#14152C] sm:size-[44px]"
              >
                <ArrowLeftRight className="size-4" />
              </button>
            </div>
          </div>

          {/* amount + balances */}
          <div className="mt-4 rounded-xl border border-bdr-soft bg-surface-base-subtle p-2.5">
            <div className="rounded-lg border border-bdr-soft bg-[#14152C] p-4">
              <div className="flex items-center justify-between gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-full flex-1 border-none bg-transparent text-xl font-normal tabular-nums text-content-primary outline-none placeholder:text-content-soft sm:text-2xl"
                />
                <button
                  type="button"
                  onClick={() => originBalance && originBalance > 0 && setAmount(String(originBalance))}
                  disabled={!isConnected || !originBalance}
                  className="flex h-6 min-w-[52px] items-center justify-center rounded-[30px] bg-primary px-3 text-xs font-semibold leading-none text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Max
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs leading-[18px] text-content-soft">
                <span className="tabular-nums">$0.00</span>
                <span className="font-medium text-primary tabular-nums">Balance: {bal4(originBalance)}</span>
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between">
                {isConnected && address ? (
                  <span className="inline-flex items-center gap-2 text-sm text-content-soft">
                    <span className="size-2 rounded-full bg-success" />
                    <span className="font-mono text-content-primary">{shortAddr(address)}</span>
                  </span>
                ) : (
                  <button type="button" onClick={() => open()} className="inline-flex items-center gap-1.5 text-sm text-content-soft transition-colors hover:text-content-primary">
                    Connect Wallet <ChevronDown className="size-3.5" />
                  </button>
                )}
                <span className="text-xs text-content-soft">{toBrand.sub}</span>
              </div>
              <div className="rounded-lg border border-bdr-soft bg-[#14152C] p-4">
                <span className="text-sm font-medium leading-[18px] text-primary tabular-nums">Remote Balance: {bal4(remoteBalance)}</span>
              </div>
            </div>
          </div>

          {/* fees */}
          <div className="mt-2 flex items-center text-sm text-content-soft">
            <CreditCard className="mr-1 size-4" /> Fees: <span className="ml-1 text-content-default">{feeText}</span>
            {feeLoading && <Loader2 className="ml-1 size-3.5 animate-spin" />}
          </div>

          {/* action */}
          <button
            type="button"
            onClick={() => void executeBridge()}
            disabled={working}
            className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(94deg,#dd00ac_0%,#7130c3_38%,#7064e9_68%,#4f7cf6_100%)] bg-[length:200%_auto] bg-[position:left_center] text-base font-semibold tracking-[0.3px] text-white transition-all duration-300 hover:bg-[position:right_center] hover:brightness-110 disabled:pointer-events-none disabled:opacity-60"
          >
            {working && <Loader2 className="size-4 animate-spin" />}
            {!isConnected ? "Connect wallet" : working ? "Bridging..." : `Bridge to ${toBrand.label}`}
          </button>
          {exec.phase === "working" && exec.msg && (
            <p className="text-center text-xs text-content-soft">{exec.msg}</p>
          )}
          {exec.phase === "done" && exec.tx && (
            <a
              href={`${routeOf(fromKey).explorer}/tx/${exec.tx}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-xl border border-success/30 bg-success/5 px-3 py-2.5 text-sm text-success"
            >
              <CheckCircle2 className="size-4" /> Bridge submitted - track on {fromBrand.label} <ExternalLink className="size-3.5" />
            </a>
          )}
          {exec.phase === "error" && (
            <p className="flex items-start justify-center gap-1.5 text-center text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {exec.msg}
            </p>
          )}
          <p className="text-center text-[11px] leading-relaxed text-content-soft">
            Live Hyperlane Warp Route - signs with your own wallet on {fromBrand.label} (your wallet confirms every step; LCAI lands on {toBrand.label} after the relay).
          </p>
        </div>
      </div>

      <section className="mx-auto max-w-[640px] space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">Execute it (signs with your wallet)</h2>
        <CodeTabs tabs={[{ label: "TypeScript", code: bridgeSnippet(dir, amount, address ?? "") }]} />
        <p className="text-xs text-content-soft">
          Hold LCAI ERC-20 on Ethereum?{" "}
          <a href="https://app.uniswap.org/swap?chain=ethereum&outputCurrency=0x9cA8530CA349c966Fe9ef903Df17a75B8A778927" target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Get some on Uniswap
          </a>
          , then bridge it to native LCAI on LightChain.
        </p>
      </section>
    </div>
  );
}
