"use client";

/**
 * Network pulse: the job-level health of the whole network over the recent
 * sample, computed from /api/analytics's `summary` (a networkAnalytics rollup the
 * page otherwise discards). A premium completion-rate dial plus the numbers that
 * make a visitor go "a lot is happening here": jobs analyzed, in-flight right now,
 * earnings paid, and the incomplete/disputed health signals.
 */
import { useEffect, useState } from "react";
import { Activity, Coins, Loader2, ShieldCheck, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { RadialGauge } from "@/components/ui/radial-gauge";
import { compact, fmt, cn } from "@/lib/utils";
import { useNetwork } from "@/lib/network-context";

interface Summary {
  models: number;
  jobs: number;
  success: number;
  incomplete: number;
  disputed: number;
  inFlight: number;
  completionRate: number | null;
  earnings: number;
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-bdr-soft bg-card/40 p-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-content-soft">
        <Icon className="size-3.5" />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className={cn("text-2xl font-semibold tracking-tight", tone ?? "text-content-primary")}>{value}</div>
    </div>
  );
}

export function NetworkPulse() {
  const { network } = useNetwork();
  const [s, setS] = useState<Summary | null>(null);
  const [sampled, setSampled] = useState(0);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let on = true;
    setS(null);
    setErr(false);
    const load = () =>
      fetch(`/api/analytics?net=${network}`)
        .then((r) => r.json())
        .then((j) => {
          if (!on) return;
          if (j.ok) {
            setS(j.summary);
            setSampled(j.sampled ?? 0);
          } else setErr(true);
        })
        .catch(() => on && setErr(true));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [network]);

  const rate = s?.completionRate ?? null;
  const ratePct = rate == null ? null : Math.round(rate * 100);
  const rateTone = ratePct == null ? "text-content-primary" : ratePct >= 95 ? "text-success" : ratePct >= 85 ? "text-warning" : "text-danger";

  return (
    <Card className="overflow-hidden p-6">
      <div className="mb-5 flex items-center gap-2">
        <Zap className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-content-primary">Network pulse</h2>
        <span className="text-xs text-content-soft">job health over the last {compact(sampled || 0)} jobs</span>
        {!s && !err && <Loader2 className="ml-auto size-3.5 animate-spin text-content-soft" />}
      </div>

      {err && !s ? (
        <p className="py-6 text-center text-sm text-content-soft">Network analytics unavailable right now.</p>
      ) : (
        <div className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
          <div className="mx-auto grid place-items-center">
            <RadialGauge value={rate ?? 0} size={150}>
              <div className="text-center">
                <div className={cn("text-3xl font-semibold tabular-nums", rateTone)}>{ratePct == null ? "-" : `${ratePct}%`}</div>
                <div className="text-[11px] uppercase tracking-wide text-content-soft">completion</div>
              </div>
            </RadialGauge>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={Activity} label="Jobs analyzed" value={s ? compact(s.jobs) : "-"} />
            <Stat icon={Loader2} label="In flight now" value={s ? fmt(s.inFlight, 0) : "-"} tone="text-primary" />
            <Stat icon={Coins} label="Paid (sample)" value={s ? `${compact(s.earnings)}` : "-"} tone="text-success" />
            <Stat icon={ShieldCheck} label="Incomplete" value={s ? fmt(s.incomplete + s.disputed, 0) : "-"} tone={s && s.incomplete + s.disputed > 0 ? "text-warning" : "text-content-primary"} />
          </div>
        </div>
      )}
    </Card>
  );
}
