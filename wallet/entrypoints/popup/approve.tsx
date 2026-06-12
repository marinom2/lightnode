/** Dapp approval window: decode, simulate, approve/reject. */
import { useCallback, useEffect, useState } from "react";
import { wallet, type PendingRequest, type WalletState } from "./wallet-api";
import { decodeDangerousCall } from "../../src/provider/decode-call";
import { recognizeLightChainCall } from "../../src/provider/lightchain-calls";
import { summarizeTypedData, siweOriginMismatch, siweChainId, decodeSignText } from "../../src/provider/typed-data";
import { chainById, isSupportedChain, logoFor } from "../../src/rpc/chains";
import { assessRecipient } from "../../src/rpc/risk";
import { SEVERITY_CLASS, SUPPORTED_IDS, avatarGradient, short } from "./shared";

export function ApproveView() {
  const [reqs, setReqs] = useState<PendingRequest[] | null>(null);
  const [state, setState] = useState<WalletState | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void wallet<PendingRequest[]>({ type: "listPending" }).then(setReqs).catch(() => setReqs([]));
    void wallet<WalletState>({ type: "getState" }).then(setState).catch(() => {});
    // Known counterparties feed the same address-poisoning check the send flow uses.
    void wallet<string[]>({ type: "knownRecipients" }).then(setKnown).catch(() => {});
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const resolve = async (id: string, approved: boolean) => {
    setBusy(true);
    try {
      await wallet({ type: "resolvePending", id, approved });
    } finally {
      setBusy(false);
    }
    // Re-poll: another request may have queued into this window meanwhile.
    const left = await wallet<PendingRequest[]>({ type: "listPending" }).catch(() => []);
    if (left.length === 0) window.close();
    else load(); // state too: a SIWE approval may just have switched the network
  };
  if (!reqs) return <p className="muted">Loading…</p>;
  if (reqs.length === 0) return <p className="muted">No pending requests.</p>;
  const r = reqs[0]!;
  // On a dangerous decoded call, flip the emphasis: Reject becomes the primary
  // action and Approve loses the inviting gradient.
  const txParam = r.method === "eth_sendTransaction" ? ((r.params?.[0] ?? {}) as { from?: string; to?: string; value?: string; data?: string }) : null;
  const dangerous = txParam != null && decodeDangerousCall(txParam.data as `0x${string}` | undefined).severity === "danger";
  const chain = state ? chainById(state.chainId) : null;
  const signer = txParam?.from ?? state?.accounts[state?.activeIndex ?? 0];
  const signerName = state && signer ? (state.names?.[state.accounts.findIndex((a) => a.toLowerCase() === signer.toLowerCase())]?.trim() || short(signer)) : null;
  return (
    <div className="card">
      <span className="origin-pill" title={r.origin}>{r.origin.replace(/^https:\/\//, "")}</span>
      <h1 style={{ fontSize: 17, margin: "10px 0 2px" }}>{labelFor(r.method)}</h1>
      {reqs.length > 1 && <p className="faint">Request 1 of {reqs.length}</p>}
      {chain && signer && (
        <div className="ctx-row">
          <span className="ctx-item"><img className="net-logo" src={logoFor(state!.chainId)} alt="" /> {chain.name}</span>
          <span className="ctx-item"><span className="avatar" style={{ width: 14, height: 14, background: avatarGradient(signer) }} /> {signerName}</span>
        </div>
      )}
      <RequestDetail req={r} activeChainId={state?.chainId} own={state?.accounts ?? []} known={known} />
      {txParam && <FeeEstimate tx={txParam} />}
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className={dangerous ? "" : "ghost"} style={{ flex: 1 }} disabled={busy} onClick={() => resolve(r.id, false)}>Reject</button>
        <button className={dangerous ? "danger" : ""} style={{ flex: 1 }} disabled={busy} onClick={() => resolve(r.id, true)}>{busy ? "Working…" : dangerous ? "Approve anyway" : "Approve"}</button>
      </div>
    </div>
  );
}

/** Network-fee preview for dapp transactions, reusing the send-quote path. */
function FeeEstimate({ tx }: { tx: { from?: string; to?: string; value?: string; data?: string } }) {
  const [fee, setFee] = useState<string | null>(null);
  useEffect(() => {
    if (!tx.from || !tx.to) return;
    let valueEth = "0";
    try {
      valueEth = tx.value ? (Number(BigInt(tx.value)) / 1e18).toString() : "0";
    } catch {
      return; // unparseable value: skip the estimate, the approval still shows
    }
    // The estimate must include the calldata: a contract call costs far more
    // than the bare transfer the old quote priced.
    wallet<{ feeFormatted: string | null; feeSymbol: string }>({ type: "quoteSend", from: tx.from, to: tx.to, valueWei: valueEth, data: tx.data })
      .then((q) => setFee(q.feeFormatted ? `${Number(q.feeFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${q.feeSymbol}` : null))
      .catch(() => {});
  }, [tx.from, tx.to, tx.value, tx.data]);
  if (!fee) return null;
  return <p className="muted" style={{ marginTop: 6 }}>Network fee ≈ {fee}</p>;
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

function RequestDetail({ req, activeChainId, own = [], known = [] }: { req: PendingRequest; activeChainId?: number; own?: string[]; known?: string[] }) {
  if (req.method === "eth_sendTransaction") {
    const tx = (req.params?.[0] ?? {}) as { from?: string; to?: string; value?: string; data?: string };
    const decoded = decodeDangerousCall(tx.data as `0x${string}` | undefined);
    // Positive ID of LightChain's own protocol calls. When recognized, the
    // reassuring banner replaces the generic "unrecognized contract" warning -
    // the native wallet should know its own ecosystem on sight.
    const recognized = recognizeLightChainCall(tx.to, tx.data as `0x${string}` | undefined, activeChainId, valueWei(tx.value));
    const hideUnknown = recognized != null && decoded.kind === "unknown";
    // Address-poisoning check on the EFFECTIVE recipient: the decoded
    // transfer/transferFrom target when present, else the bare tx.to. Dapp sends
    // bypassed this entirely before; run the same assessment the send flow does.
    const recipient = decoded.recipient ?? tx.to;
    const risk = recipient && recipient.length === 42 ? assessRecipient(recipient, known, own) : null;
    return (
      <div className="muted" style={{ fontSize: 12 }}>
        {recognized && (
          <p className="protocol-box" style={{ marginBottom: 6 }}>
            <b>{recognized.contract}: {recognized.action}.</b> {recognized.detail}
          </p>
        )}
        {risk?.kind === "lookalike" && (
          <p className="danger-box" style={{ marginBottom: 6 }}>This recipient looks like {short(risk.similarTo!)} but is different - a common address-poisoning scam. Verify every character before approving.</p>
        )}
        <SimPreview tx={tx} mute={decoded.severity === "danger"} />
        <div className="row between" style={{ marginTop: 4 }}>
          <span className="faint">To</span>
          <span className="addr" title={tx.to}>{tx.to ? short(tx.to) : "(contract creation)"}</span>
        </div>
        <div className="row between">
          <span className="faint">Amount</span>
          <b>{txValueEth(tx.value)}</b>
        </div>
        {decoded.kind !== "empty" && !hideUnknown && (
          <p className={SEVERITY_CLASS[decoded.severity]} style={{ marginTop: 6 }}><b>{decoded.label}.</b> {decoded.detail}</p>
        )}
      </div>
    );
  }
  if (req.method === "eth_signTypedData_v4") {
    const s = summarizeTypedData(req.params?.[1], SUPPORTED_IDS);
    // Always surface the domain chain as a network name: a Permit aimed at a
    // different chain than the wallet's network is otherwise invisible.
    const domainNet = s.chainId != null ? domainNetworkName(s.chainId) : null;
    const crossChain = s.chainId != null && activeChainId != null && s.chainId !== activeChainId;
    return (
      <div className="muted" style={{ fontSize: 12 }}>
        {s.error ? (
          <p className="warn">{s.error} Reject unless you trust this site.</p>
        ) : (
          <>
            <p>type: <b>{s.primaryType}</b>{s.domainName ? ` · ${s.domainName}` : ""}{domainNet ? ` · ${domainNet}` : ""}</p>
            {crossChain && (
              <p className="warn"><b>This is for {domainNet}, but your wallet is on {chainById(activeChainId!).name}.</b></p>
            )}
            {s.verifyingContract && <p className="addr">contract: {s.verifyingContract}</p>}
            {s.permit.kind !== "none" && (
              <div className={s.permit.unlimited ? "danger-box" : "warn"} style={{ marginTop: 6 }}>
                <b>{s.permit.unlimited ? "Unlimited signature approval." : "Signature approval."}</b> {s.permit.summary}
                {s.permit.spender && <div className="addr" style={{ marginTop: 4 }}>spender: {s.permit.spender}</div>}
                {s.permit.token && <div className="addr">token: {s.permit.token}</div>}
                {s.permit.deadline && Number(s.permit.deadline) > 0 && <div style={{ marginTop: 2 }}>valid until {new Date(Number(s.permit.deadline) * 1000).toLocaleString()}</div>}
              </div>
            )}
            {!s.chainIdOk && <p className="warn">Domain chain ({s.chainId ?? "?"}) is not a supported network - reject unless you are sure.</p>}
            {s.warning && <p className="warn">{s.warning}</p>}
          </>
        )}
      </div>
    );
  }
  if (req.method === "personal_sign") {
    const raw = String(req.params?.[0] ?? "");
    const text = decodeSignText(raw);
    if (text == null) return <p className="warn">You are signing unreadable (non-text) data. This can authorize transfers - reject unless you know exactly what it is.</p>;
    const mismatch = siweOriginMismatch(text, req.origin);
    const siweTarget = siweChainId(text);
    const switchTo = !mismatch && siweTarget != null && SUPPORTED_IDS.includes(siweTarget) && siweTarget !== activeChainId ? chainById(siweTarget) : null;
    return (
      <>
        {mismatch && (
          <p className="danger-box"><b>Sign-in domain mismatch.</b> The message claims to be from <b>{mismatch.stated}</b> but the request comes from <b>{mismatch.actual}</b>. This is how lookalike sites steal sessions; reject it.</p>
        )}
        {switchTo && (
          <p className="muted" style={{ marginBottom: 6 }}>This sign-in is for <b>{switchTo.name}</b> - approving switches the wallet to that network.</p>
        )}
        <p className="seed sign-text">{text}</p>
      </>
    );
  }
  return <p className="muted">This site is requesting access to your account address.</p>;
}

function txValueEth(value?: string): string {
  try {
    const n = value ? Number(BigInt(value)) / 1e18 : 0;
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
  } catch {
    return "unreadable";
  }
}

/** A typed-data domain chainId as a network name, or the raw id when unsupported. */
function domainNetworkName(chainId: number): string {
  return isSupportedChain(chainId) ? chainById(chainId).name : `chain ${chainId}`;
}

/** The tx value in wei (0 when absent or unparseable), for fee-aware labels. */
function valueWei(value?: string): bigint {
  try {
    return value ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
}
