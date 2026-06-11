/** First-run + unlock flows. */
import { useState } from "react";
import { createMnemonic, isValidMnemonic } from "../../src/keyring/mnemonic";
import { wallet, type WalletState } from "./wallet-api";
import { Ic, avatarGradient, short } from "./shared";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"choose" | "create" | "import">("choose");
  if (mode === "create") return <CreateFlow onDone={onDone} onBack={() => setMode("choose")} />;
  if (mode === "import") return <ImportFlow onDone={onDone} onBack={() => setMode("choose")} />;
  return (
    <div className="onboard welcome">
      <div className="welcome-logo"><img src="/lightnode.png" alt="" /></div>
      <h1 className="welcome-title">LightNode Wallet</h1>
      <p className="welcome-sub">A self-custodial wallet for LightChain and EVM networks. Your keys are generated and encrypted on this device, and never leave it.</p>
      <div className="welcome-cta">
        <button onClick={() => setMode("create")}>Create a new wallet</button>
        <button className="ghost" onClick={() => setMode("import")}>I already have a wallet</button>
      </div>
      <p className="faint center">No account, no server, no custody.</p>
    </div>
  );
}
function BackBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="back-bar">
      <button className="icon-btn" onClick={onBack} aria-label="Back"><Ic name="back" size={16} /></button>
      <h1>{title}</h1>
    </div>
  );
}
function CreateFlow({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [mnemonic] = useState(createMnemonic);
  const [step, setStep] = useState<"phrase" | "ready">("phrase");
  const [address, setAddress] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      await wallet({ type: "createVault", mnemonic, password: pw });
      const st = await wallet<WalletState>({ type: "getState" });
      setAddress(st.accounts[0] ?? "");
      setStep("ready");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  if (step === "ready") return <ReadyScreen address={address} onDone={onDone} />;
  return (
    <div className="onboard">
      <BackBar title="Your recovery phrase" onBack={onBack} />
      <p className="muted">Write these 24 words down offline and keep them safe. Anyone with them controls your funds, and we can never recover them.</p>
      <div className={`word-grid${reveal ? "" : " blurred"}`}>
        {mnemonic.split(" ").map((w, i) => (
          <div className="word" key={i}><span className="word-n">{i + 1}</span>{w}</div>
        ))}
        {!reveal && <button className="reveal-overlay" onClick={() => setReveal(true)}><Ic name="external" size={16} /> Tap to reveal</button>}
      </div>
      <label className="check-row"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved my recovery phrase</label>
      <input type="password" placeholder="Set a password (min 8 characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
      {err && <p className="err">{err}</p>}
      <button disabled={!saved || pw.length < 8 || busy} onClick={create}>{busy ? "Creating…" : "Create wallet"}</button>
    </div>
  );
}
function ImportFlow({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [mnemonic, setMnemonic] = useState("");
  const [step, setStep] = useState<"form" | "ready">("form");
  const [address, setAddress] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = isValidMnemonic(mnemonic);
  const importIt = async () => {
    setBusy(true);
    setErr(null);
    try {
      await wallet({ type: "importVault", mnemonic: mnemonic.trim(), password: pw });
      const st = await wallet<WalletState>({ type: "getState" });
      setAddress(st.accounts[0] ?? "");
      setStep("ready");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  if (step === "ready") return <ReadyScreen address={address} onDone={onDone} />;
  return (
    <div className="onboard">
      <BackBar title="Import a wallet" onBack={onBack} />
      <p className="muted">Enter your 12 or 24 word recovery phrase. It is processed only on this device.</p>
      <textarea placeholder="word1 word2 word3 …" value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} />
      {mnemonic && !valid && <p className="err">Not a valid BIP-39 recovery phrase.</p>}
      <input type="password" placeholder="Set a password (min 8 characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
      {err && <p className="err">{err}</p>}
      <button disabled={!valid || pw.length < 8 || busy} onClick={importIt}>{busy ? "Importing…" : "Import wallet"}</button>
    </div>
  );
}
function ReadyScreen({ address, onDone }: { address: string; onDone: () => void }) {
  return (
    <div className="onboard ready">
      <div className="ready-check"><Ic name="check" size={36} /></div>
      <h1 className="welcome-title">Your wallet is ready</h1>
      <p className="welcome-sub">Self-custodial and encrypted on this device. You are ready to send, receive, and bridge across LightChain and EVM.</p>
      {address && (
        <div className="ready-addr">
          <span className="avatar" style={{ background: avatarGradient(address) }} />
          <span className="addr">{short(address)}</span>
        </div>
      )}
      <button onClick={onDone}>Open wallet</button>
    </div>
  );
}
export function Unlock({ onDone }: { onDone: () => void }) {
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
    <div className="onboard welcome">
      <div className="welcome-logo sm"><img src="/lightnode.png" alt="" /></div>
      <h1 className="welcome-title">Welcome back</h1>
      <p className="welcome-sub">Enter your password to unlock LightNode Wallet.</p>
      <input type="password" placeholder="Password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void unlock()} />
      {err && <p className="err">{err}</p>}
      <button disabled={!pw || busy} onClick={unlock}>{busy ? "Unlocking…" : "Unlock"}</button>
    </div>
  );
}
