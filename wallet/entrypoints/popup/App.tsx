import { useCallback, useEffect, useState } from "react";
import { createMnemonic, isValidMnemonic } from "../../src/keyring/mnemonic";
import { decodeDangerousCall, type Severity } from "../../src/provider/decode-call";
import { summarizeTypedData } from "../../src/provider/typed-data";
import { wallet, type WalletState, type PendingRequest, type WorkerStatusView } from "./wallet-api";

const SEVERITY_CLASS: Record<Severity, string> = { info: "muted", warn: "warn", danger: "warn" };

const EXPLORER = "https://mainnet.lightscan.app";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const isApproveWindow = () => window.location.hash.includes("approve");

export function App() {
  const [state, setState] = useState<WalletState | null>(null);
  const refresh = useCallback(async () => setState(await wallet<WalletState>({ type: "getState" })), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (isApproveWindow()) return <Shell><ApproveView /></Shell>;
  if (!state) return <Shell><p className="muted">Loading…</p></Shell>;
  if (!state.hasVault) return <Shell><Onboarding onDone={refresh} /></Shell>;
  if (!state.unlocked) return <Shell><Unlock onDone={refresh} /></Shell>;
  return <Shell><WalletHome state={state} onChange={refresh} /></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="wrap">
      <div className="brand"><span className="dot" /> LightNode Wallet</div>
      {children}
    </div>
  );
}

// ---- onboarding ------------------------------------------------------------

function Onboarding({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"choose" | "create" | "import">("choose");
  if (mode === "create") return <CreateFlow onDone={onDone} />;
  if (mode === "import") return <ImportFlow onDone={onDone} />;
  return (
    <div className="card">
      <h1>Self-custodial. Your keys.</h1>
      <p className="muted">Keys are generated and encrypted on this device and never leave it.</p>
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <button onClick={() => setMode("create")} style={{ flex: 1 }}>Create wallet</button>
        <button className="ghost" onClick={() => setMode("import")} style={{ flex: 1 }}>Import</button>
      </div>
    </div>
  );
}

function CreateFlow({ onDone }: { onDone: () => void }) {
  const [mnemonic] = useState(createMnemonic);
  const [saved, setSaved] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      await wallet({ type: "createVault", mnemonic, password: pw });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h2>Your recovery phrase</h2>
      <div className="seed">{mnemonic}</div>
      <p className="warn">Write these 24 words down and keep them offline. Anyone with them controls your funds. We can never recover them for you.</p>
      <label className="row muted" style={{ gap: 6 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I saved my phrase
      </label>
      <input type="password" placeholder="Set a password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ marginTop: 10 }} />
      {err && <p className="err">{err}</p>}
      <button disabled={!saved || pw.length < 8 || busy} onClick={create} style={{ marginTop: 10, width: "100%" }}>
        {busy ? "Creating…" : "Create wallet"}
      </button>
    </div>
  );
}

function ImportFlow({ onDone }: { onDone: () => void }) {
  const [mnemonic, setMnemonic] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = isValidMnemonic(mnemonic);
  const importIt = async () => {
    setBusy(true);
    setErr(null);
    try {
      await wallet({ type: "importVault", mnemonic: mnemonic.trim(), password: pw });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h2>Import a recovery phrase</h2>
      <textarea placeholder="word1 word2 …" value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} />
      {mnemonic && !valid && <p className="err">Not a valid BIP-39 phrase.</p>}
      <input type="password" placeholder="Set a password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ marginTop: 10 }} />
      {err && <p className="err">{err}</p>}
      <button disabled={!valid || pw.length < 8 || busy} onClick={importIt} style={{ marginTop: 10, width: "100%" }}>
        {busy ? "Importing…" : "Import wallet"}
      </button>
    </div>
  );
}

// ---- unlock ----------------------------------------------------------------

function Unlock({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const unlock = async () => {
    setBusy(true);
    setErr(null);
    try {
      await wallet({ type: "unlock", password: pw });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h2>Unlock</h2>
      <input type="password" placeholder="Password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void unlock()} />
      {err && <p className="err">{err}</p>}
      <button disabled={!pw || busy} onClick={unlock} style={{ marginTop: 10, width: "100%" }}>{busy ? "Unlocking…" : "Unlock"}</button>
    </div>
  );
}

// ---- wallet home -----------------------------------------------------------

function WalletHome({ state, onChange }: { state: WalletState; onChange: () => void }) {
  const address = state.accounts[0]!;
  const [bal, setBal] = useState<string | null>(null);
  useEffect(() => {
    wallet<{ lcai: string }>({ type: "getBalance", address }).then((b) => setBal(b.lcai)).catch(() => setBal(null));
  }, [address]);
  return (
    <>
      <div className="card">
        <div className="row between"><span className="pill">LightChain · 9200</span><button className="ghost" style={{ padding: "4px 10px" }} onClick={() => wallet({ type: "lock" }).then(onChange)}>Lock</button></div>
        <p className="muted" style={{ marginTop: 10 }}>Balance</p>
        <div className="balance">{bal == null ? "…" : Number(bal).toLocaleString(undefined, { maximumFractionDigits: 4 })} <span style={{ fontSize: 14, color: "var(--soft)" }}>LCAI</span></div>
        <p className="addr" style={{ marginTop: 6 }}>{short(address)} <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">view</a></p>
      </div>
      <SendForm from={address} onSent={onChange} />
      <WorkerPanel address={address} />
      <div className="card">
        <h2>More superpowers</h2>
        <p className="muted">Encrypted AI inference, DAO intelligence, and the Ethereum bridge connect through the lightnode SDK and land next. Explore them at <a href="https://lightchain.ai" target="_blank" rel="noreferrer">lightnode</a>.</p>
      </div>
    </>
  );
}

function WorkerPanel({ address }: { address: string }) {
  const [s, setS] = useState<WorkerStatusView | "loading" | "error">("loading");
  useEffect(() => {
    setS("loading");
    wallet<WorkerStatusView>({ type: "workerStatus", address }).then(setS).catch(() => setS("error"));
  }, [address]);
  if (s === "loading") return <div className="card"><h2>Worker status</h2><p className="muted">Checking the registry…</p></div>;
  if (s === "error") return <div className="card"><h2>Worker status</h2><p className="muted">Could not reach the worker registry. Try again later.</p></div>;
  if (!s.registered) {
    return (
      <div className="card">
        <h2>Worker status</h2>
        <p className="muted">This address is not a registered LightChain worker. <a href="https://lightchain.ai/onboard" target="_blank" rel="noreferrer">Run a worker →</a></p>
      </div>
    );
  }
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Worker</h2><span className="pill">registered</span></div>
      <div className="row between" style={{ marginTop: 8 }}><span className="muted">Stake</span><span className="addr">{fmt(s.stakeLcai)} LCAI</span></div>
      <div className="row between"><span className="muted">Min stake</span><span className="addr">{fmt(s.minStakeLcai)}</span></div>
      <div className="row between"><span className="muted">Headroom</span><span className="addr">{fmt(s.headroomLcai)}</span></div>
      {s.claimableLcai > 0 && <div className="row between"><span className="muted">Claimable</span><span className="ok">{fmt(s.claimableLcai)} LCAI</span></div>}
      {s.belowFloor && <p className="warn">Below the stake floor - top up to keep earning. Manage at lightnode.</p>}
      <a href="https://lightchain.ai" target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 12 }}>Manage worker →</a>
    </div>
  );
}

function SendForm({ from, onSent }: { from: string; onSent: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setErr(null);
    setHash(null);
    try {
      const r = await wallet<{ hash: string }>({ type: "send", from, to: to.trim(), valueWei: amount });
      setHash(r.hash);
      setAmount("");
      onSent();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ok = /^0x[0-9a-fA-F]{40}$/.test(to.trim()) && Number(amount) > 0;
  return (
    <div className="card">
      <h2>Send LCAI</h2>
      <input placeholder="0x recipient" value={to} onChange={(e) => setTo(e.target.value)} />
      <input placeholder="Amount (LCAI)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} style={{ marginTop: 8 }} />
      <p className="muted" style={{ marginTop: 6 }}>Network fee: negligible on LightChain.</p>
      {err && <p className="err">{err}</p>}
      {hash && <p className="ok">Sent · <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">{short(hash)}</a></p>}
      <button disabled={!ok || busy} onClick={send} style={{ marginTop: 8, width: "100%" }}>{busy ? "Sending…" : "Send"}</button>
    </div>
  );
}

// ---- dapp approval window --------------------------------------------------

function ApproveView() {
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
  return (
    <div className="card">
      <h2>Approve request</h2>
      <p className="muted">{r.origin}</p>
      <p><b>{labelFor(r.method)}</b></p>
      <RequestDetail req={r} />
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="ghost" style={{ flex: 1 }} onClick={() => resolve(r.id, false)}>Reject</button>
        <button style={{ flex: 1 }} onClick={() => resolve(r.id, true)}>Approve</button>
      </div>
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
    const tx = (req.params?.[0] ?? {}) as { to?: string; value?: string; data?: string };
    const decoded = decodeDangerousCall(tx.data as `0x${string}` | undefined);
    return (
      <div className="muted" style={{ fontSize: 12 }}>
        <p className="addr">to: {tx.to ?? "(contract creation)"}</p>
        <p>value: {tx.value ? Number(BigInt(tx.value)) / 1e18 : 0} LCAI</p>
        {decoded.kind !== "empty" && (
          <p className={SEVERITY_CLASS[decoded.severity]}>
            <b>{decoded.label}.</b> {decoded.detail}
          </p>
        )}
      </div>
    );
  }
  if (req.method === "eth_signTypedData_v4") {
    const s = summarizeTypedData(req.params?.[1], [9200, 8200]);
    return (
      <div className="muted" style={{ fontSize: 12 }}>
        {s.error ? (
          <p className="warn">{s.error} Reject unless you trust this site.</p>
        ) : (
          <>
            <p>type: <b>{s.primaryType}</b>{s.domainName ? ` · ${s.domainName}` : ""}</p>
            {s.verifyingContract && <p className="addr">contract: {s.verifyingContract}</p>}
            {!s.chainIdOk && <p className="warn">Domain chain ({s.chainId ?? "?"}) is not LightChain - reject unless you are sure.</p>}
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
