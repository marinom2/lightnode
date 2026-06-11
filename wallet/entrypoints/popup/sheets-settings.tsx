/** Settings: reveal phrase, connected sites, remove wallet. */
import { useEffect, useState } from "react";
import { wallet } from "./wallet-api";
import { Ic, Sheet } from "./shared";

export function SettingsSheet({ onClose, onRemoved }: { onClose: () => void; onRemoved: () => void }) {
  const [pw, setPw] = useState("");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [origins, setOrigins] = useState<string[] | null>(null);
  useEffect(() => {
    wallet<string[]>({ type: "getOrigins" }).then(setOrigins).catch(() => setOrigins([]));
  }, []);
  const [revokeErr, setRevokeErr] = useState<string | null>(null);
  const revoke = (origin: string) => {
    setRevokeErr(null);
    void wallet({ type: "revokeOrigin", origin })
      .then(() => setOrigins((o) => (o ?? []).filter((x) => x !== origin)))
      .catch(() => setRevokeErr("Could not revoke. Try again."));
  };
  const reveal = async () => {
    setErr(null);
    try {
      const r = await wallet<{ mnemonic: string }>({ type: "revealMnemonic", password: pw });
      setPhrase(r.mnemonic);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = async () => {
    if (!window.confirm("Remove this wallet from the device? You can only restore it with your recovery phrase.")) return;
    await wallet({ type: "removeWallet" });
    onRemoved();
  };
  return (
    <Sheet title="Settings" onClose={onClose}>
        <div className="card">
          <h2>Recovery phrase</h2>
          {phrase ? (
            <>
              <div className="seed" style={{ marginTop: 4 }}>{phrase}</div>
              <p className="danger-box" style={{ marginTop: 8 }}>Never share this. Anyone with it controls your funds.</p>
            </>
          ) : (
            <>
              <p className="muted">Enter your password to reveal your 24-word phrase.</p>
              <input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ marginTop: 8 }} />
              {err && <p className="err">{err}</p>}
              <button className="ghost" disabled={!pw} onClick={reveal} style={{ marginTop: 8, width: "100%" }}>Reveal phrase</button>
            </>
          )}
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
          <h2>Security</h2>
          <p className="muted">Auto-locks after 15 minutes of inactivity and after a browser restart.</p>
          <button className="danger" onClick={remove} style={{ marginTop: 10, width: "100%" }}>Remove wallet from this device</button>
        </div>
    </Sheet>
  );
}
