"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ChevronDown, ArrowLeftRight, CreditCard, Loader2 } from "lucide-react";
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { shortAddr, cn } from "@/lib/utils";

type Dir = "eth-to-lc" | "lc-to-eth";

const ETH = { label: "Ethereum", badge: "/logos/eth.svg" };
const LC = { label: "LightchainAI", badge: "/lightnode-mark.png" };

interface Balances {
  ethereumLcai: number;
  lightchainLcai: number;
}
interface Fee {
  estimatedSourceGas: string;
  igpFee: { ok: boolean };
}

function TokenLogo({ badge }: { badge: string }) {
  return (
    <span className="relative inline-block size-9 shrink-0">
      <Image src="/logos/lcai.png" alt="LCAI" width={36} height={36} className="size-9 rounded-full" />
      <Image src={badge} alt="" width={16} height={16} className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-card ring-2 ring-card" />
    </span>
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

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

export default function BridgePanel() {
  const { address, isConnected } = useAccount();
  const { open } = useAppKit();
  const [dir, setDir] = useState<Dir>("eth-to-lc");
  const [amount, setAmount] = useState("");
  const [bal, setBal] = useState<Balances | null>(null);
  const [fee, setFee] = useState<Fee | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);

  const from = dir === "eth-to-lc" ? ETH : LC;
  const to = dir === "eth-to-lc" ? LC : ETH;
  const sourceBal = bal ? (dir === "eth-to-lc" ? bal.ethereumLcai : bal.lightchainLcai) : 0;
  const remoteBal = bal ? (dir === "eth-to-lc" ? bal.lightchainLcai : bal.ethereumLcai) : 0;

  // Real balances on both chains for the connected address (same EVM address).
  useEffect(() => {
    if (!isConnected || !address) {
      setBal(null);
      return;
    }
    let on = true;
    fetch(`/api/bridge-balances?address=${address}`)
      .then((r) => r.json())
      .then((j: Balances & { ok?: boolean }) => on && j.ok && setBal(j))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [isConnected, address]);

  // Live fee preview, debounced on amount/direction.
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

  const feeText = feeLoading ? "..." : fee ? `${fee.estimatedSourceGas} + 0 Hyperlane (IGP)` : "-";

  return (
    <div className="space-y-8">
      <div className="mx-auto max-w-[480px] overflow-hidden rounded-3xl border border-bdr-soft bg-card shadow-2xl">
        <div className="border-b border-bdr-soft px-6 py-5 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-content-primary">LCAI Bridge</h2>
        </div>

        <div className="space-y-4 p-6">
          {/* Token pair */}
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-3 rounded-2xl border border-bdr-soft bg-surface-base-faint px-3.5 py-3">
              <TokenLogo badge={from.badge} />
              <div className="min-w-0 leading-tight">
                <div className="text-base font-semibold text-content-primary">LCAI</div>
                <div className="truncate text-xs text-content-soft">{from.label}</div>
              </div>
              <ChevronDown className="ml-auto size-4 shrink-0 text-content-soft" />
            </div>
            <button
              type="button"
              onClick={() => setDir((d) => (d === "eth-to-lc" ? "lc-to-eth" : "eth-to-lc"))}
              aria-label="Flip direction"
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-bdr-soft bg-card text-content-soft transition-colors hover:border-primary/40 hover:text-primary"
            >
              <ArrowLeftRight className="size-4" />
            </button>
            <div className="flex flex-1 items-center gap-3 rounded-2xl border border-bdr-soft bg-surface-base-faint px-3.5 py-3">
              <ChevronDown className="size-4 shrink-0 text-content-soft" />
              <div className="ml-auto min-w-0 text-right leading-tight">
                <div className="text-base font-semibold text-content-primary">LCAI</div>
                <div className="truncate text-xs text-content-soft">{to.label}</div>
              </div>
              <TokenLogo badge={to.badge} />
            </div>
          </div>

          {/* Amount */}
          <div className="rounded-2xl border border-bdr-soft bg-surface-base-faint p-4">
            <div className="flex items-center gap-3">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full bg-transparent text-3xl font-semibold tabular-nums text-content-primary outline-none placeholder:text-content-soft/40"
              />
              <button
                type="button"
                onClick={() => sourceBal > 0 && setAmount(String(sourceBal))}
                className="shrink-0 rounded-full bg-primary/15 px-3 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/25"
              >
                Max
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-sm">
              <span className="text-content-soft">$0.00</span>
              <span className="font-medium text-primary">Balance: {fmt(sourceBal)}</span>
            </div>
          </div>

          {/* Wallet + remote balance */}
          <button
            type="button"
            onClick={() => open()}
            className="inline-flex items-center gap-1.5 text-sm text-content-soft transition-colors hover:text-content-primary"
          >
            {isConnected && address ? shortAddr(address) : "Connect Wallet"} <ChevronDown className="size-3.5" />
          </button>
          <div className="rounded-2xl border border-bdr-soft bg-surface-base-faint p-4 text-sm">
            <span className="font-medium text-primary">Remote Balance: {fmt(remoteBal)}</span>
          </div>

          {/* Fees */}
          <div className="flex items-center gap-1.5 text-sm text-content-soft">
            <CreditCard className="size-4" /> Fees: <span className="text-content-default">{feeText}</span>
            {feeLoading && <Loader2 className="size-3.5 animate-spin" />}
          </div>

          {/* Action */}
          <button
            type="button"
            onClick={() => (isConnected ? loadFee() : open())}
            className="h-12 w-full rounded-2xl bg-[linear-gradient(94deg,#dd00ac_0%,#7130c3_38%,#7064e9_68%,#4f7cf6_100%)] bg-[length:200%_auto] bg-[position:left_center] text-base font-semibold tracking-[0.3px] text-white transition-all duration-300 hover:bg-[position:right_center] hover:brightness-110"
          >
            {isConnected ? `Review ${from.label} → ${to.label} transfer` : "Connect wallet"}
          </button>
          <p className="text-center text-[11px] leading-relaxed text-content-soft">
            Live Hyperlane Warp Route. The transfer signs with your own wallet on {from.label} - the exact call is generated below (a bridge moves real cross-chain funds, so it isn&apos;t auto-submitted here).
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
