"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Loader2, RefreshCw, ChevronDown, ExternalLink } from "lucide-react";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { Notice, short } from "@/components/build/console/panel-kit";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DAO_EXPLORER, type DaoChain } from "./dao-chain";
import { TreasuryBar } from "./treasury-bar";
import { VotingPowerCard } from "./voting-power-card";
import { QuorumLine } from "./quorum-line";
import { CastVote } from "./cast-vote";

const CHAIN_META: Record<DaoChain, { label: string; icon: string }> = {
  ethereum: { label: "Ethereum", icon: "/logos/eth.svg" },
  lightchain: { label: "LightChain", icon: "/logos/lcai.png" },
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
  description?: string;
  proposer: string;
  stateLabel: string;
  voteStart?: string;
  voteEnd?: string;
  deadlineBlock?: string;
  votesFor: string;
  votesAgainst: string;
  votesAbstain: string;
  snapshotBlock?: string;
  quorumWei?: string;
  actions?: DecodedAction[];
}
interface DaoResponse {
  addresses?: { governor: string };
  total: number;
  hasMore: boolean;
  proposals: Proposal[];
}

function snippetFor(chain: DaoChain): string {
  const rpcVar = chain === "ethereum" ? "ETH_RPC" : "LIGHTCHAIN_RPC";
  const tokenNote =
    chain === "ethereum"
      ? `// Ethereum: LCAIB is an ERC20Votes token - delegate once to activate power.`
      : `// LightChain: native voting via the genesis predeploy - stake self-delegates.`;
  return `import { createPublicClient, http } from "viem";
import { DAO } from "lightnode-sdk";

${tokenNote}
const dao = new DAO(createPublicClient({ transport: http(${rpcVar}) }), "${chain}");

// Live reads (no wallet needed):
const p        = await dao.proposal(proposalId);     // state, tallies, snapshot
const quorum   = await dao.quorum(p.snapshot);        // wei needed to reach quorum
const power    = await dao.getVotes(me, p.snapshot);  // your weight at the snapshot
const voted    = await dao.hasVoted(proposalId, me);  // already voted?
const delegate = await dao.getDelegate(me);           // who holds your voting power

// Writes sign with your wallet: new DAO(rpc, "${chain}", walletClient)
// await dao.delegate(me);              // activate your voting power
// await dao.castVote(proposalId, 1);   // 0 against, 1 for, 2 abstain`;
}

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
  const [limit, setLimit] = useState(5);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
            <div className="inline-flex items-center rounded-full border border-bdr-soft bg-surface-base-subtle p-0.5 text-xs font-medium">
              {(["ethereum", "lightchain"] as DaoChain[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setChain(c);
                    setLimit(5);
                  }}
                  aria-pressed={chain === c}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all",
                    chain === c
                      ? "bg-gradient-primary text-white shadow-[0_2px_10px_-2px_rgba(112,100,233,0.6)]"
                      : "text-content-soft hover:text-content-primary",
                  )}
                >
                  <Image src={CHAIN_META[c].icon} alt="" width={14} height={14} className="size-3.5 rounded-full object-contain" />
                  {CHAIN_META[c].label}
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
        <div className="mb-4 space-y-3">
          <TreasuryBar chain={chain} />
          <VotingPowerCard chain={chain} />
        </div>

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

            {data?.proposals.map((p) => {
              const open = expandedId === p.id;
              const fmtLcai = (s: string) => Math.round(num(s)).toLocaleString();
              return (
                <div key={p.id} className="overflow-hidden rounded-2xl border border-bdr-soft bg-card/60 backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : p.id)}
                    className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-surface-base-faint/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={toneFor(p.stateLabel)}>{p.stateLabel}</Badge>
                        <span className="font-mono text-[11px] text-content-soft">#{short(p.id, 6, 4)}</span>
                        {p.actions?.some((a) => a.dangerous) && <Badge tone="warning">privileged</Badge>}
                      </div>
                      <p className={cn("mt-1.5 text-sm font-medium text-content-primary", !open && "truncate")}>{p.title}</p>
                      <span className="text-[11px] text-content-soft">by {short(p.proposer)}</span>
                      <VoteBar p={p} />
                    </div>
                    <ChevronDown className={cn("mt-1 size-4 shrink-0 text-content-soft transition-transform", open && "rotate-180")} />
                  </button>

                  {open && (
                    <div className="space-y-3 border-t border-bdr-soft px-4 pb-4 pt-3">
                      {p.description && (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-content-soft">Description</p>
                          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-bdr-soft bg-surface-base-faint p-3 text-xs leading-relaxed text-content-default">
                            {p.description}
                          </div>
                        </div>
                      )}

                      {p.actions && p.actions.length > 0 && (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-content-soft">Executes on-chain (decoded calldata)</p>
                          <div className="space-y-1">
                            {p.actions.map((act, i) => (
                              <div key={i} className="flex items-start gap-1.5 text-xs">
                                <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", act.dangerous ? "bg-warning" : "bg-content-soft/40")} />
                                <span className="break-all text-content-default">{act.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-2 rounded-lg border border-bdr-soft bg-surface-base-faint p-2.5 text-xs">
                        <div><span className="text-content-soft">For </span><span className="tabular-nums text-success">{fmtLcai(p.votesFor)}</span></div>
                        <div><span className="text-content-soft">Against </span><span className="tabular-nums text-destructive">{fmtLcai(p.votesAgainst)}</span></div>
                        <div><span className="text-content-soft">Abstain </span><span className="tabular-nums text-content-default">{fmtLcai(p.votesAbstain)}</span></div>
                      </div>

                      <QuorumLine chain={chain} votesFor={p.votesFor} votesAbstain={p.votesAbstain} quorumWei={p.quorumWei} />

                      {p.stateLabel.toLowerCase() === "active" && (
                        <CastVote chain={chain} proposalId={p.id} onVoted={() => void load(chain, limit)} />
                      )}

                      {(p.voteStart || p.voteEnd) && (
                        <p className="text-[11px] text-content-soft">Voting window: block {p.voteStart ?? "?"} → {p.voteEnd ?? "?"}</p>
                      )}

                      <div className="flex flex-wrap gap-3 text-[11px]">
                        <a href={`${DAO_EXPLORER[chain]}/address/${p.proposer}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          Proposer <ExternalLink className="size-3" />
                        </a>
                        {data?.addresses?.governor && (
                          <a href={`${DAO_EXPLORER[chain]}/address/${data.addresses.governor}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            Governor <ExternalLink className="size-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {data?.hasMore && (
              <button
                type="button"
                onClick={() => setLimit((l) => l + 5)}
                disabled={loading}
                className="w-full rounded-xl border border-bdr-soft py-2.5 text-sm font-medium text-content-soft transition-colors hover:border-primary/40 hover:text-content-primary disabled:opacity-50"
              >
                {loading ? "Loading..." : `Load more (${data.total - data.proposals.length} more)`}
              </button>
            )}
          </div>
        )}
      </ConsolePanel>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The SDK behind it</h2>
        <CodeTabs tabs={[{ label: "TypeScript", code: snippetFor(chain) }]} />
      </section>
    </div>
  );
}
