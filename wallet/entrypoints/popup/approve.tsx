/** Dapp approval window: decode, simulate, approve/reject. */
import { useCallback, useEffect, useState } from "react";
import { wallet, type PendingRequest } from "./wallet-api";
import { decodeDangerousCall } from "../../src/provider/decode-call";
import { summarizeTypedData } from "../../src/provider/typed-data";
import { SEVERITY_CLASS, SUPPORTED_IDS } from "./shared";

export function ApproveView() {
  const [reqs, setReqs] = useState<PendingRequest[] | null>(null);
  const load = useCallback(() => wallet<PendingRequest[]>({ type: "listPending" }).then(setReqs).catch(() => setReqs([])), []);
  useEffect(() => {
    void load();
  }, [load]);
  const resolve = async (id: string, approved: boolean) => {
    await wallet({ type: "resolvePending", id, approved });
    const left = (reqs ?? []).filter((r) => r.id !== id);
    if (left.length === 0) window.close();
    else setReqs(left);
  };
  if (!reqs) return <p className="muted">Loading…</p>;
  if (reqs.length === 0) return <p className="muted">No pending requests.</p>;
  const r = reqs[0]!;
  // On a dangerous decoded call, flip the emphasis: Reject becomes the primary
  // action and Approve loses the inviting gradient.
  const txData = r.method === "eth_sendTransaction" ? ((r.params?.[0] ?? {}) as { data?: string }).data : undefined;
  const dangerous = r.method === "eth_sendTransaction" && decodeDangerousCall(txData as `0x${string}` | undefined).severity === "danger";
  return (
    <div className="card">
      <h2>Approve request</h2>
      <p className="muted">{r.origin}</p>
      <p><b>{labelFor(r.method)}</b></p>
      <RequestDetail req={r} />
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className={dangerous ? "" : "ghost"} style={{ flex: 1 }} onClick={() => resolve(r.id, false)}>Reject</button>
        <button className={dangerous ? "danger" : ""} style={{ flex: 1 }} onClick={() => resolve(r.id, true)}>{dangerous ? "Approve anyway" : "Approve"}</button>
      </div>
    </div>
  );
}

interface SimResult {
  ok: boolean;
  reverted?: boolean;
  changes?: { symbol: string; formatted: string; direction: "in" | "out" }[];
}

function SimPreview({ tx, mute = false }: { tx: { from?: string; to?: string; value?: string; data?: string }; mute?: boolean }) {
  const [sim, setSim] = useState<SimResult | "loading">("loading");
  useEffect(() => {
    wallet<SimResult>({ type: "simulateTx", from: tx.from ?? "", to: tx.to ?? "", value: tx.value, data: tx.data })
      .then(setSim)
      .catch(() => setSim({ ok: false }));
  }, [tx.from, tx.to, tx.value, tx.data]);
  if (sim === "loading") return <p className="muted">Simulating the outcome…</p>;
  if (!sim.ok) return null; // RPC can't simulate; the decoded action below still shows
  if (sim.reverted) return <p className="danger-box">This transaction is expected to FAIL on-chain - approving it would just waste gas.</p>;
  // No balance movement is NOT a green light when the decoded call is dangerous
  // (an unlimited approve moves nothing now, but hands over everything later).
  if (!sim.changes?.length) return <p className={mute ? "muted" : "ok"} style={{ marginBottom: 6 }}>Simulated: no balance changes now{mute ? " - see the warning below" : " (e.g. an approval or a no-op)"}.</p>;
  const fmt = (n: string) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });
  return (
    <div className="card" style={{ padding: 10, marginBottom: 8 }}>
      <div className="faint" style={{ marginBottom: 5 }}>Estimated balance changes</div>
      {sim.changes.map((c, i) => (
        <div key={i} className="row between" style={{ fontSize: 13 }}>
          <span className={c.direction === "in" ? "ok" : "err"} style={{ fontSize: 13 }}>
            {c.direction === "in" ? "+" : "-"}{fmt(c.formatted)} {c.symbol}
          </span>
        </div>
      ))}
    </div>
  );
}

function labelFor(method: string): string {
  if (method === "eth_requestAccounts") return "Connect this site to your wallet";
  if (method === "personal_sign") return "Sign a message";
  if (method === "eth_sendTransaction") return "Send a transaction";
  if (method === "eth_signTypedData_v4") return "Sign typed data (EIP-712)";
  return method;
}

function RequestDetail({ req }: { req: PendingRequest }) {
  if (req.method === "eth_sendTransaction") {
    const tx = (req.params?.[0] ?? {}) as { from?: string; to?: string; value?: string; data?: string };
    const decoded = decodeDangerousCall(tx.data as `0x${string}` | undefined);
    return (
      <div className="muted" style={{ fontSize: 12 }}>
        <SimPreview tx={tx} mute={decoded.severity === "danger"} />
        <p className="addr">to: {tx.to ?? "(contract creation)"}</p>
        <p>value: {tx.value ? Number(BigInt(tx.value)) / 1e18 : 0}</p>
        {decoded.kind !== "empty" && (
          <p className={SEVERITY_CLASS[decoded.severity]}><b>{decoded.label}.</b> {decoded.detail}</p>
        )}
      </div>
    );
  }
  if (req.method === "eth_signTypedData_v4") {
    const s = summarizeTypedData(req.params?.[1], SUPPORTED_IDS);
    return (
      <div className="muted" style={{ fontSize: 12 }}>
        {s.error ? (
          <p className="warn">{s.error} Reject unless you trust this site.</p>
        ) : (
          <>
            <p>type: <b>{s.primaryType}</b>{s.domainName ? ` · ${s.domainName}` : ""}</p>
            {s.verifyingContract && <p className="addr">contract: {s.verifyingContract}</p>}
            {!s.chainIdOk && <p className="warn">Domain chain ({s.chainId ?? "?"}) is not a supported network - reject unless you are sure.</p>}
            {s.warning && <p className="warn">{s.warning}</p>}
          </>
        )}
      </div>
    );
  }
  if (req.method === "personal_sign") {
    const raw = String(req.params?.[0] ?? "");
    const text = decodeUtf8(raw);
    return text != null
      ? <p className="seed" style={{ fontSize: 12 }}>{text}</p>
      : <p className="warn">You are signing unreadable (non-text) data. This can authorize transfers - reject unless you know exactly what it is.</p>;
  }
  return <p className="muted">This site is requesting access to your account address.</p>;
}

function decodeUtf8(hex: string): string | null {
  if (!/^0x[0-9a-fA-F]*$/.test(hex)) return hex || null;
  try {
    const bytes = new Uint8Array((hex.slice(2).match(/../g) ?? []).map((h) => parseInt(h, 16)));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /[\x00-\x08\x0e-\x1f]/.test(text) ? null : text;
  } catch {
    return null;
  }
}
