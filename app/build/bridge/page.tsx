"use client";

import { useState } from "react";
import { ArrowRight, Loader2, ArrowLeftRight } from "lucide-react";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { PanelGrid, PanelColumn, Field, RunButton, ResponseEmpty, ProofRow, Notice, short } from "@/components/build/console/panel-kit";
import { cn } from "@/lib/utils";

type Dir = "eth-to-lc" | "lc-to-eth";

interface Preview {
  direction: Dir;
  amountLcai: string;
  igpFee: { ok: boolean; eth?: number | null; lcai?: number | null; note?: string; error?: string };
  estimatedSourceGas: string;
  estimatedRelayMinutes: string;
  arrives: string;
  route: { from: { chain: string; router: string; explorer: string }; to: { chain: string; router: string; explorer: string } };
  projectedCall: { contract: string; method: string; destinationDomain: number; amount: string; recipientGiven: string | null; recipientHint: string | null; value: string };
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

await approveBridge(wallet, parseEther("${amt}"));        // ERC-20 approve, once
await bridgeTransfer(wallet, {
  from: "ethereum",
  to: "lightchain-mainnet",
  amount: parseEther("${amt}"),
  recipient: ${recip},                            // arrives as NATIVE LCAI on chain 9200
  fee,
});`;
  }
  return `import { createWalletClient, custom, parseEther } from "viem";
import { quoteBridgeFee, bridgeTransfer } from "lightnode-sdk";

// Signer on LightChain mainnet - native LCAI, no approve:
const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
const fee = await quoteBridgeFee(pub, "lightchain-mainnet", "ethereum");

await bridgeTransfer(wallet, {
  from: "lightchain-mainnet",
  to: "ethereum",
  amount: parseEther("${amt}"),
  recipient: ${recip},                            // arrives as LCAI ERC-20 on Ethereum
  fee,                                            // value sent = amount + fee
});`;
}

export default function BridgePanel() {
  const [dir, setDir] = useState<Dir>("eth-to-lc");
  const [amount, setAmount] = useState("100");
  const [recipient, setRecipient] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/bridge-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: dir, amount, recipient: recipient.trim() || undefined }),
      });
      const d = (await res.json()) as (Preview & { ok: true }) | { ok?: false; error: string };
      if (!res.ok || "error" in d) {
        setError(("error" in d && d.error) || "Could not build the bridge preview.");
        return;
      }
      setPreview(d);
    } catch {
      setError("Network error reaching the bridge endpoint.");
    } finally {
      setLoading(false);
    }
  };

  const fromLabel = dir === "eth-to-lc" ? "Ethereum" : "LightChain";
  const toLabel = dir === "eth-to-lc" ? "LightChain" : "Ethereum";

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Bridge"
        title="Bridge LCAI"
        subtitle="Move LCAI across the Hyperlane Warp Route - LCAI ERC-20 on Ethereum to/from native LCAI on LightChain. Pick a direction and amount for a live, exact transfer preview (fee, source gas, relay window, the projected transferRemote call). The execute signs with your own wallet on the source chain - the call is built for you below."
      >
        <PanelGrid>
          <PanelColumn title="Transfer">
            <div className="space-y-4">
              <div>
                <span className="mb-1.5 block text-xs font-medium text-content-soft">Direction</span>
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 rounded-lg border border-bdr-soft p-0.5 text-xs">
                    {(["eth-to-lc", "lc-to-eth"] as Dir[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDir(d)}
                        className={cn(
                          "flex-1 rounded-md px-2 py-1.5 font-medium transition-colors",
                          dir === d ? "bg-primary/10 text-content-primary" : "text-content-soft hover:text-content-primary",
                        )}
                      >
                        {d === "eth-to-lc" ? "Ethereum → LightChain" : "LightChain → Ethereum"}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDir((d) => (d === "eth-to-lc" ? "lc-to-eth" : "eth-to-lc"))}
                    aria-label="Flip direction"
                    className="grid size-9 shrink-0 place-items-center rounded-lg border border-bdr-soft text-content-soft transition-colors hover:text-primary"
                  >
                    <ArrowLeftRight className="size-4" />
                  </button>
                </div>
              </div>
              <Field label="Amount (LCAI)">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 text-sm tabular-nums text-content-primary outline-none focus:border-primary/60"
                />
              </Field>
              <Field label="Recipient (optional)" hint={`Destination address on ${toLabel}. Defaults to your own address when you run it.`}>
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value.trim())}
                  placeholder="0x..."
                  className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-sm text-content-primary outline-none focus:border-primary/60"
                />
              </Field>
              <RunButton running={loading} disabled={!amount.trim()} onClick={() => void run()} idle="Preview transfer" busy="Quoting..." />
            </div>
          </PanelColumn>

          <PanelColumn title={`${fromLabel} → ${toLabel}`}>
            {error && <Notice tone="warn">{error}</Notice>}
            {!preview && !loading && !error && <ResponseEmpty>Pick a direction + amount and preview the exact transfer.</ResponseEmpty>}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-content-soft">
                <Loader2 className="size-4 animate-spin" /> Reading the live Hyperlane route...
              </div>
            )}
            {preview && (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-3 rounded-xl border border-bdr-soft bg-surface-base-faint p-3 text-center">
                  <div>
                    <div className="text-lg font-semibold tabular-nums text-content-primary">{preview.amountLcai} LCAI</div>
                    <div className="text-[11px] text-content-soft">on {fromLabel}</div>
                  </div>
                  <ArrowRight className="size-4 text-primary" />
                  <div>
                    <div className="text-lg font-semibold tabular-nums text-content-primary">{preview.amountLcai} LCAI</div>
                    <div className="text-[11px] text-content-soft">{preview.arrives}</div>
                  </div>
                </div>
                <div className="rounded-xl border border-bdr-soft p-3">
                  <ProofRow label="Hyperlane fee" value={preview.igpFee.ok ? "0 (IGP pre-paid)" : (preview.igpFee.error ?? "unavailable")} />
                  <ProofRow label="Source gas" value={preview.estimatedSourceGas} />
                  <ProofRow label="Arrives in" value={`~${preview.estimatedRelayMinutes} min`} />
                </div>
                <div className="rounded-xl border border-bdr-soft p-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Projected call</p>
                  <ProofRow label="router" value={short(preview.projectedCall.contract)} href={`${preview.route.from.explorer}/address/${preview.projectedCall.contract}`} />
                  <ProofRow label="method" value="transferRemote(...)" />
                  <ProofRow label="dest domain" value={String(preview.projectedCall.destinationDomain)} />
                  <ProofRow label="value" value={`${Number(preview.projectedCall.value) / 1e18} ${dir === "eth-to-lc" ? "ETH" : "LCAI"}`} />
                  {preview.projectedCall.recipientHint && <p className="pt-1 text-[11px] text-content-soft">{preview.projectedCall.recipientHint}</p>}
                </div>
                <Notice tone="warn">Dry-run preview - no transaction sent. Run the call below to execute, signing with your own wallet on {fromLabel}.</Notice>
              </div>
            )}
          </PanelColumn>
        </PanelGrid>
      </ConsolePanel>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">Execute it (signs with your wallet)</h2>
        <CodeTabs tabs={[{ label: "TypeScript", code: bridgeSnippet(dir, amount, recipient) }]} />
        <p className="text-xs text-content-soft">
          {dir === "eth-to-lc"
            ? "Inbound signs on Ethereum mainnet (where LCAI is an ERC-20) - approve once, then transferRemote; native LCAI arrives on LightChain."
            : "Outbound signs on LightChain mainnet - native LCAI is attached as value, no approve needed."}{" "}
          Hold LCAI ERC-20 on Ethereum?{" "}
          <a href="https://app.uniswap.org/swap?chain=ethereum&outputCurrency=0x9cA8530CA349c966Fe9ef903Df17a75B8A778927" target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Get some on Uniswap
          </a>
          .
        </p>
      </section>
    </div>
  );
}
