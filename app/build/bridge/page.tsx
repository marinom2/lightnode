"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, RefreshCw, Loader2 } from "lucide-react";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { PanelGrid, PanelColumn, ProofRow, Notice, short } from "@/components/build/console/panel-kit";

const SNIPPET = `import { createPublicClient, http } from "viem";
import { quoteBridgeFee, BRIDGE_ROUTE } from "lightnode-sdk";

const eth = createPublicClient({ transport: http(BRIDGE_ROUTE.ethereum.rpc) });

// Live Hyperlane gas-payment quote, Ethereum -> LightChain
const feeWei = await quoteBridgeFee(eth, "ethereum", "lightchain-mainnet");
console.log(Number(feeWei) / 1e18, "ETH");

// Then: approveBridge(...) (ERC-20 side) + bridgeTransfer(...) - the wallet
// signs; LCAI arrives on the other chain. See the SDK reference for args.`;

interface ChainEndpoint {
  router: string;
  underlying: string | null;
  explorer: string;
  label: string;
}
interface QuoteData {
  ethereumToLightChain: { ok: boolean; feeEth?: number; error?: string };
  lightChainToEthereum: { ok: boolean; feeLcai?: number; error?: string };
  route: Record<string, ChainEndpoint>;
}

export default function BridgePanel() {
  const [data, setData] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bridge-quote");
      const d = (await res.json()) as QuoteData & { error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? "Could not reach the bridge routers.");
        return;
      }
      setData(d);
    } catch {
      setError("Network error fetching the bridge quote.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const eth = data?.route?.ethereum;
  const lc = data?.route?.["lightchain-mainnet"];

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Bridge"
        title="Bridge LCAI"
        subtitle="Move LCAI between Ethereum and LightChain over the Hyperlane Warp Route. These are live gas-payment quotes, read straight from the routers on each chain - the same call the SDK makes."
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-bdr-soft bg-surface-base-subtle px-3 py-2 text-sm font-medium text-content-default transition-colors hover:border-primary/40 hover:text-content-primary disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
          </button>
        }
      >
        {error && <Notice tone="warn">{error}</Notice>}
        <PanelGrid>
          <PanelColumn
            title="Ethereum -> LightChain"
            badge={<span className="text-[11px] text-content-soft">gas payment</span>}
          >
            <div className="space-y-3">
              <div>
                <div className="text-2xl font-semibold tabular-nums text-content-primary">
                  {loading ? (
                    <span className="inline-block h-7 w-24 animate-pulse rounded bg-surface-base-light" />
                  ) : data?.ethereumToLightChain.ok ? (
                    `${(data.ethereumToLightChain.feeEth ?? 0).toFixed(6)} ETH`
                  ) : (
                    <span className="text-base text-content-soft">unavailable</span>
                  )}
                </div>
                <p className="text-[11px] text-content-soft">paid to the Hyperlane mailbox to deliver the message</p>
              </div>
              {eth && (
                <div className="border-t border-bdr-soft pt-2">
                  {eth.underlying && (
                    <ProofRow label="LCAI token" value={short(eth.underlying)} href={`${eth.explorer}/address/${eth.underlying}`} />
                  )}
                  <ProofRow label="router" value={short(eth.router)} href={`${eth.explorer}/address/${eth.router}`} />
                </div>
              )}
            </div>
          </PanelColumn>

          <PanelColumn
            title="LightChain -> Ethereum"
            badge={<span className="text-[11px] text-content-soft">gas payment</span>}
          >
            <div className="space-y-3">
              <div>
                <div className="text-2xl font-semibold tabular-nums text-content-primary">
                  {loading ? (
                    <span className="inline-block h-7 w-24 animate-pulse rounded bg-surface-base-light" />
                  ) : data?.lightChainToEthereum.ok ? (
                    `${(data.lightChainToEthereum.feeLcai ?? 0).toFixed(6)} LCAI`
                  ) : (
                    <span className="text-base text-content-soft">unavailable</span>
                  )}
                </div>
                <p className="text-[11px] text-content-soft">native LCAI paid to relay back to Ethereum</p>
              </div>
              {lc && (
                <div className="border-t border-bdr-soft pt-2">
                  <ProofRow label="router" value={short(lc.router)} href={`${lc.explorer}/address/${lc.router}`} />
                  <p className="py-1 text-[11px] text-content-soft">HypNative: the amount you send IS the native LCAI value.</p>
                </div>
              )}
            </div>
          </PanelColumn>
        </PanelGrid>
      </ConsolePanel>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The SDK call this panel makes</h2>
        <CodeTabs tabs={[{ label: "TypeScript", code: SNIPPET }]} />
        <p className="text-xs text-content-soft">
          Full method list (quote, balance, allowance, approve, transfer) in the{" "}
          <a href="/build/reference" className="text-primary hover:underline">SDK reference</a>.
          Pair it with a Uniswap swap for a complete ETH {String.fromCharCode(8594)} native-LCAI flow.
        </p>
      </section>
    </div>
  );
}
