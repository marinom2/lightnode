/** Worker hub: own worker status + lifetime stats, or the network pitch. */
import { useEffect, useState } from "react";
import { wallet, type WorkerStatusView } from "./wallet-api";
import { humanizeError } from "../../src/rpc/humanize";
import { Ic, Stat, Sheet } from "./shared";

type NetStats = { totalWorkers: number; activeWorkers: number; jobsCompleted: number; totalEarnedLcai: number; minStakeLcai: number; capped: boolean };
type Lifetime = { jobsCompleted: number; jobsTimedOut: number; lifetimeEarnedLcai: number; lastSeenAt: string | null } | null;
type ModelView = { modelId: string; active: boolean };
type FeeSplit = { workerBps: number; protocolBps: number; poolBps: number };

/** How every job fee splits; workers keep the lion's share. */
function FeeSplitBar({ p }: { p: FeeSplit }) {
  const total = p.workerBps + p.protocolBps + p.poolBps;
  if (total <= 0) return null;
  const pct = (n: number) => `${((n / total) * 100).toFixed(0)}%`;
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="faint" style={{ marginBottom: 5 }}>Every job fee splits</div>
      <div className="votebar">
        <span className="vb-for" style={{ width: pct(p.workerBps) }} />
        <span className="vb-abstain" style={{ width: pct(p.protocolBps) }} />
        <span className="vb-against" style={{ width: pct(p.poolBps) }} />
      </div>
      <div className="row between faint" style={{ fontSize: 10.5 }}>
        <span>Worker {pct(p.workerBps)}</span><span>Protocol {pct(p.protocolBps)}</span><span>Fee pool {pct(p.poolBps)}</span>
      </div>
    </div>
  );
}

export function WorkerSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const [status, setStatus] = useState<WorkerStatusView | null | undefined>(undefined);
  const [net, setNet] = useState<NetStats | null>(null);
  const [life, setLife] = useState<Lifetime>(null);
  const [models, setModels] = useState<ModelView[]>([]);
  const [fees, setFees] = useState<FeeSplit | null>(null);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    wallet<WorkerStatusView>({ type: "workerStatus", address }).then((r) => { if (live) setStatus(r); }).catch(() => { if (live) setStatus(null); });
    wallet<NetStats>({ type: "networkStats" }).then((r) => { if (live) setNet(r); }).catch(() => {});
    wallet<{ lifetime: Lifetime }>({ type: "workerLifetime", address }).then((r) => { if (live) setLife(r.lifetime); }).catch(() => {});
    wallet<{ models: ModelView[] }>({ type: "workerModels", address }).then((r) => { if (live) setModels(r.models); }).catch(() => {});
    wallet<FeeSplit>({ type: "protocolParams" }).then((r) => { if (live) setFees(r); }).catch(() => {});
    return () => { live = false; };
  }, [address]);
  const withdraw = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await wallet<{ hash: string }>({ type: "withdrawRewards", from: address });
      setHash(r.hash);
    } catch (e) {
      setErr(humanizeError((e as Error).message, "LCAI"));
    } finally {
      setBusy(false);
    }
  };
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <Sheet title="Worker hub" onClose={onClose} busy={busy}>
        {status === undefined && <span className="skel" style={{ width: 160 }} />}
        {status === null && (
          <div className="empty">
            <div className="empty-ic"><Ic name="server" size={20} /></div>
            Could not reach the worker registry.
            <button className="ghost" style={{ fontSize: 12, marginTop: 10 }} onClick={onClose}>Close</button>
          </div>
        )}
        {status?.registered && (
          <>
            <div className="stat-grid">
              <Stat label="Stake" value={`${fmt(status.stakeLcai)} LCAI`} />
              <Stat label="Headroom" value={`${fmt(status.headroomLcai)} LCAI`} tone={status.belowFloor ? "err" : undefined} />
              <Stat label="Claimable" value={`${fmt(status.claimableLcai)} LCAI`} tone={status.claimableLcai > 0 ? "ok" : undefined} />
              <Stat label="Jobs done" value={life ? String(life.jobsCompleted) : "…"} />
              <Stat label="Lifetime earned" value={life ? `${fmt(life.lifetimeEarnedLcai)} LCAI` : "…"} />
              <Stat label="Timeouts" value={life ? String(life.jobsTimedOut) : "…"} />
            </div>
            {status.belowFloor && <p className="warn">Below the stake floor. Top up to keep earning.</p>}
            {hash ? (
              <p className="ok">Withdrawal submitted. <a href={`https://mainnet.lightscan.app/tx/${hash}`} target="_blank" rel="noreferrer">View →</a></p>
            ) : (
              <button disabled={busy || status.claimableLcai <= 0} onClick={withdraw}>{busy ? "Withdrawing…" : `Withdraw ${fmt(status.claimableLcai)} LCAI`}</button>
            )}
            {err && <p className="err">{err}</p>}
            {models.length > 0 && (
              <div>
                <div className="faint" style={{ marginBottom: 6 }}>Models served</div>
                <div className="chips" style={{ flexWrap: "wrap" }}>
                  {models.map((m) => (
                    <span key={m.modelId} className={`chip${m.active ? " active" : ""}`} style={{ cursor: "default" }}>{m.modelId}</span>
                  ))}
                </div>
              </div>
            )}
            {fees && <FeeSplitBar p={fees} />}
            <button style={{ width: "100%" }} onClick={() => window.open(`https://lightnode.app/worker/${address}`, "_blank", "noopener")}>Full dashboard + operations →</button>
            <p className="faint">Docker operations (restart, logs, settle, exit) run from the LightNode console; everything financial works right here.</p>
          </>
        )}
        {status && !status.registered && (
          <>
            <p className="muted">This account is not a registered worker. Here is the network it could join:</p>
            <div className="stat-grid">
              <Stat label="Workers" value={net ? `${net.totalWorkers}${net.capped ? "+" : ""}` : "…"} />
              <Stat label="Active" value={net ? String(net.activeWorkers) : "…"} />
              <Stat label="Jobs completed" value={net ? net.jobsCompleted.toLocaleString() : "…"} />
              <Stat label="LCAI paid out" value={net ? fmt(net.totalEarnedLcai) : "…"} tone="ok" />
              <Stat label="Min stake" value={net ? `${fmt(net.minStakeLcai)} LCAI` : "…"} />
              <Stat label="Network" value="LightChain" />
            </div>
            {fees && <FeeSplitBar p={fees} />}
            <p className="faint">A worker is a machine serving AI inference jobs. It stakes LCAI, earns per job, and runs from a one-click installer.</p>
            <button style={{ width: "100%" }} onClick={() => window.open("https://lightnode.app/onboard", "_blank", "noopener")}>Become a worker →</button>
          </>
        )}
    </Sheet>
  );
}
