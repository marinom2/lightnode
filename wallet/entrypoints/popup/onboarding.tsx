/** First-run + unlock flows. */
import { useState } from "react";
import { createMnemonic, isValidMnemonic, normalizeMnemonic } from "../../src/keyring/mnemonic";
import { wallet, type WalletState } from "./wallet-api";
import { Ic, avatarGradient, short } from "./shared";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"choose" | "create" | "import">("choose");
  if (mode === "create") return <CreateFlow onDone={onDone} onBack={() => setMode("choose")} />;
  if (mode === "import") return <ImportFlow onDone={onDone} onBack={() => setMode("choose")} />;
  return (
    <div className="onboard welcome">
      <div className="welcome-orb">
        <span className="orb-ring" />
        <img src="/lightchain-symbol.svg" alt="Lightchain AI" />
      </div>
      <h1 className="welcome-title">Lightchain <span className="brand-ai">AI</span></h1>
      <p className="welcome-sub">The self-custodial wallet for Lightchain AI. Hold LCAI, vote in governance, run a worker, and use AI, all in one place. Your keys are generated and encrypted on this device, and never leave it.</p>
      <div className="welcome-features">
        <Feature icon="lock" title="Self-custodial" desc="Keys stay on your device" />
        <Feature icon="gov" title="Governance built in" desc="Vote and get reminders" />
        <Feature icon="chat" title="AI, natively" desc="Chat and pay in LCAI" />
        <Feature icon="swap" title="Multi-chain + LCAI" desc="Swap, bridge, track markets" />
      </div>
      <div className="welcome-cta">
        <button onClick={() => setMode("create")}>Create a new wallet</button>
        <button className="ghost" onClick={() => setMode("import")}>I already have a wallet</button>
      </div>
      <p className="faint center">No account, no server, no custody.</p>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="feature">
      <span className="feature-ic"><Ic name={icon} size={16} /></span>
      <div style={{ minWidth: 0 }}><b>{title}</b><div className="faint">{desc}</div></div>
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
/** Pick 3 random word positions; each gets 6 shuffled candidates from the phrase. */
function makeQuiz(words: string[]): { pos: number; options: string[] }[] {
  const positions: number[] = [];
  while (positions.length < 3) {
    const p = Math.floor(Math.random() * words.length);
    if (!positions.includes(p)) positions.push(p);
  }
  return positions.sort((a, b) => a - b).map((pos) => {
    const options = new Set<string>([words[pos]!]);
    while (options.size < Math.min(6, new Set(words).size)) {
      options.add(words[Math.floor(Math.random() * words.length)]!);
    }
    return { pos, options: [...options].sort(() => Math.random() - 0.5) };
  });
}

function VerifyStep({ words, onVerified, onBack }: { words: string[]; onVerified: () => void; onBack: () => void }) {
  const [quiz] = useState(() => makeQuiz(words));
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [failed, setFailed] = useState(false);
  const allPicked = quiz.every((q) => picked[q.pos]);
  const check = () => {
    const ok = quiz.every((q) => picked[q.pos] === words[q.pos]);
    if (ok) onVerified();
    else {
      setFailed(true);
      setPicked({});
    }
  };
  return (
    <div className="onboard">
      <BackBar title="Verify your backup" onBack={onBack} />
      <p className="muted">Pick the right word for each position. This is the only proof your backup actually exists.</p>
      {quiz.map((q) => (
        <div key={q.pos}>
          <div className="faint" style={{ marginBottom: 6 }}>Word #{q.pos + 1}</div>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {q.options.map((w) => (
              <button key={w} className={`chip${picked[q.pos] === w ? " active" : ""}`} onClick={() => setPicked((p) => ({ ...p, [q.pos]: w }))}>{w}</button>
            ))}
          </div>
        </div>
      ))}
      {failed && <p className="err">Not quite. Check your written backup and try again.</p>}
      <button disabled={!allPicked} onClick={check}>Verify backup</button>
    </div>
  );
}

function CreateFlow({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [mnemonic] = useState(createMnemonic);
  const [step, setStep] = useState<"phrase" | "verify" | "password" | "ready">("phrase");
  const [address, setAddress] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
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
  if (step === "verify") return <VerifyStep words={mnemonic.split(" ")} onVerified={() => setStep("password")} onBack={() => setStep("phrase")} />;
  if (step === "password") {
    const mismatch = pw2.length > 0 && pw !== pw2;
    return (
      <div className="onboard">
        <BackBar title="Set your password" onBack={() => setStep("verify")} />
        <p className="muted">It unlocks the wallet on this device. Your recovery phrase stays the master key.</p>
        <input type="password" placeholder="Password (min 8 characters)" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} />
        <input type="password" placeholder="Confirm password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        {mismatch && <p className="err">The passwords do not match.</p>}
        {err && <p className="err">{err}</p>}
        <button disabled={pw.length < 8 || pw !== pw2 || busy} onClick={create}>{busy ? "Creating…" : "Create wallet"}</button>
      </div>
    );
  }
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
      {err && <p className="err">{err}</p>}
      <button disabled={!saved || !reveal} onClick={() => setStep("verify")}>Continue</button>
    </div>
  );
}
function ImportFlow({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [mnemonic, setMnemonic] = useState("");
  const [step, setStep] = useState<"form" | "ready">("form");
  const [address, setAddress] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = isValidMnemonic(mnemonic);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const importIt = async () => {
    setBusy(true);
    setErr(null);
    try {
      await wallet({ type: "importVault", mnemonic: normalizeMnemonic(mnemonic), password: pw });
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
      <input type="password" placeholder="Confirm password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      {mismatch && <p className="err">The passwords do not match.</p>}
      {err && <p className="err">{err}</p>}
      <button disabled={!valid || pw.length < 8 || pw !== pw2 || busy} onClick={importIt}>{busy ? "Importing…" : "Import wallet"}</button>
    </div>
  );
}
function ReadyScreen({ address, onDone }: { address: string; onDone: () => void }) {
  return (
    <div className="onboard ready">
      <div className="ready-check"><Ic name="check" size={36} /></div>
      <h1 className="welcome-title">Your wallet is ready</h1>
      <p className="welcome-sub">Self-custodial and encrypted on this device. You are ready to send, receive, swap, vote, and use AI across Lightchain AI and EVM.</p>
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
  const [recover, setRecover] = useState<"hidden" | "warn" | "import">("hidden");
  const [confirmText, setConfirmText] = useState("");
  const wipeAndRestore = async () => {
    await wallet({ type: "removeWallet" });
    setRecover("import");
  };
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
  // After the wipe there is no vault to unlock: Back must route to onboarding,
  // not back to a password screen that can no longer accept anything.
  if (recover === "import") return <ImportFlow onDone={onDone} onBack={onDone} />;
  return (
    <div className="onboard welcome">
      <div className="welcome-orb sm"><img src="/lightchain-symbol.svg" alt="" /></div>
      <h1 className="welcome-title">Welcome back</h1>
      <p className="welcome-sub">Enter your password to unlock your Lightchain AI wallet.</p>
      <input type="password" placeholder="Password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void unlock()} />
      {err && <p className="err">{err}</p>}
      <button disabled={!pw || busy} onClick={unlock}>{busy ? "Unlocking…" : "Unlock"}</button>
      {recover === "hidden" && (
        <button className="ghost" style={{ fontSize: 12 }} onClick={() => setRecover("warn")}>Forgot password? Restore with your recovery phrase</button>
      )}
      {recover === "warn" && (
        <div className="card" style={{ textAlign: "left" }}>
          <p className="danger-box">This erases the wallet stored on THIS device. The only way back in is your recovery phrase. If you do not have it, do not continue: your funds would be unreachable.</p>
          <p className="muted" style={{ marginTop: 8 }}>Type <b>restore</b> to confirm.</p>
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="restore" style={{ marginTop: 6 }} />
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="ghost" style={{ flex: 1 }} onClick={() => { setRecover("hidden"); setConfirmText(""); }}>Cancel</button>
            <button className="danger" style={{ flex: 1 }} disabled={confirmText.trim().toLowerCase() !== "restore"} onClick={() => void wipeAndRestore()}>Erase + restore</button>
          </div>
        </div>
      )}
    </div>
  );
}
