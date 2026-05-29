"use client";

import { useEffect, useState } from "react";
import { Box, Check, CircleAlert, AlertTriangle } from "lucide-react";
import { modelRequirement, modelsMemoryGb } from "@/lib/hardware";
import { fromWei, cn } from "@/lib/utils";
import type { NetworkId } from "@/lib/network";

interface LiveModel {
  name: string;
  fee: string; // wei
  max_output_tokens: number;
}

/**
 * Choose which model(s) the worker serves. The list is the selected network's
 * live whitelist (so it grows as the registry adds models). A worker can serve
 * several at once, but every model it picks must stay resident in memory at the
 * same time, so we sum their rough footprints and warn when the set won't fit the
 * detected machine (a cold-load mid-job is what gets a worker slashed).
 */
export function ModelPicker({
  network,
  vramGb,
  value,
  onChange,
  locked = [],
}: {
  network: NetworkId;
  vramGb: number;
  value: string[];
  onChange: (models: string[]) => void;
  // Models that are already committed and can't be unselected here (e.g. a
  // running worker's current set - you can add, but dropping one needs deregister).
  locked?: string[];
}) {
  const [models, setModels] = useState<LiveModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    setLoading(true);
    fetch(`/api/models?net=${network}`)
      .then((r) => r.json())
      .then((j) => {
        if (!on || !j.ok) return;
        const live: LiveModel[] = (j.models ?? [])
          .filter((m: { is_enabled: boolean; is_whitelisted: boolean }) => m.is_enabled && m.is_whitelisted)
          .map((m: LiveModel) => ({ name: m.name, fee: m.fee, max_output_tokens: m.max_output_tokens }));
        setModels(live);
        // Keep selections that are still live; if none remain, pick the lightest
        // model that fits the machine.
        if (live.length) {
          const stillLive = value.filter((v) => live.some((m) => m.name === v));
          if (stillLive.length === 0) {
            const fits = live.filter((m) => modelRequirement(m.name).vramGb <= (vramGb || 0));
            const best = (fits.length ? fits : live).sort((a, b) => modelRequirement(a.name).vramGb - modelRequirement(b.name).vramGb)[0];
            onChange([best.name]);
          } else if (stillLive.length !== value.length) {
            onChange(stillLive);
          }
        }
      })
      .catch(() => {})
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  const avail = vramGb || 0;
  const total = modelsMemoryGb(value);
  const over = avail > 0 && total > avail;

  const toggle = (name: string) => {
    if (locked.includes(name)) return; // committed - can't unselect here
    if (value.includes(name)) {
      if (value.length === 1) return; // keep at least one selected
      onChange(value.filter((m) => m !== name));
    } else {
      onChange([...value, name]);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-content-soft">
        <Box className="size-4" />
        <span className="text-sm font-medium">Models to serve</span>
        <span className="text-xs">your worker serves every model you pick</span>
      </div>

      {loading && models.length === 0 ? (
        <div className="h-16 animate-pulse rounded-xl border border-bdr-soft bg-card/50" />
      ) : models.length === 0 ? (
        <p className="rounded-xl border border-bdr-soft bg-card/50 p-3 text-sm text-content-soft">
          No live models on {network} right now. Setup will use the default once one is whitelisted.
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {models.map((m) => {
              const req = modelRequirement(m.name);
              const fitsAlone = (vramGb || 0) >= req.vramGb;
              const selected = value.includes(m.name);
              const tooBig = avail > 0 && req.vramGb > avail; // can't even fit by itself
              const isLocked = locked.includes(m.name);
              return (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => toggle(m.name)}
                  aria-pressed={selected}
                  disabled={isLocked}
                  title={isLocked ? "Already serving this - it can't be removed here" : undefined}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-left transition-all",
                    selected
                      ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30"
                      : "border-bdr-soft bg-card/50 hover:border-primary/40",
                    isLocked && "cursor-default opacity-90",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border",
                      selected ? "border-primary bg-primary text-white" : "border-bdr-soft",
                    )}
                  >
                    {selected && <Check className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-sm font-medium text-content-primary">
                        {m.name}
                        {isLocked && <span className="ml-1.5 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">serving</span>}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-content-soft">{fromWei(m.fee)} LCAI</span>
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-[11px]">
                      {fitsAlone ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <Check className="size-3" /> ~{req.vramGb}GB
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <CircleAlert className="size-3" /> Needs ~{req.vramGb}GB
                        </span>
                      )}
                      <span aria-hidden className="h-3 w-px bg-bdr-soft" />
                      <span className="text-content-soft">{req.tierLabel}</span>
                    </span>
                    {tooBig && !selected && (
                      <span className="mt-1 block text-[11px] text-warning">Larger than this machine&apos;s memory on its own.</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* memory gate */}
          <div className={cn("mt-3 rounded-xl border p-3 text-xs", over ? "border-warning/40 bg-warning/10" : "border-bdr-soft bg-surface-base-subtle/40")}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-content-soft">
                Memory to keep {value.length === 1 ? "it" : "them all"} warm
              </span>
              <span className="font-semibold tabular-nums text-content-primary">
                ~{total}GB{avail > 0 && ` of ~${avail}GB`}
              </span>
            </div>
            {over && (
              <p className="mt-2 flex items-start gap-1.5 text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                These models need about {total}GB resident at once, but this machine has about {avail}GB. They would
                cold-load between jobs and risk a slash. Deselect one, or run them on a bigger machine.
              </p>
            )}
            {!over && value.length > 1 && (
              <p className="mt-1.5 text-content-soft">
                Your worker will advertise all {value.length} and earn from each job type. They stay loaded together.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
