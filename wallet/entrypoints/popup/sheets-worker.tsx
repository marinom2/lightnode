/** Worker hub: own worker status + lifetime stats, or the network pitch. */
import { useEffect, useState } from "react";
import { wallet, type WorkerStatusView } from "./wallet-api";
import { humanizeError } from "../../src/rpc/humanize";
import { Ic, Stat, Sheet } from "./shared";

type NetStats = { totalWorkers: number; activeWorkers: number; jobsCompleted: number; totalEarnedLcai: number; minStakeLcai: number; capped: boolean };
type Lifetime = { jobsCompleted: number; jobsTimedOut: number; lifetimeEarnedLcai: number; lastSeenAt: string | null } | null;

export function WorkerSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const [status, setStatus] = useState<WorkerStatusView | null | undefined>(undefined);
  const [net, setNet] = useState<NetStats | null>(null);
  const [life, setLife] = useState<Lifetime>(null);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    wallet<WorkerStatusView>({ type: "workerStatus", address }).then((r) => { if (live) setStatus(r); }).catch(() => { if (live) setStatus(null); });
    wallet<NetStats>({ type: "networkStats" }).then((r) => { if (live) setNet(r); }).catch(() => {});
    wallet<{ lifetime: Lifetime }>({ type: "workerLifetime", address }).then((r) => { if (live) setLife(r.lifetime); }).catch(() => {});
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
            <a href={`https://lightnode.app/worker/${address}`} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Full dashboard + operations on LightNode →</a>
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
            <p className="faint">A worker is a machine serving AI inference jobs. It stakes LCAI, earns per job, and runs from a one-click installer.</p>
            <button style={{ width: "100%" }} onClick={() => window.open("https://lightnode.app/onboard", "_blank", "noopener")}>Become a worker →</button>
          </>
        )}
    </Sheet>
  );
}
