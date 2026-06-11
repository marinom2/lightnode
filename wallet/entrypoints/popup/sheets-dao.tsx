/** Governance: proposals on both governors, full reader, in-wallet voting. */
import { useCallback, useEffect, useRef, useState } from "react";
import { wallet } from "./wallet-api";
import { humanizeError } from "../../src/rpc/humanize";
import { type DaoView, Ic, short, fmtBal, Sheet } from "./shared";

type ProposalAction = { target: string; valueLcai: number; label: string; dangerous: boolean };
type ProposalRow = {
  id: string; title: string; description: string; proposer: string; state: string;
  forVotes: number; againstVotes: number; abstainVotes: number;
  blocksLeft: number | null; youVoted: boolean; yourWeight: number; actions: ProposalAction[];
};
type DaoStats = { treasuryLcai: number | null; quorumPct: number | null };
const SUPPORT_LABEL: Record<0 | 1 | 2, string> = { 1: "For", 0: "Against", 2: "Abstain" };
const STATE_TONE: Record<string, string> = { active: "tag-warn", succeeded: "tag-ok", executed: "tag-ok", queued: "tag-ok", defeated: "tag-bad", canceled: "tag-bad", expired: "tag-bad", pending: "" };

function VoteBar({ p }: { p: ProposalRow }) {
  const total = p.forVotes + p.againstVotes + p.abstainVotes;
  if (total <= 0) return <p className="faint">No votes yet.</p>;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <>
      <div className="votebar">
        <span className="vb-for" style={{ width: pct(p.forVotes) }} />
        <span className="vb-against" style={{ width: pct(p.againstVotes) }} />
        <span className="vb-abstain" style={{ width: pct(p.abstainVotes) }} />
      </div>
      <div className="row between faint" style={{ fontSize: 10.5 }}>
        <span>For {pct(p.forVotes)} · {fmtBal(String(p.forVotes))}</span>
        <span>Against {pct(p.againstVotes)} · {fmtBal(String(p.againstVotes))}</span>
        <span>Abstain {pct(p.abstainVotes)} · {fmtBal(String(p.abstainVotes))}</span>
      </div>
    </>
  );
}

/** The full reader: on-chain text, decoded actions, tallies. */
function ProposalDetail({ p, explorer }: { p: ProposalRow; explorer: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      {p.description && p.description.length > p.title.length + 4 && (
        <div className="proposal-text">{p.description}</div>
      )}
      {p.actions.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="faint" style={{ marginBottom: 4 }}>This proposal executes</div>
          {p.actions.map((a, i) => (
            <div key={i} className={a.dangerous ? "danger-box" : "card"} style={{ padding: 8, marginBottom: 4, fontSize: 11.5 }}>
              {a.dangerous && <b>PRIVILEGED. </b>}{a.label}
              <div className="addr" style={{ marginTop: 2 }}>
                <a href={`${explorer}/address/${a.target}`} target="_blank" rel="noreferrer">{short(a.target)}</a>
                {a.valueLcai > 0 && <span> · {fmtBal(String(a.valueLcai))} LCAI attached</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DaoSheet({ from, onClose }: { from: string; onClose: () => void }) {
  const [govChain, setGovChain] = useState<1 | 9200>(9200);
  const [onlyActive, setOnlyActive] = useState(false);
  const [rows, setRows] = useState<ProposalRow[] | null | undefined>(undefined);
  const [stats, setStats] = useState<DaoStats | null>(null);
  const [power, setPower] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null); // expanded proposal id
  const [voting, setVoting] = useState<string | null>(null); // proposal id in flight
  const [voted, setVoted] = useState<Record<string, string>>({}); // id -> tx hash
  const [confirm, setConfirm] = useState<{ id: string; support: 0 | 1 | 2 } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const epoch = useRef(0);
  const load = useCallback(() => {
    setRows(undefined);
    setStats(null);
    const e = ++epoch.current;
    // Guard: flipping the chain tab fires two requests; the slow one must not win.
    wallet<{ proposals: ProposalRow[] | null }>({ type: "getProposals", chainId: govChain, voter: from }).then((r) => { if (epoch.current === e) setRows(r.proposals); }).catch(() => { if (epoch.current === e) setRows(null); });
    wallet<DaoView>({ type: "daoStatus", chainId: govChain, address: from }).then((r) => { if (epoch.current === e) setPower(r.supported ? Number(r.votingPower) : null); }).catch(() => { if (epoch.current === e) setPower(null); });
    wallet<DaoStats>({ type: "daoStats", chainId: govChain }).then((r) => { if (epoch.current === e) setStats(r); }).catch(() => {});
  }, [govChain, from]);
  useEffect(load, [load]);
  const govSymbol = govChain === 1 ? "ETH" : "LCAI";
  const vote = async (id: string, support: 0 | 1 | 2) => {
    setConfirm(null);
    setVoting(id);
    setErr(null);
    try {
      const r = await wallet<{ hash: string }>({ type: "castVote", from, chainId: govChain, proposalId: id, support });
      setVoted((v) => ({ ...v, [id]: r.hash }));
    } catch (e) {
      setErr(humanizeError((e as Error).message, govSymbol));
    } finally {
      setVoting(null);
    }
  };
  const shown = (rows ?? []).filter((p) => !onlyActive || p.state === "active");
  const explorer = govChain === 1 ? "https://etherscan.io" : "https://mainnet.lightscan.app";
  return (
    <Sheet title="Governance" onClose={onClose} busy={voting !== null}>
        <div className="tabs">
          <button className={`tab${govChain === 9200 ? " active" : ""}`} onClick={() => setGovChain(9200)}>LightChain</button>
          <button className={`tab${govChain === 1 ? " active" : ""}`} onClick={() => setGovChain(1)}>Ethereum</button>
        </div>
        <div className="stat-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div className="stat"><div className="faint">Treasury</div><b>{stats == null ? "…" : stats.treasuryLcai == null ? "--" : `${fmtBal(String(stats.treasuryLcai))} LCAI`}</b></div>
          <div className="stat"><div className="faint">Quorum</div><b>{stats == null ? "…" : stats.quorumPct == null ? "--" : `${stats.quorumPct}% of supply`}</b></div>
          <div className="stat"><div className="faint">Your power</div><b>{power == null ? "…" : power.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></div>
        </div>
        <div className="chips">
          <button className={`chip${!onlyActive ? " active" : ""}`} onClick={() => setOnlyActive(false)}>All</button>
          <button className={`chip${onlyActive ? " active" : ""}`} onClick={() => setOnlyActive(true)}>Active</button>
        </div>
        {rows === undefined && [0, 1].map((i) => <div className="card" key={i}><span className="skel" style={{ width: 180 }} /><div style={{ marginTop: 8 }}><span className="skel" style={{ width: 120 }} /></div></div>)}
        {rows === null && (
          <div className="empty">
            <div className="empty-ic"><Ic name="gov" size={20} /></div>
            Could not load proposals right now.
            <button className="ghost" style={{ fontSize: 12, marginTop: 10 }} onClick={load}>Try again</button>
          </div>
        )}
        {rows && shown.length === 0 && <div className="empty">No {onlyActive ? "active " : ""}proposals found on this governor.</div>}
        {shown.map((p) => (
          <div className="card card-tappable" key={p.id} role="button" tabIndex={0}
            onClick={() => setOpen(open === p.id ? null : p.id)}
            onKeyDown={(e) => e.key === "Enter" && setOpen(open === p.id ? null : p.id)}>
            <div className="row between">
              <span className={`tag ${STATE_TONE[p.state] ?? ""}`} style={{ marginLeft: 0 }}>{p.state}</span>
              <span className="faint">{p.blocksLeft != null ? `~${p.blocksLeft.toLocaleString()} blocks left` : `#${p.id.slice(0, 8)}…`} <Ic name="chevron" size={11} /></span>
            </div>
            <b style={{ fontSize: 13, display: "block", marginTop: 6 }}>{p.title}</b>
            <p className="faint" style={{ margin: "4px 0 8px" }}>by {short(p.proposer)}</p>
            <VoteBar p={p} />
            {open === p.id && <ProposalDetail p={p} explorer={explorer} />}
            {voted[p.id] ? (
              <p className="ok" style={{ marginTop: 8 }}>Vote submitted. <a href={`${explorer}/tx/${voted[p.id]}`} target="_blank" rel="noreferrer">View →</a></p>
            ) : p.youVoted ? (
              <p className="faint" style={{ marginTop: 8 }}>You have already voted on this proposal.</p>
            ) : p.state === "active" && p.yourWeight > 0 ? (
              confirm?.id === p.id ? (
                <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                  <p className="faint">Vote <b>{SUPPORT_LABEL[confirm.support]}</b> with {p.yourWeight.toLocaleString(undefined, { maximumFractionDigits: 2 })} votes? This signs a transaction on {govChain === 1 ? "Ethereum" : "LightChain"}.</p>
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <button style={{ flex: 1, padding: "8px 0", fontSize: 12 }} disabled={voting === p.id} onClick={() => vote(p.id, confirm.support)}>{voting === p.id ? "Voting…" : "Confirm"}</button>
                    <button className="ghost" style={{ flex: 1, padding: "8px 0", fontSize: 12 }} onClick={() => setConfirm(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="row" style={{ gap: 6, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                  <button style={{ flex: 1, padding: "8px 0", fontSize: 12 }} onClick={() => setConfirm({ id: p.id, support: 1 })}>For</button>
                  <button className="danger" style={{ flex: 1, padding: "8px 0", fontSize: 12 }} onClick={() => setConfirm({ id: p.id, support: 0 })}>Against</button>
                  <button className="ghost" style={{ flex: 1, padding: "8px 0", fontSize: 12 }} onClick={() => setConfirm({ id: p.id, support: 2 })}>Abstain</button>
                </div>
              )
            ) : p.state === "active" ? (
              <p className="faint" style={{ marginTop: 8 }}>No voting power at this proposal's snapshot. Hold LCAI and delegate before a proposal opens to vote.</p>
            ) : null}
          </div>
        ))}
        {err && <p className="err">{err}</p>}
        <a href="https://dao.lightchain.ai" target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Also on the LightChain DAO site →</a>
    </Sheet>
  );
}
