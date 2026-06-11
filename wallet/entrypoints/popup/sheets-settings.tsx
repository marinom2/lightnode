/** Settings: secrets, auto-lock, connected sites, display, about, removal. */
import { useEffect, useState } from "react";
import { wallet, type WalletState } from "./wallet-api";
import { short, Sheet } from "./shared";

const AUTO_LOCK_CHOICES = [5, 15, 60] as const;

/** Password-gated reveal used for both the phrase and per-account keys. */
function SecretReveal({ state, onErr }: { state: WalletState; onErr: (m: string | null) => void }) {
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState<"phrase" | number>("phrase"); // number = account index
  const [secret, setSecret] = useState<string | null>(null);
  const reveal = async () => {
    onErr(null);
    setSecret(null);
    try {
      if (mode === "phrase") {
        const r = await wallet<{ mnemonic: string }>({ type: "revealMnemonic", password: pw });
        setSecret(r.mnemonic);
      } else {
        const r = await wallet<{ privateKey: string }>({ type: "revealPrivateKey", password: pw, index: mode });
        setSecret(r.privateKey);
      }
    } catch (e) {
      onErr((e as Error).message);
    }
  };
  return (
    <>
      <div className="chips" style={{ flexWrap: "wrap" }}>
        <button className={`chip${mode === "phrase" ? " active" : ""}`} onClick={() => { setMode("phrase"); setSecret(null); }}>Recovery phrase</button>
        {state.accounts.map((a, i) => (
          <button key={a} className={`chip${mode === i ? " active" : ""}`} title={a} onClick={() => { setMode(i); setSecret(null); }}>
            Key · {state.names?.[i]?.trim() || `Account ${i + 1}`}
          </button>
        ))}
      </div>
      {secret ? (
        <>
          <div className="seed" style={{ marginTop: 8, fontSize: mode === "phrase" ? undefined : 11 }}>{secret}</div>
          <p className="danger-box" style={{ marginTop: 8 }}>Never share this. Anyone with it controls {mode === "phrase" ? "ALL your accounts" : "this account"}.</p>
          <button className="ghost" style={{ marginTop: 8, width: "100%" }} onClick={() => { setSecret(null); setPw(""); }}>Hide</button>
        </>
      ) : (
        <>
          <input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ marginTop: 8 }} />
          <button className="ghost" disabled={!pw} onClick={reveal} style={{ marginTop: 8, width: "100%" }}>
            Reveal {mode === "phrase" ? "phrase" : "private key"}
          </button>
        </>
      )}
    </>
  );
}

export function SettingsSheet({ state, onClose, onRemoved, onChanged }: { state: WalletState; onClose: () => void; onRemoved: () => void; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [origins, setOrigins] = useState<string[] | null>(null);
  const [hideTestnets, setHideTestnets] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState("");
  const [removeArmed, setRemoveArmed] = useState(false);
  useEffect(() => {
    wallet<string[]>({ type: "getOrigins" }).then(setOrigins).catch(() => setOrigins([]));
    void chrome.storage.local.get("ui-hide-testnets").then((r) => setHideTestnets(Boolean(r["ui-hide-testnets"])));
  }, []);
  const [revokeErr, setRevokeErr] = useState<string | null>(null);
  const revoke = (origin: string) => {
    setRevokeErr(null);
    void wallet({ type: "revokeOrigin", origin })
      .then(() => setOrigins((o) => (o ?? []).filter((x) => x !== origin)))
      .catch(() => setRevokeErr("Could not revoke. Try again."));
  };
  const setAutoLock = (minutes: number) => void wallet({ type: "setAutoLock", minutes }).then(onChanged).catch(() => {});
  const toggleTestnets = () => {
    setHideTestnets((v) => {
      void chrome.storage.local.set({ "ui-hide-testnets": !v });
      return !v;
    });
  };
  const remove = async () => {
    await wallet({ type: "removeWallet" });
    onRemoved();
  };
  const version = chrome.runtime.getManifest().version;
  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="card">
        <h2>Secrets</h2>
        <SecretReveal state={state} onErr={setErr} />
        {err && <p className="err">{err}</p>}
      </div>
      <div className="card">
        <h2>Auto-lock</h2>
        <p className="muted">Lock the wallet after inactivity (it always locks on browser restart).</p>
        <div className="chips" style={{ marginTop: 8 }}>
          {AUTO_LOCK_CHOICES.map((m) => (
            <button key={m} className={`chip${state.autoLockMin === m ? " active" : ""}`} onClick={() => setAutoLock(m)}>{m} min</button>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>Connected sites</h2>
        {origins == null ? (
          <span className="skel" style={{ width: 140 }} />
        ) : origins.length === 0 ? (
          <p className="muted">No sites are connected to this wallet.</p>
        ) : (
          origins.map((o) => (
            <div className="row between" key={o} style={{ marginTop: 6 }}>
              <span className="addr" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {o.startsWith("http://") && <span className="chg chg-down" style={{ marginLeft: 0, marginRight: 5 }}>http</span>}
                {o.replace(/^https:\/\//, "")}
              </span>
              <button className="ghost" style={{ padding: "3px 10px", fontSize: 11, flexShrink: 0 }} onClick={() => revoke(o)}>Revoke</button>
            </div>
          ))
        )}
        {revokeErr && <p className="err">{revokeErr}</p>}
      </div>
      <div className="card">
        <h2>Display</h2>
        <div className="row between">
          <span className="muted">Show testnets in the network list</span>
          <button className={`chip${!hideTestnets ? " active" : ""}`} onClick={toggleTestnets}>{hideTestnets ? "Hidden" : "Shown"}</button>
        </div>
      </div>
      <div className="card">
        <h2>Danger zone</h2>
        <p className="muted">Removing the wallet erases it from THIS device only. Your recovery phrase is the only way back in. Type <b>remove</b> to arm.</p>
        <input value={confirmRemove} placeholder="remove" onChange={(e) => { setConfirmRemove(e.target.value); setRemoveArmed(e.target.value.trim().toLowerCase() === "remove"); }} style={{ marginTop: 8 }} />
        <button className="danger" disabled={!removeArmed} onClick={remove} style={{ marginTop: 8, width: "100%" }}>Remove wallet from this device</button>
      </div>
      <div className="card">
        <h2>About</h2>
        <div className="row between"><span className="muted">Version</span><span className="addr">{version}</span></div>
        <div className="row between" style={{ marginTop: 4 }}><span className="muted">Active account</span><span className="addr">{short(state.accounts[state.activeIndex] ?? "")}</span></div>
        <div className="row" style={{ gap: 12, marginTop: 8 }}>
          <a href="https://lightnode.app" target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>LightNode →</a>
          <a href="https://github.com/marinom2/lightnode" target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Source code →</a>
        </div>
        <p className="faint" style={{ marginTop: 8 }}>Self-custodial: keys never leave this device. Independent and community-built.</p>
      </div>
    </Sheet>
  );
}
