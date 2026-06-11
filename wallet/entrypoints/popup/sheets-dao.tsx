/** Governance: proposals on both governors + in-wallet voting. */
import { useCallback, useEffect, useRef, useState } from "react";
import { wallet } from "./wallet-api";
import { humanizeError } from "../../src/rpc/humanize";
import { type DaoView, Ic, short } from "./shared";

type ProposalRow = { id: string; title: string; proposer: string; state: string; forVotes: number; againstVotes: number; abstainVotes: number; blocksLeft: number | null; youVoted: boolean; yourWeight: number };
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
        <span>For {pct(p.forVotes)}</span><span>Against {pct(p.againstVotes)}</span><span>Abstain {pct(p.abstainVotes)}</span>
      </div>
    </>
  );
}

export function DaoSheet({ from, onClose }: { from: string; onClose: () => void }) {
  const [govChain, setGovChain] = useState<1 | 9200>(9200);
  const [onlyActive, setOnlyActive] = useState(false);
  const [rows, setRows] = useState<ProposalRow[] | null | undefined>(undefined);
  const [power, setPower] = useState<number | null>(null);
  const [voting, setVoting] = useState<string | null>(null); // proposal id in flight
  const [voted, setVoted] = useState<Record<string, string>>({}); // id -> tx hash
  const [confirm, setConfirm] = useState<{ id: string; support: 0 | 1 | 2 } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const epoch = useRef(0);
  const load = useCallback(() => {
    setRows(undefined);
    const e = ++epoch.current;
    // Guard: flipping the chain tab fires two requests; the slow one must not win.
    wallet<{ proposals: ProposalRow[] | null }>({ type: "getProposals", chainId: govChain, voter: from }).then((r) => { if (epoch.current === e) setRows(r.proposals); }).catch(() => { if (epoch.current === e) setRows(null); });
    wallet<DaoView>({ type: "daoStatus", chainId: govChain, address: from }).then((r) => { if (epoch.current === e) setPower(r.supported ? Number(r.votingPower) : null); }).catch(() => { if (epoch.current === e) setPower(null); });
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
    <div className="sheet" onClick={onClose}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h1>Governance</h1><button className="icon-btn" onClick={onClose}><Ic name="x" size={15} /></button></div>
        <div className="tabs">
          <button className={`tab${govChain === 9200 ? " active" : ""}`} onClick={() => setGovChain(9200)}>LightChain</button>
          <button className={`tab${govChain === 1 ? " active" : ""}`} onClick={() => setGovChain(1)}>Ethereum</button>
        </div>
        <div className="row between">
          <span className="muted">Your voting power</span>
          <b>{power == null ? "…" : power.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>
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
          <div className="card" key={p.id}>
            <div className="row between">
              <span className={`tag ${STATE_TONE[p.state] ?? ""}`} style={{ marginLeft: 0 }}>{p.state}</span>
              {p.blocksLeft != null && <span className="faint">~{p.blocksLeft.toLocaleString()} blocks left</span>}
            </div>
            <b style={{ fontSize: 13, display: "block", marginTop: 6 }}>{p.title}</b>
            <p className="faint" style={{ margin: "4px 0 8px" }}>by {short(p.proposer)} · #{p.id.slice(0, 10)}…</p>
            <VoteBar p={p} />
            {voted[p.id] ? (
              <p className="ok" style={{ marginTop: 8 }}>Vote submitted. <a href={`${explorer}/tx/${voted[p.id]}`} target="_blank" rel="noreferrer">View →</a></p>
            ) : p.youVoted ? (
              <p className="faint" style={{ marginTop: 8 }}>You have already voted on this proposal.</p>
            ) : p.state === "active" && p.yourWeight > 0 ? (
              confirm?.id === p.id ? (
                <div style={{ marginTop: 8 }}>
                  <p className="faint">Vote <b>{SUPPORT_LABEL[confirm.support]}</b> with {p.yourWeight.toLocaleString(undefined, { maximumFractionDigits: 2 })} votes? This signs a transaction on {govChain === 1 ? "Ethereum" : "LightChain"}.</p>
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <button style={{ flex: 1, padding: "8px 0", fontSize: 12 }} disabled={voting === p.id} onClick={() => vote(p.id, confirm.support)}>{voting === p.id ? "Voting…" : "Confirm"}</button>
                    <button className="ghost" style={{ flex: 1, padding: "8px 0", fontSize: 12 }} onClick={() => setConfirm(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
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
        <a href="https://dao.lightchain.ai" target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Full proposal texts on the LightChain DAO →</a>
      </div>
    </div>
  );
}
