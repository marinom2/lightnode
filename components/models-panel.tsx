"use client";

import { useEffect, useState } from "react";
import { Box, Coins, Hash } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { fromWei, fmt } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { ModelInfo } from "@/lib/subgraph";

export function ModelsPanel({ compactHeader = false }: { compactHeader?: boolean }) {
  const { network } = useNetwork();
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let on = true;
    setModels(null);
    setErr(false);
    fetch(`/api/models?net=${network}`)
      .then((r) => r.json())
      .then((j) => on && (j.ok ? setModels(j.models) : setErr(true)))
      .catch(() => on && setErr(true));
    return () => {
      on = false;
    };
  }, [network]);

  return (
    <div>
      {!compactHeader && (
        <div className="mb-3 flex items-center gap-2">
          <Box className="size-4 text-content-soft" />
          <h3 className="text-sm font-semibold text-content-primary">Models on the network</h3>
          <span className="text-xs text-content-soft">— what workers can serve & the per-job fee</span>
        </div>
      )}

      {err && !models && <p className="text-sm text-content-soft">Model registry unavailable right now.</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {(models ?? skeleton).map((m, i) => {
          const loading = !models;
          return (
            <div
              key={m.id ?? i}
              className="rounded-xl border border-bdr-soft bg-card/50 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-medium text-content-primary">
                  {loading ? "—" : m.name}
                </span>
                {!loading &&
                  (m.is_enabled && m.is_whitelisted ? (
                    <Badge tone="success">live</Badge>
                  ) : (
                    <Badge tone="muted">{m.is_whitelisted ? "registered" : "candidate"}</Badge>
                  ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-surface-base-subtle p-2">
                  <div className="flex items-center gap-1 text-content-soft">
                    <Coins className="size-3" /> Fee
                  </div>
                  <div className="mt-0.5 font-medium text-content-primary">
                    {loading ? "—" : `${fmt(fromWei(m.fee), 3)} LCAI`}
                  </div>
                </div>
                <div className="rounded-lg bg-surface-base-subtle p-2">
                  <div className="flex items-center gap-1 text-content-soft">
                    <Hash className="size-3" /> Max output
                  </div>
                  <div className="mt-0.5 font-medium text-content-primary">
                    {loading ? "—" : `${fmt(m.max_output_tokens, 0)} tok`}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const skeleton: ModelInfo[] = [
  { id: "s1", name: "—", fee: "0", max_output_tokens: 0, is_whitelisted: false, is_enabled: false },
  { id: "s2", name: "—", fee: "0", max_output_tokens: 0, is_whitelisted: false, is_enabled: false },
];
