/** Asset sheets: send, receive, token + NFT import, NFT detail. */
import { useEffect, useState } from "react";
import { encodeQR } from "qr";
import { wallet } from "./wallet-api";
import { assessRecipient } from "../../src/rpc/risk";
import { humanizeError } from "../../src/rpc/humanize";
import { logoFor, nftUrlFor } from "../../src/rpc/chains";
import type { NftItem } from "../../src/rpc/nfts";
import { type Asset, assetKey, Ic, short, fmtBal, tokenLogo, Sheet, avatarGradient } from "./shared";
import { looksLikeEnsName } from "../../src/rpc/ens";

export function NftGrid({ nfts, onImport, onOpen }: { nfts: NftItem[] | null | undefined; onImport: () => void; onOpen: (n: NftItem) => void }) {
  if (nfts === null) {
    return (
      <div className="empty">
        <div className="empty-ic"><Ic name="image" size={22} /></div>
        Could not check your NFTs right now.
        <span className="faint" style={{ display: "block", marginTop: 4 }}>The network may be busy. This retries automatically.</span>
      </div>
    );
  }
  if (nfts === undefined) {
    return (
      <div className="nft-grid">
        {[0, 1].map((i) => (
          <div className="nft-card" key={i}><div className="nft-img skel-block" /><div className="nft-meta"><span className="skel" style={{ width: 76 }} /></div></div>
        ))}
      </div>
    );
  }
  return (
    <>
      {nfts.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><Ic name="image" size={22} /></div>
          No NFTs on this network yet.
          <span className="faint" style={{ display: "block", marginTop: 4 }}>Import one with its contract address and token id.</span>
        </div>
      ) : (
        <div className="nft-grid">
          {nfts.map((n) => (
            <button className="nft-card" key={`${n.address}-${n.tokenId}`} onClick={() => onOpen(n)}>
              {n.image ? <img className="nft-img" src={n.image} alt="" loading="lazy" /> : <div className="nft-img nft-fallback"><Ic name="image" size={26} /></div>}
              <div className="nft-meta"><b>{n.name}</b><span className="faint">{n.collection || short(n.address)}</span></div>
            </button>
          ))}
        </div>
      )}
      <button className="ghost" style={{ fontSize: 12 }} onClick={onImport}><Ic name="plus" size={13} /> Import NFT</button>
    </>
  );
}
export function ImportNftSheet({ chainId, owner, onClose, onDone }: { chainId: number; owner: string; onClose: () => void; onDone: () => void }) {
  const [token, setToken] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(token.trim()) && /^\d+$/.test(tokenId.trim());
  const importIt = async () => {
    setBusy(true);
    setErr(null);
    try {
      await wallet({ type: "addNft", chainId, owner, token: token.trim(), tokenId: tokenId.trim() });
      onDone();
    } catch (e) {
      setErr(humanizeError((e as Error).message));
      setBusy(false);
    }
  };
  return (
    <Sheet title="Import NFT" onClose={onClose} dirty={Boolean(token || tokenId)} busy={busy}>
        <p className="muted">Ownership is verified on-chain before the NFT is added.</p>
        <div><div className="muted" style={{ marginBottom: 6 }}>Contract address</div><input placeholder="0x…" value={token} onChange={(e) => setToken(e.target.value)} /></div>
        {token.trim() && !/^0x[0-9a-fA-F]{40}$/.test(token.trim()) && <p className="faint">Not a valid 0x address.</p>}
        <div><div className="muted" style={{ marginBottom: 6 }}>Token id</div><input inputMode="numeric" placeholder="e.g. 1234" value={tokenId} onChange={(e) => setTokenId(e.target.value.replace(/\D/g, ""))} /></div>
        {err && <p className="err">{err}</p>}
        <button disabled={!valid || busy} onClick={importIt}>{busy ? "Verifying…" : "Import NFT"}</button>
    </Sheet>
  );
}
export function ImportTokenSheet({ chainId, onClose, onDone }: { chainId: number; onClose: () => void; onDone: () => void }) {
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
  const importIt = async () => {
    setBusy(true);
    setErr(null);
    try {
      await wallet({ type: "addToken", chainId, address: addr.trim() });
      onDone();
    } catch (e) {
      setErr(humanizeError((e as Error).message));
      setBusy(false);
    }
  };
  return (
    <Sheet title="Add token" onClose={onClose} dirty={Boolean(addr)} busy={busy}>
        <p className="muted">The symbol and decimals are read from the contract on this network.</p>
        <div><div className="muted" style={{ marginBottom: 6 }}>Token contract address</div><input placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} /></div>
        {addr.trim() && !valid && <p className="faint">Not a valid 0x address.</p>}
        {err && <p className="err">{err}</p>}
        <button disabled={!valid || busy} onClick={importIt}>{busy ? "Reading…" : "Add token"}</button>
    </Sheet>
  );
}
export function NftSheet({ nft, from, chainId, explorer, own, onClose, onChanged }: { nft: NftItem; from: string; chainId: number; explorer: string; own: string[]; onClose: () => void; onChanged: () => void }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const validAddr = /^0x[0-9a-fA-F]{40}$/.test(to.trim());
  // NFT transfers are irreversible too: same poisoning checks as the Send sheet.
  const risk = validAddr ? assessRecipient(to.trim(), known, own) : null;
  useEffect(() => {
    wallet<string[]>({ type: "knownRecipients" }).then(setKnown).catch(() => {});
  }, []);
  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await wallet<{ hash: string }>({ type: "sendNft", from, to: to.trim(), token: nft.address, tokenId: nft.tokenId, standard: nft.standard });
      setHash(r.hash);
    } catch (e) {
      setErr(humanizeError((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const remove = () => void wallet({ type: "removeNft", chainId, owner: from, token: nft.address, tokenId: nft.tokenId }).then(onChanged);
  // The tx is broadcast but unmined: drop it from the list now so the grid does
  // not keep showing an NFT that is on its way out.
  const doneAfterSend = () => void wallet({ type: "removeNft", chainId, owner: from, token: nft.address, tokenId: nft.tokenId }).then(onChanged);
  return (
    <Sheet title={nft.name} onClose={onClose} dirty={Boolean(to)} busy={busy}>
        {nft.image ? <img className="nft-hero" src={nft.image} alt="" /> : <div className="nft-hero nft-fallback"><Ic name="image" size={34} /></div>}
        <div className="row between">
          <span className="muted">{nft.collection || "Collection"} · #{nft.tokenId} · {nft.standard === "erc721" ? "ERC-721" : "ERC-1155"}</span>
          <a href={nftUrlFor(chainId, nft.address, nft.tokenId)} target="_blank" rel="noreferrer" style={{ fontSize: 12, flexShrink: 0 }}>Explorer →</a>
        </div>
        {hash ? (
          <>
            <p className="ok">Sent. The NFT leaves this wallet when the transaction confirms.</p>
            <a className="addr" href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction →</a>
            <button onClick={doneAfterSend}>Done</button>
          </>
        ) : (
          <>
            <div><div className="muted" style={{ marginBottom: 6 }}>Send to</div><input placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            {to.trim() && !validAddr && <p className="faint">Not a valid 0x address.</p>}
            {risk?.kind === "lookalike" && (
              <p className="danger-box">This address looks like {short(risk.similarTo!)} but is different - a common address-poisoning scam. Verify every character before sending.</p>
            )}
            {risk?.kind === "new" && <p className="muted">First time sending to this address.</p>}
            {risk?.kind === "known" && <p className="ok">You&apos;ve sent to this address before.</p>}
            {risk?.kind === "self" && <p className="muted">This is one of your own accounts.</p>}
            {err && <p className="err">{err}</p>}
            <div className="row" style={{ gap: 8 }}>
              {confirmRemove ? (
                <button className="danger" style={{ flex: 1 }} onClick={remove}>Really remove?</button>
              ) : (
                <button className="ghost" style={{ flex: 1 }} onClick={() => setConfirmRemove(true)}><Ic name="trash" size={13} /> Remove</button>
              )}
              <button style={{ flex: 2 }} disabled={!validAddr || busy} onClick={send}>{busy ? "Sending…" : "Send NFT"}</button>
            </div>
          </>
        )}
    </Sheet>
  );
}
export function SendSheet({ from, assets, explorer, chainId, own, onClose, onSent }: { from: string; assets: Asset[]; explorer: string; chainId: number; own: string[]; onClose: () => void; onSent: () => void }) {
  const [asset, setAsset] = useState<Asset>(assets[0]!);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fee, setFee] = useState<{ value: number; label: string } | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [labelDraft, setLabelDraft] = useState("");
  const [labelSaved, setLabelSaved] = useState(false);
  const [txState, setTxState] = useState<"pending" | "confirmed" | "failed">("pending");
  const [ens, setEns] = useState<{ name: string; address: string } | "resolving" | null>(null);
  const [speed, setSpeed] = useState<"slow" | "normal" | "fast">("normal");
  // ENS names resolve to the address actually used for checks and the send.
  const typedIsEns = looksLikeEnsName(to.trim());
  useEffect(() => {
    if (!typedIsEns) {
      setEns(null);
      return;
    }
    setEns("resolving");
    const name = to.trim();
    let liveResolve = true; // a slow resolution for a PREVIOUS name must not win
    const t = setTimeout(() => {
      wallet<{ address: string | null }>({ type: "resolveEns", name })
        .then((r) => liveResolve && setEns(r.address ? { name, address: r.address } : null))
        .catch(() => liveResolve && setEns(null));
    }, 500);
    return () => {
      liveResolve = false;
      clearTimeout(t);
    };
  }, [to, typedIsEns]);
  // Belt AND suspenders: the resolved pair must match what is in the input NOW.
  const recipient = typedIsEns && ens && ens !== "resolving" && ens.name === to.trim() ? ens.address : to.trim();
  const validAddr = /^0x[0-9a-fA-F]{40}$/.test(recipient);
  // Validate against the balance BEFORE the node does: catch "1 LCAI on an
  // empty account" inline instead of surfacing a raw RPC error after signing.
  // balance null = unknown (RPC unreachable): say so, never pretend it is 0.
  const balKnown = asset.balance !== null;
  const balNum = balKnown ? Number(asset.balance) : 0;
  const amtNum = Number(amount) || 0;
  const needed = asset.kind === "native" ? amtNum + (fee?.value ?? 0) : amtNum;
  const insufficient = balKnown && amtNum > 0 && needed > balNum;
  const quotable = validAddr && amtNum > 0;
  const ok = quotable && !insufficient;
  const risk = validAddr ? assessRecipient(recipient, known, own) : null;
  const setMax = () => {
    if (!balKnown) return;
    if (asset.kind === "token") return setAmount(asset.balance ?? "0");
    const spendable = Math.max(0, balNum - (fee ? fee.value * 1.1 : 0));
    setAmount(spendable.toFixed(6).replace(/\.?0+$/, "") || "0");
  };
  useEffect(() => {
    wallet<string[]>({ type: "knownRecipients" }).then(setKnown).catch(() => {});
    wallet<Record<string, string>>({ type: "getLabels" }).then(setLabels).catch(() => {});
  }, []);
  const saveLabel = () => {
    void wallet({ type: "setAddressLabel", address: recipient, label: labelDraft }).then(() => setLabelSaved(true)).catch(() => {});
  };
  useEffect(() => {
    if (!hash) return;
    let live = true;
    const poll = () =>
      wallet<{ status: "pending" | "confirmed" | "failed" }>({ type: "txStatus", hash }).then((r) => {
        if (!live) return;
        if (r.status === "pending") setTimeout(poll, 3000);
        else setTxState(r.status);
      }).catch(() => {});
    poll();
    return () => {
      live = false;
    };
  }, [hash]);
  useEffect(() => {
    if (!quotable) {
      setFee(null);
      return;
    }
    const t = setTimeout(() => {
      const req = asset.kind === "native"
        ? { type: "quoteSend" as const, from, to: recipient, valueWei: amount }
        : { type: "quoteSend" as const, from, to: recipient, token: asset.address, amount, decimals: asset.decimals };
      wallet<{ feeFormatted: string | null; feeSymbol: string }>(req)
        .then((q) => setFee(q.feeFormatted ? { value: Number(q.feeFormatted), label: `${Number(q.feeFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${q.feeSymbol}` } : null))
        .catch(() => setFee(null));
    }, 500);
    return () => clearTimeout(t);
  }, [quotable, recipient, amount, asset, from]);
  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = asset.kind === "native"
        ? await wallet<{ hash: string }>({ type: "send", from, to: recipient, valueWei: amount, speed })
        : await wallet<{ hash: string }>({ type: "sendToken", from, token: asset.address, to: recipient, amount, decimals: asset.decimals, speed });
      setHash(r.hash);
      onSent();
    } catch (e) {
      setErr(humanizeError((e as Error).message, asset.symbol));
    } finally {
      setBusy(false);
    }
  };
  const replace = async (mode: "speedup" | "cancel") => {
    if (!hash) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await wallet<{ hash: string }>({ type: "replaceTx", from, hash, mode });
      setHash(r.hash); // the poll re-tracks the replacement
      setTxState("pending");
    } catch (e) {
      setErr(humanizeError((e as Error).message, asset.symbol));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Send" onClose={onClose} dirty={Boolean(to || amount)} busy={busy}>
        {hash ? (
          <>
            <p className={txState === "failed" ? "err" : "ok"}>
              {txState === "pending" ? `Sent ${asset.symbol} - confirming…` : txState === "confirmed" ? `Confirmed. Your ${asset.symbol} arrived.` : "Transaction failed on-chain."}
            </p>
            <a className="addr" href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction →</a>
            {txState === "pending" && (
              <div className="row" style={{ gap: 8 }}>
                <button className="ghost" style={{ flex: 1 }} disabled={busy} onClick={() => replace("speedup")}>Speed up</button>
                <button className="ghost" style={{ flex: 1 }} disabled={busy} onClick={() => replace("cancel")}>Cancel tx</button>
              </div>
            )}
            {!labels[recipient.toLowerCase()] && !labelSaved ? (
              <div className="row" style={{ gap: 8 }}>
                <input placeholder="Label this recipient (e.g. My worker rig)" maxLength={24} value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} />
                <button className="ghost" style={{ flexShrink: 0 }} disabled={!labelDraft.trim()} onClick={saveLabel}>Save</button>
              </div>
            ) : labelSaved ? (
              <p className="ok">Saved. Future sends show this name.</p>
            ) : null}
            <button onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            {assets.length > 1 && (
              <div className="tabs" style={{ flexWrap: "wrap" }}>
                {assets.map((a) => {
                  const logo = a.kind === "native" ? logoFor(chainId) : tokenLogo(a.address);
                  return (
                    <button key={assetKey(a)} className={`tab${assetKey(a) === assetKey(asset) ? " active" : ""}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={() => setAsset(a)}>
                      {logo && <img src={logo} alt="" style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff" }} />}
                      {a.symbol}
                    </button>
                  );
                })}
              </div>
            )}
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Recipient</div>
              <input placeholder="0x address or ENS name" value={to} onChange={(e) => setTo(e.target.value)} />
              {typedIsEns && ens === "resolving" && <p className="faint" style={{ marginTop: 4 }}>Resolving name…</p>}
              {typedIsEns && ens && ens !== "resolving" && <p className="ok" style={{ marginTop: 4 }}>{ens.name} → {short(ens.address)}</p>}
              {typedIsEns && ens === null && to.trim().length > 5 && <p className="faint" style={{ marginTop: 4 }}>Could not resolve this name on Ethereum.</p>}
              {!typedIsEns && to.trim().length > 5 && !validAddr && <p className="faint" style={{ marginTop: 4 }}>Not a valid 0x address or ENS name.</p>}
              {!to && known.length > 0 && (
                <div className="chips" style={{ marginTop: 6, flexWrap: "wrap" }}>
                  {known.slice(0, 3).map((k) => (
                    <button key={k} className="chip" onClick={() => setTo(k)} title={k}>{labels[k.toLowerCase()] ?? short(k)}</button>
                  ))}
                </div>
              )}
            </div>
            {risk?.kind === "lookalike" && (
              <p className="danger-box">This address looks like {short(risk.similarTo!)} but is different - a common address-poisoning scam. Verify every character before sending.</p>
            )}
            {risk?.kind === "new" && <p className="muted">First time sending to this address.</p>}
            {risk?.kind === "known" && <p className="ok">You&apos;ve sent to this address before.</p>}
            {risk?.kind === "self" && <p className="muted">This is one of your own accounts.</p>}
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Amount ({asset.symbol})</div>
              <input inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
              <div className="row between" style={{ marginTop: 6 }}>
                <span className="faint">{balKnown ? `${fmtBal(asset.balance!)} ${asset.symbol} available` : "Balance unavailable right now (it will not block your send)"}</span>
                <button className="ghost" style={{ padding: "3px 10px", fontSize: 11 }} disabled={!balKnown} onClick={setMax}>Max</button>
              </div>
            </div>
            {insufficient && <p className="err">Not enough {asset.symbol}. You have {fmtBal(asset.balance!)}{asset.kind === "native" && fee ? `, and the network fee is ${fee.label}` : ""}.</p>}
            {!insufficient && fee && (
              <div className="row between">
                <span className="muted">Network fee ≈ {fee.label}</span>
                <span className="chips">
                  {(["slow", "normal", "fast"] as const).map((sp) => (
                    <button key={sp} className={`chip${speed === sp ? " active" : ""}`} style={{ padding: "3px 9px", fontSize: 10.5 }} onClick={() => setSpeed(sp)}>{sp === "slow" ? "Slow" : sp === "normal" ? "Normal" : "Fast"}</button>
                  ))}
                </span>
              </div>
            )}
            {err && <p className="err">{err}</p>}
            <button disabled={!ok || busy} onClick={send}>{busy ? "Sending…" : `Send ${asset.symbol}`}</button>
          </>
        )}
    </Sheet>
  );
}
export function ReceiveSheet({ address, chainName, onClose }: { address: string; chainName: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <Sheet title="Receive" onClose={onClose}>
        <p className="muted">Your address on {chainName} - the same on every EVM chain:</p>
        <div className="qr" dangerouslySetInnerHTML={{ __html: encodeQR(address, "svg") }} />
        <div className="card addr" style={{ textAlign: "center", fontSize: 13, lineHeight: 1.7 }}>{address}</div>
        <button onClick={copy}>{copied ? "Copied!" : "Copy address"}</button>
    </Sheet>
  );
}

/** Pick an account avatar: any owned NFT image on this network, or the gradient. */
export function AvatarSheet({ address, chainId, current, onClose }: { address: string; chainId: number; current: string | null; onClose: () => void }) {
  const [nfts, setNfts] = useState<NftItem[] | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    wallet<NftItem[]>({ type: "getNfts", chainId, owner: address }).then(setNfts).catch(() => setNfts(null));
  }, [chainId, address]);
  const pick = async (image: string | null) => {
    setBusy(true);
    try {
      await wallet({ type: "setAvatar", address, image });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const withImages = (nfts ?? []).filter((n) => n.image);
  return (
    <Sheet title="Choose avatar" onClose={onClose} busy={busy}>
      <p className="muted">Pick one of your NFTs as this account's face, or keep the gradient.</p>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button className={`avatar-pick${current === null ? " sel" : ""}`} title="Default gradient" onClick={() => pick(null)}>
          <span className="avatar" style={{ background: avatarGradient(address) }} />
        </button>
        {withImages.map((n) => (
          <button key={`${n.address}-${n.tokenId}`} className={`avatar-pick${current === n.image ? " sel" : ""}`} title={n.name} onClick={() => pick(n.image)}>
            <img src={n.image!} alt={n.name} />
          </button>
        ))}
      </div>
      {nfts === undefined && <span className="skel" style={{ width: 140 }} />}
      {nfts !== undefined && withImages.length === 0 && (
        <p className="faint">No NFT images on this network yet. Import an NFT (NFTs tab) and it appears here.</p>
      )}
    </Sheet>
  );
}
