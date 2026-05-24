import { CheckCircle2, Coins, ShieldCheck, Activity, Cpu } from "lucide-react";

/**
 * Stylized product preview for the hero — a faux app window showing the worker
 * dashboard. Pure presentation (no live data), tuned to the LightNode palette.
 */
export function HeroPreview() {
  const tiles = [
    { icon: CheckCircle2, label: "Jobs completed", value: "1,284", tone: "text-content-primary" },
    { icon: Coins, label: "LCAI earned", value: "20.54", tone: "text-success" },
    { icon: ShieldCheck, label: "Stake", value: "50K", tone: "text-content-primary" },
    { icon: Activity, label: "Last seen", value: "8s ago", tone: "text-success" },
  ];
  return (
    <div className="relative mx-auto mt-14 max-w-3xl">
      <div className="absolute -inset-x-10 -top-10 h-40 glow-radial" />
      <div className="relative overflow-hidden rounded-2xl border border-bdr-soft bg-card/70 shadow-[0_24px_80px_-20px_rgba(112,100,233,0.35)] backdrop-blur-sm">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-bdr-soft px-4 py-3">
          <span className="size-3 rounded-full bg-destructive/70" />
          <span className="size-3 rounded-full bg-warning/70" />
          <span className="size-3 rounded-full bg-success/70" />
          <div className="ml-3 flex items-center gap-2 rounded-md bg-surface-base-faint px-2.5 py-1 text-xs text-content-soft">
            <Cpu className="size-3" /> lightnode · dashboard
          </div>
        </div>

        <div className="p-5">
          {/* worker header row */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bdr-soft bg-surface-base-subtle p-4">
            <div className="flex items-center gap-2.5">
              <span className="size-2.5 rounded-full bg-success animate-pulse-dot" />
              <span className="font-mono text-sm text-content-primary">0x1F89…5EB5</span>
              <span className="rounded-full border border-success/30 bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                Live
              </span>
              <span className="rounded-full border border-primary/30 bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                llama3-8b
              </span>
            </div>
            <span className="text-xs text-content-soft">earning · 0.016 LCAI / job</span>
          </div>

          {/* stat tiles */}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl border border-bdr-soft bg-card/60 p-3.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-content-soft">
                  <t.icon className="size-3.5" />
                  <span className="text-[11px] font-medium">{t.label}</span>
                </div>
                <div className={`text-xl font-semibold tracking-tight ${t.tone}`}>{t.value}</div>
              </div>
            ))}
          </div>

          {/* faux jobs feed */}
          <div className="mt-3 space-y-1.5">
            {[
              { id: "#617", verdict: "completed", t: "8s" },
              { id: "#613", verdict: "completed", t: "1m" },
              { id: "#608", verdict: "completed", t: "2m" },
            ].map((j) => (
              <div key={j.id} className="flex items-center justify-between rounded-lg bg-surface-base-faint px-3 py-2 text-xs">
                <span className="font-mono text-content-soft">job {j.id}</span>
                <span className="inline-flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="size-3.5" /> {j.verdict}
                </span>
                <span className="text-content-soft">{j.t} ago</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
