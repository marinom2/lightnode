"use client";

import { Gauge, Zap, Timer, Snowflake } from "lucide-react";
import { RadialGauge } from "@/components/ui/radial-gauge";
import { Badge } from "@/components/ui/badge";
import type { SpeedTestResult } from "@/lib/speedtest";

const TONES: Record<
  SpeedTestResult["verdict"],
  { grad: [string, string]; label: string; sub: string; badge: "success" | "warning" | "danger" }
> = {
  comfortable: {
    grad: ["#1fc16b", "#46e09a"],
    label: "Comfortable",
    sub: "Your machine finishes well inside the deadline - low slash risk.",
    badge: "success",
  },
  tight: {
    grad: ["#f6b51e", "#f7c948"],
    label: "Tight",
    sub: "Within the deadline, but a heavier prompt could time out. A faster GPU would help.",
    badge: "warning",
  },
  over: {
    grad: ["#e5484d", "#f2696d"],
    label: "Over the deadline",
    sub: "Worst-case jobs exceed the deadline - high risk of timed-out jobs (slash). Use a faster GPU or a lighter model.",
    badge: "danger",
  },
};

function Metric({ icon: Icon, label, value }: { icon: typeof Zap; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-bdr-soft bg-surface-base-subtle/60 p-3 text-center">
      <Icon className="mx-auto mb-1 size-4 text-content-soft" />
      <div className="text-sm font-semibold tabular-nums text-content-primary">{value}</div>
      <div className="text-[11px] text-content-soft">{label}</div>
    </div>
  );
}

/** Visual result of the Speed test: a risk dial (deadline usage) plus the three
 *  numbers that drive it, and a plain-language verdict. */
export function SpeedTestResultCard({ r }: { r: SpeedTestResult }) {
  const tone = TONES[r.verdict];
  const usage = r.worstS / r.deadlineS; // fraction of the deadline the worst case uses
  const pct = Math.round(usage * 100);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-bdr-soft bg-card/60 p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 left-1/2 size-56 -translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: `radial-gradient(circle, ${tone.grad[1]}, transparent 70%)` }}
      />
      <div className="mb-2 flex items-center gap-2">
        <Gauge className="size-4 text-content-soft" />
        <h4 className="text-sm font-semibold text-content-primary">Speed test</h4>
        {r.model && <Badge tone="muted" className="ml-auto">{r.model}</Badge>}
      </div>

      <div className="flex flex-col items-center">
        <RadialGauge value={Math.min(usage, 1)} gradient={tone.grad} size={184}>
          <div>
            <div className="text-[2.5rem] font-semibold leading-none tracking-tight tabular-nums text-content-primary">
              {Math.round(r.worstS)}
              <span className="text-xl text-content-soft">s</span>
            </div>
            <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-content-soft">
              of {Math.round(r.deadlineS)}s deadline
            </div>
            <div className="mt-1 text-[11px] tabular-nums text-content-soft">{pct}% used</div>
          </div>
        </RadialGauge>
        <Badge tone={tone.badge} className="mt-3">{tone.label}</Badge>
        <p className="mt-2 max-w-xs text-center text-xs leading-relaxed text-content-soft">{tone.sub}</p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric icon={Zap} label="decode" value={`${r.decodeToks.toFixed(1)} tok/s`} />
        <Metric icon={Timer} label="prefill" value={`${Math.round(r.prefillToks)} tok/s`} />
        <Metric icon={Snowflake} label="cold load" value={`${r.coldLoadS.toFixed(1)}s`} />
      </div>

      <p className="mt-3 text-center text-[11px] text-content-soft">
        Worst case = cold model load + a 2048-token prompt + a 1024-token answer, versus the live on-chain job deadline.
      </p>
    </div>
  );
}
