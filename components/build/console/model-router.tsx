"use client";

/**
 * Consumer-side model router UI (the "find best model" half of /build/quote).
 * Ranks whitelisted models against builder constraints from live data via
 * LightNode.chooseModel (/api/operator-preview?action=chooseModel). The inverse
 * of the operator reliability leaderboard - nobody else offers consumers a
 * "pick the model with the best live SLA + enough redundant workers" view.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Loader2, Trophy } from "lucide-react";
import { Field, RunButton, Notice } from "@/components/build/console/panel-kit";
import { cn } from "@/lib/utils";

interface Choice {
  model: string;
  modelId: string;
  feeLcai: number;
  maxOutputTokens: number;
  enabled: boolean;
  eligibleWorkers: number;
  completionRate: number | null;
  p50: number | null;
  p95: number | null;
  sampleJobs: number;
  refundWindowSec: number;
  meets: boolean;
  dropReasons: string[];
  score: number;
}

function num(v: string): string {
  return v.replace(/[^0-9.]/g, "");
}

function ConstraintInput({ label, value, onChange, placeholder, suffix }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; suffix?: string }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => onChange(num(e.target.value))}
          placeholder={placeholder}
          inputMode="decimal"
          className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-1.5 text-sm tabular-nums text-content-primary outline-none focus:border-primary/60"
        />
        {suffix && <span className="shrink-0 text-[11px] text-content-soft">{suffix}</span>}
      </div>
    </Field>
  );
}

export function ModelRouter({ network, netLabel }: { network: string; netLabel: string }) {
  const [maxFee, setMaxFee] = useState("");
  const [maxP95, setMaxP95] = useState("");
  const [minCompletion, setMinCompletion] = useState("");
  const [minEligible, setMinEligible] = useState("");
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ action: "chooseModel", net: network });
    if (maxFee) qs.set("maxFee", maxFee);
    if (maxP95) qs.set("maxP95", maxP95);
    if (minCompletion) qs.set("minCompletion", String(Number(minCompletion) / 100)); // percent -> fraction
    if (minEligible) qs.set("minEligible", minEligible);
    try {
      const res = await fetch(`/api/operator-preview?${qs.toString()}`);
      const j = (await res.json()) as { choices?: Choice[]; error?: string };
      if (!res.ok || j.error || !j.choices) {
        setError(j.error ?? "Could not rank models.");
        return;
      }
      setChoices(j.choices);
    } catch {
      setError("Network error reaching the router endpoint.");
    } finally {
      setLoading(false);
    }
  }, [network, maxFee, maxP95, minCompletion, minEligible]);

  // Auto-rank (unconstrained) on mount / network change.
  useEffect(() => {
    setChoices(null);
    void find();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  const best = choices?.find((c) => c.meets) ?? null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ConstraintInput label="Max fee" value={maxFee} onChange={setMaxFee} placeholder="any" suffix="LCAI" />
        <ConstraintInput label="Max p95" value={maxP95} onChange={setMaxP95} placeholder="any" suffix="s" />
        <ConstraintInput label="Min completion" value={minCompletion} onChange={setMinCompletion} placeholder="any" suffix="%" />
        <ConstraintInput label="Min workers" value={minEligible} onChange={setMinEligible} placeholder="any" suffix="elig." />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-content-soft">Read-only · {netLabel}. Leave blank for no constraint.</span>
        <RunButton running={loading} onClick={() => void find()} idle="Rank models" busy="Ranking..." />
      </div>

      {error && <Notice tone="warn">{error}</Notice>}

      {best && (
        <div className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/5 p-3.5">
          <Trophy className="mt-0.5 size-4 shrink-0 text-success" />
          <div>
            <p className="text-sm font-semibold text-content-primary">
              Recommended: <span className="font-mono">{best.model}</span>
            </p>
            <p className="mt-0.5 text-xs text-content-default">
              {best.feeLcai} LCAI/job · {best.eligibleWorkers} eligible · {best.completionRate != null ? `${Math.round(best.completionRate * 100)}% completion` : "no sample"}
              {best.p95 != null ? ` · p95 ${best.p95}s` : ""}
            </p>
          </div>
        </div>
      )}

      <div className="divide-y divide-bdr-light overflow-hidden rounded-xl border border-bdr-soft">
        {(choices ?? []).map((c) => (
          <div key={c.modelId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-sm">
            {c.meets ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" />
            ) : (
              <AlertTriangle className="size-4 shrink-0 text-warning" />
            )}
            <span className="font-mono text-content-primary">{c.model}</span>
            <span className="text-[11px] text-content-soft">{c.feeLcai} LCAI · {c.eligibleWorkers} elig.</span>
            <span className="text-[11px] text-content-soft">
              {c.completionRate != null ? `${Math.round(c.completionRate * 100)}%` : "-"}
              {c.p95 != null ? ` · p95 ${c.p95}s` : ""}
            </span>
            <span className="ml-auto text-[11px] tabular-nums text-content-soft">score {c.score}</span>
            {!c.meets && c.dropReasons.length > 0 && (
              <span className="w-full text-[11px] text-warning">{c.dropReasons.join(" · ")}</span>
            )}
          </div>
        ))}
        {choices && choices.length === 0 && !error && (
          <p className="px-3.5 py-6 text-center text-sm text-content-soft">No whitelisted models on {netLabel}.</p>
        )}
        {!choices && loading && (
          <p className="flex items-center justify-center gap-2 px-3.5 py-6 text-sm text-content-soft">
            <Loader2 className="size-4 animate-spin" /> Ranking models by live SLA + redundancy...
          </p>
        )}
      </div>
    </div>
  );
}
