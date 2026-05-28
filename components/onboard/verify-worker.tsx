"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, Search, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNetwork } from "@/lib/network-context";
import { useSavedWorkers } from "@/lib/saved-workers";
import { getWorkerAddr } from "@/lib/secrets";
import { isDesktop } from "@/lib/tauri";
import { fmt, shortAddr } from "@/lib/utils";
import type { Worker } from "@/lib/subgraph";

type Phase = "idle" | "watching" | "found" | "registered";

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Closes the onboarding loop. On desktop the app already knows the worker
 * address it just set up, so we prefill it and start watching automatically; on
 * web you paste the address the setup printed. Either way we poll the subgraph
 * until it appears registered + live.
 */
export function VerifyWorker() {
  const { network } = useNetwork();
  const { add, has } = useSavedWorkers();
  const [addr, setAddr] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [worker, setWorker] = useState<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const valid = ADDR_RE.test(addr);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const start = useCallback((target: string) => {
    if (!ADDR_RE.test(target)) return;
    setPhase("watching");
    setWorker(null);
    const poll = async () => {
      try {
        const r = await fetch(`/api/worker?net=${network}&address=${target}`).then((x) => x.json());
        if (r.ok && r.worker) {
          setWorker(r.worker);
          setPhase(r.live ? "registered" : "found");
          if (r.live) stop();
        }
      } catch {
        /* keep polling */
      }
    };
    poll();
    stop();
    timer.current = setInterval(poll, 5000);
  }, [network]);

  // Prefill this network's known worker address; on desktop, start watching it.
  useEffect(() => {
    stop();
    setPhase("idle");
    const a = getWorkerAddr(network);
    if (ADDR_RE.test(a)) {
      setAddr(a);
      if (isDesktop()) start(a);
    } else {
      setAddr("");
    }
  }, [network, start]);

  return (
    <div className="rounded-xl border border-bdr-soft bg-surface-base-subtle p-4 text-left">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={addr}
          onChange={(e) => setAddr(e.target.value.trim())}
          placeholder="0x... your worker address"
          className="h-10 flex-1 rounded-lg border border-bdr-soft bg-card/60 px-3 font-mono text-sm text-content-primary outline-none focus:border-primary"
        />
        <Button variant="gradient" disabled={!valid || phase === "watching"} onClick={() => start(addr)}>
          {phase === "watching" ? <Loader2 className="animate-spin" /> : <Search />} Verify
        </Button>
      </div>

      {phase === "watching" && (
        <p className="mt-3 inline-flex items-center gap-2 text-sm text-content-soft">
          <Loader2 className="size-4 animate-spin" /> Watching the network for {shortAddr(addr)} - this appears once
          <code className="rounded bg-surface-base-light px-1">07-register</code> lands...
        </p>
      )}

      {phase === "found" && (
        <p className="mt-3 inline-flex items-center gap-2 text-sm text-warning">
          <CheckCircle2 className="size-4" /> Registered, waiting for the first heartbeat - make sure{" "}
          <code className="rounded bg-surface-base-light px-1">08-run-worker</code> is running.
        </p>
      )}

      {phase === "registered" && worker && (
        <div className="mt-3">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-success">
            <PartyPopper className="size-4" /> Live on {network}! {fmt(worker.jobs_completed ?? 0, 0)} jobs completed so far.
          </p>
          {!has(addr) && (
            <Button variant="outline" size="sm" className="mt-2" onClick={() => add(addr)}>
              Add to my watchlist
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
