"use client";

import { useEffect, useState } from "react";
import { Box, Check, CircleAlert } from "lucide-react";
import { modelRequirement } from "@/lib/hardware";
import { fromWei, cn } from "@/lib/utils";
import type { NetworkId } from "@/lib/network";

interface LiveModel {
  name: string;
  fee: string; // wei
  max_output_tokens: number;
}

/**
 * Choose which model the worker serves. The list is driven entirely by the
 * selected network's live whitelist (so mainnet and testnet show their own
 * models, and it grows automatically as the registry adds more). Each model is
 * tagged with a rough hardware requirement and a fit check against the detected
 * machine - a worker only serves the model it picks, so 10 models is fine.
 */
export function ModelPicker({
  network,
  vramGb,
  value,
  onChange,
}: {
  network: NetworkId;
  vramGb: number;
  value: string;
  onChange: (model: string) => void;
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
        // Keep the current pick if still live; otherwise pick the lightest one that fits.
        if (live.length && !live.some((m) => m.name === value)) {
          const fits = live.filter((m) => modelRequirement(m.name).vramGb <= (vramGb || 0));
          const best = (fits.length ? fits : live).sort((a, b) => modelRequirement(a.name).vramGb - modelRequirement(b.name).vramGb)[0];
          onChange(best.name);
        }
      })
      .catch(() => {})
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-content-soft">
        <Box className="size-4" />
        <span className="text-sm font-medium">Model to serve</span>
        <span className="text-xs">your worker only serves what you pick</span>
      </div>

      {loading && models.length === 0 ? (
        <div className="h-16 animate-pulse rounded-xl border border-bdr-soft bg-card/50" />
      ) : models.length === 0 ? (
        <p className="rounded-xl border border-bdr-soft bg-card/50 p-3 text-sm text-content-soft">
          No live models on {network} right now. Setup will use the default once one is whitelisted.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {models.map((m) => {
            const req = modelRequirement(m.name);
            const fits = (vramGb || 0) >= req.vramGb;
            const selected = value === m.name;
            return (
              <button
                key={m.name}
                type="button"
                onClick={() => onChange(m.name)}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3 text-left transition-all",
                  selected
                    ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30"
                    : "border-bdr-soft bg-card/50 hover:border-primary/40",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                    selected ? "border-primary bg-primary text-white" : "border-bdr-soft",
                  )}
                >
                  {selected && <Check className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-sm font-medium text-content-primary">{m.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-content-soft">{fromWei(m.fee)} LCAI</span>
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 text-[11px]">
                    {fits ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <Check className="size-3" /> Fits your machine
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <CircleAlert className="size-3" /> Needs ~{req.vramGb}GB
                      </span>
                    )}
                    <span className="text-content-soft">· {req.tierLabel}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
