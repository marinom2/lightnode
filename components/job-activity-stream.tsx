"use client";

/**
 * Live job-activity stream: the network's most recent inference jobs ticking in,
 * with their model, worker, state, payout, and age. Polls /api/jobs-stream on a
 * fast interval - the "this network is alive" moment for a visitor. Read-only.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Radio, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmt, shortAddr, timeAgo, cn } from "@/lib/utils";
import { useNetwork } from "@/lib/network-context";

interface JobRow {
  id: string;
  state: string;
  model: string | null;
  worker: string | null;
  shareLcai: number;
  submittedAt: number;
}

function stateTone(state: string): "success" | "brand" | "danger" | "warning" {
  const s = state.toLowerCase();
  if (/complet|releas|resolv|paid/.test(s)) return "success";
  if (/timed|disput|expired/.test(s)) return "danger";
  if (/ack/.test(s)) return "warning";
  return "brand"; // submitted / other
}

export function JobActivityStream() {
  const { network } = useNetwork();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let on = true;
    setJobs(null);
    setErr(false);
    const load = () =>
      fetch(`/api/jobs-stream?net=${network}`)
        .then((r) => r.json())
        .then((j) => on && (j.ok ? setJobs(j.jobs ?? []) : setErr(true)))
        .catch(() => on && setErr(true));
    load();
    const t = setInterval(load, 8_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [network]);

  const rows = (jobs ?? []).slice(0, 18);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-bdr-soft px-5 py-4">
        <Radio className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-content-primary">Live job activity</h2>
        <span className="text-xs text-content-soft">newest inference jobs</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-content-soft">
          <span className={cn("size-1.5 rounded-full", jobs && !err ? "animate-pulse bg-success" : "bg-content-soft")} /> live
        </span>
      </div>
      {err && !jobs && <p className="px-5 py-8 text-center text-sm text-content-soft">Job stream unavailable right now.</p>}
      <div className="max-h-96 divide-y divide-bdr-light overflow-y-auto">
        {(rows.length ? rows : jobs ? [] : Array.from({ length: 8 }, () => null)).map((j, i) => (
          <div key={j?.id ?? i} className="flex items-center gap-3 px-5 py-2.5 text-sm">
            <span className="w-16 shrink-0 truncate font-mono text-xs text-content-soft">#{j?.id ?? "-"}</span>
            <span className="flex-1 truncate text-content-primary">{j?.model ?? (j ? "model" : "-")}</span>
            <Link
              href={`/worker/${j?.worker ?? ""}`}
              className="hidden w-24 shrink-0 truncate font-mono text-xs text-content-soft hover:text-primary sm:block"
            >
              {j?.worker ? shortAddr(j.worker) : ""}
            </Link>
            {j ? <Badge tone={stateTone(j.state)}>{j.state}</Badge> : <span className="w-16" />}
            <span className="hidden w-20 shrink-0 text-right text-success md:block">{j && j.shareLcai > 0 ? `+${fmt(j.shareLcai, 3)}` : ""}</span>
            <span className="w-14 shrink-0 text-right text-xs text-content-soft">{j?.submittedAt ? timeAgo(j.submittedAt) : ""}</span>
          </div>
        ))}
        {jobs && rows.length === 0 && !err && <p className="px-5 py-8 text-center text-sm text-content-soft">No recent jobs yet.</p>}
      </div>
    </Card>
  );
}
