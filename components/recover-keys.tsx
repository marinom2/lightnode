"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Eye, EyeOff, Copy, Check, RotateCcw, AlertTriangle, ExternalLink, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "@/lib/network";
import {
  listRetiredWorkers,
  getSecret,
  setSecret,
  getWorkerAddr,
  setWorkerAddr,
  archiveRetiredWorker,
  SECRET_WORKER_KEY,
  SECRET_WORKER_PW,
  type RetiredWorker,
} from "@/lib/secrets";
import { useSavedWorkers } from "@/lib/saved-workers";
import { fetchWorker, type Worker } from "@/lib/subgraph";
import { fromWei, fmt, timeAgo, shortAddr } from "@/lib/utils";
import { openExternal } from "@/lib/tauri";

/** A small copy-to-clipboard pill. */
function Copyable({ id, value, copiedId, onCopy }: { id: string; value: string; copiedId: string; onCopy: (id: string, v: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(id, value)}
      className="inline-flex items-center gap-1 text-[11px] text-content-soft transition-colors hover:text-content-primary"
    >
      {copiedId === id ? <Check className="size-3 text-success" /> : <Copy className="size-3" />} {copiedId === id ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Recover a worker key you replaced. When you generate a new key over an existing
 * one, the old key (+ its keystore password + address) is archived on this device
 * so a worker that still holds a stake is never lost. This lists those, flags any
 * that are still staked on-chain, and lets you restore one as the active worker.
 */
export function RecoverKeys() {
  const { network } = useNetwork();
  const net = NETWORKS[network];
  const savedWorkers = useSavedWorkers();
  const [entries, setEntries] = useState<RetiredWorker[]>([]);
  const [onchain, setOnchain] = useState<Record<string, Worker | null>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState("");
  const [restored, setRestored] = useState("");

  const refresh = useCallback(() => {
    const list = listRetiredWorkers(network);
    setEntries(list);
    setReveal({});
    setRestored("");
    list.forEach((e) => {
      fetchWorker(network, e.addr)
        .then((w) => setOnchain((m) => ({ ...m, [e.addr.toLowerCase()]: w })))
        .catch(() => {});
    });
  }, [network]);

  useEffect(() => refresh(), [refresh]);

  const copy = (id: string, v: string) => {
    navigator.clipboard.writeText(v).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(""), 1200);
    });
  };

  const restore = async (e: RetiredWorker) => {
    // Archive the CURRENT active key first (it may also control a stake), then
    // make this retired one active for the network.
    const cur = await getSecret(SECRET_WORKER_KEY, network);
    if (cur && cur !== e.key) {
      await archiveRetiredWorker(network, getWorkerAddr(network), cur, await getSecret(SECRET_WORKER_PW, network));
    }
    await setSecret(SECRET_WORKER_KEY, e.key, network);
    if (e.pw) await setSecret(SECRET_WORKER_PW, e.pw, network);
    setWorkerAddr(network, e.addr);
    savedWorkers.add(e.addr);
    setRestored(e.addr);
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-inset ring-primary/30">
          <KeyRound className="size-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-content-primary">Recover a replaced key</h2>
          <p className="text-sm text-content-soft">
            Keys you replaced on <span className="text-content-primary">{net.label}</span> are kept here so a worker that still
            holds a stake is never lost. Reveal &amp; back one up, or restore it as your active worker.
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <Card className="p-6 text-center">
          <ShieldCheck className="mx-auto mb-2 size-6 text-success" />
          <p className="text-sm text-content-primary">No replaced keys for {net.label}.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-content-soft">
            If you ever click &quot;New key&quot; over an existing worker, the old key is archived here automatically - so you can
            always get back to a staked worker.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((e, i) => {
            const w = onchain[e.addr.toLowerCase()];
            const registered = !!w && w.status !== "deregistered";
            const staked = registered ? fromWei(w!.stake) : 0;
            const shown = reveal[e.addr];
            const restoredNow = restored.toLowerCase() === e.addr.toLowerCase();
            return (
              <Card key={`${e.addr}-${i}`} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-content-primary">{shortAddr(e.addr)}</span>
                    <Copyable id={`${e.addr}-addr`} value={e.addr} copiedId={copiedId} onCopy={copy} />
                    <button
                      type="button"
                      onClick={() => openExternal(`${net.explorer}/address/${e.addr}`)}
                      className="text-content-soft transition-colors hover:text-content-primary"
                      title="View on explorer"
                    >
                      <ExternalLink className="size-3.5" />
                    </button>
                  </div>
                  {registered ? (
                    <Badge tone="warning">Still staked · {fmt(staked, 0)} LCAI</Badge>
                  ) : w === null ? (
                    <Badge tone="default">Not registered</Badge>
                  ) : (
                    <Badge tone="default">Checking…</Badge>
                  )}
                </div>

                <p className="mt-1.5 text-[11px] text-content-soft">Replaced {timeAgo(e.ts / 1000)}</p>

                {registered && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warning/10 px-2.5 py-2 text-[11px] text-warning">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" /> This worker still holds a stake on-chain. Restore it
                    (or import this key) to settle/withdraw or deregister and reclaim the {fmt(staked, 0)} LCAI.
                  </p>
                )}

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setReveal((m) => ({ ...m, [e.addr]: !m[e.addr] }))}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:underline"
                  >
                    {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {shown ? "Hide" : "Reveal key + password"}
                  </button>
                  {restoredNow ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                      <Check className="size-4" /> Restored - it&apos;s now your active {net.label} worker
                    </span>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => restore(e)}>
                      <RotateCcw className="size-3.5" /> Restore as active worker
                    </Button>
                  )}
                </div>

                {shown && (
                  <div className="mt-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-warning/10 px-2.5 py-2">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wide text-content-soft">Private key</div>
                        <code className="block truncate font-mono text-[11px] text-content-default">{e.key}</code>
                      </div>
                      <Copyable id={`${e.addr}-pk`} value={e.key} copiedId={copiedId} onCopy={copy} />
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-base-subtle/60 px-2.5 py-2">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wide text-content-soft">Keystore password</div>
                        <code className="block truncate font-mono text-[11px] text-content-default">{e.pw || "(none saved)"}</code>
                      </div>
                      {e.pw && <Copyable id={`${e.addr}-pw`} value={e.pw} copiedId={copiedId} onCopy={copy} />}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
