"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { Notice, short } from "@/components/build/console/panel-kit";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type DaoChain = "ethereum" | "lightchain";
const EXPLORER: Record<DaoChain, string> = {
  ethereum: "https://etherscan.io",
  lightchain: "https://mainnet.lightscan.app",
};

interface DecodedAction {
  target: string;
  valueLcai: number;
  fn: string | null;
  label: string;
  kind: string;
  dangerous: boolean;
}
interface Proposal {
  id: string;
  title: string;
  proposer: string;
  stateLabel: string;
  votesFor: string;
  votesAgainst: string;
  votesAbstain: string;
  actions?: DecodedAction[];
}
interface DaoResponse {
  addresses?: { governor: string };
  total: number;
  hasMore: boolean;
  proposals: Proposal[];
}

const SNIPPET = `import { createPublicClient, http } from "viem";
import { DAO } from "lightnode-sdk";

const dao = new DAO(createPublicClient({ transport: http(ETH_RPC) }), "ethereum");

const p = await dao.proposal(proposalId);   // state, tallies, deadline
// Voting / proposing sign with a wallet:
// await dao.castVote(proposalId, 1);        // 0 against, 1 for, 2 abstain`;

function toneFor(label: string): "brand" | "success" | "danger" | "warning" | "muted" {
  const l = label.toLowerCase();
  if (l === "active") return "brand";
  if (l === "succeeded" || l === "executed") return "success";
  if (l === "defeated" || l === "canceled" || l === "expired") return "danger";
  if (l === "pending" || l === "queued") return "warning";
  return "muted";
}

function num(wei: string): number {
  try {
    return Number(BigInt(wei)) / 1e18;
  } catch {
    return 0;
  }
}

function VoteBar({ p }: { p: Proposal }) {
  const f = num(p.votesFor);
  const a = num(p.votesAgainst);
  const ab = num(p.votesAbstain);
  const total = f + a + ab;
  const pct = (x: number) => (total > 0 ? (x / total) * 100 : 0);
  return (
    <div className="mt-2">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-base-light">
        <div className="bg-success" style={{ width: `${pct(f)}%` }} />
        <div className="bg-destructive" style={{ width: `${pct(a)}%` }} />
        <div className="bg-content-soft/40" style={{ width: `${pct(ab)}%` }} />
      </div>
      <div className="mt-1 flex gap-3 text-[11px] text-content-soft">
        <span className="text-success">For {pct(f).toFixed(0)}%</span>
        <span className="text-destructive">Against {pct(a).toFixed(0)}%</span>
        <span>Abstain {pct(ab).toFixed(0)}%</span>
      </div>
    </div>
  );
}

export default function DaoPanel() {
  const [chain, setChain] = useState<DaoChain>("ethereum");
  const [limit, setLimit] = useState(12);
  const [data, setData] = useState<DaoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (c: DaoChain, lim: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dao-proposals?chain=${c}&limit=${lim}`);
      const d = (await res.json()) as DaoResponse & { error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? "Could not reach the governor RPC.");
        return;
      }
      setData(d);
    } catch {
      setError("Network error fetching proposals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(chain, limit);
  }, [load, chain, limit]);

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · DAO"
        title="Governance"
        subtitle="Read live LCAIGovernor proposals (OpenZeppelin Governor v5) and their on-chain vote tallies. Casting votes, proposing, queueing, and executing sign with your wallet - shown in the snippet."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-bdr-soft p-0.5">
              {(["ethereum", "lightchain"] as DaoChain[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setChain(c);
                    setLimit(12);
                  }}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                    chain === c ? "bg-surface-base-light text-content-primary" : "text-content-soft hover:text-content-primary",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load(chain, limit)}
              disabled={loading}
              aria-label="Refresh"
              className="grid size-9 place-items-center rounded-lg border border-bdr-soft text-content-soft transition-colors hover:text-content-primary disabled:opacity-50"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </button>
          </div>
        }
      >
        {error && <Notice tone="warn">{error}</Notice>}

        {!error && (
          <div className="space-y-2.5">
            {loading && !data &&
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl border border-bdr-soft bg-surface-base-faint" />
              ))}

            {data?.proposals.length === 0 && (
              <div className="rounded-2xl border border-dashed border-bdr-soft px-4 py-8 text-center text-sm text-content-soft">
                No proposals found on {chain} in the scanned window.
              </div>
            )}

            {data?.proposals.map((p) => (
              <div key={p.id} className="rounded-2xl border border-bdr-soft bg-card/60 p-4 backdrop-blur-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={toneFor(p.stateLabel)}>{p.stateLabel}</Badge>
                      <span className="font-mono text-[11px] text-content-soft">#{short(p.id, 6, 4)}</span>
                    </div>
                    <p className="mt-1.5 truncate text-sm font-medium text-content-primary">{p.title}</p>
                    <a
                      href={`${EXPLORER[chain]}/address/${p.proposer}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-content-soft hover:text-primary"
                    >
                      by {short(p.proposer)}
                    </a>
                  </div>
                </div>
                <VoteBar p={p} />
                {p.actions && p.actions.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-bdr-soft pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-content-soft">Executes on-chain (decoded calldata)</p>
                    {p.actions.map((act, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs">
                        <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", act.dangerous ? "bg-warning" : "bg-content-soft/40")} />
                        <span className="text-content-default">{act.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {data?.hasMore && (
              <button
                type="button"
                onClick={() => setLimit((l) => l + 12)}
                disabled={loading}
                className="w-full rounded-xl border border-bdr-soft py-2.5 text-sm font-medium text-content-soft transition-colors hover:text-content-primary disabled:opacity-50"
              >
                {loading ? "Loading..." : `Load more (${data.total - data.proposals.length} more)`}
              </button>
            )}
          </div>
        )}
      </ConsolePanel>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The SDK behind it</h2>
        <CodeTabs tabs={[{ label: "TypeScript", code: SNIPPET }]} />
      </section>
    </div>
  );
}
