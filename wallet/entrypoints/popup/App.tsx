import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createMnemonic, isValidMnemonic } from "../../src/keyring/mnemonic";
import { decodeDangerousCall, type Severity } from "../../src/provider/decode-call";
import { summarizeTypedData } from "../../src/provider/typed-data";
import { encodeQR } from "qr";
import { chainById, CHAIN_LIST, explorerFor, logoFor, nftUrlFor } from "../../src/rpc/chains";
import type { TokenBalance } from "../../src/rpc/tokens";
import type { ActivityEntry } from "../../src/provider/protocol";
import { assessRecipient } from "../../src/rpc/risk";
import { portfolioUsd, fmtUsd, type Prices } from "../../src/rpc/prices";
import { humanizeError } from "../../src/rpc/humanize";
import type { NftItem } from "../../src/rpc/nfts";
import { wallet, type WalletState, type PendingRequest, type WorkerStatusView } from "./wallet-api";

type Asset = { kind: "native"; symbol: string; balance: string } | { kind: "token"; symbol: string; address: string; decimals: number; balance: string };

const SEVERITY_CLASS: Record<Severity, string> = { info: "muted", warn: "warn", danger: "danger-box" };
const SUPPORTED_IDS = CHAIN_LIST.map((c) => c.id);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
// Bundled token marks; unknown tokens fall back to a monogram chip.
const tokenLogo = (symbol: string): string | null => (symbol.toUpperCase() === "USDC" ? "/tokens/usdc.png" : null);
const fmtBal = (s: string) => Number(s).toLocaleString(undefined, { maximumFractionDigits: Number(s) >= 1 ? 4 : 6 });
const isApproveWindow = () => window.location.hash.includes("approve");
const isExpanded = () => window.location.hash.includes("expanded");
const openFullTab = () => void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html#/expanded") });

function avatarGradient(addr: string): string {
  let h = 0;
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 80% 62%), hsl(${(h + 70) % 360} 80% 55%))`;
}

const ICONS: Record<string, string> = {
  send: "M7 17 17 7M8 7h9v9",
  receive: "M12 4v15M19 12l-7 7-7-7",
  copy: "M9 9h10v10H9zM5 15V5h10",
  chevron: "M6 9l6 6 6-6",
  back: "M15 18l-6-6 6-6",
  lock: "M7 11V8a5 5 0 0110 0v3M5 11h14v9H5z",
  check: "M5 12l5 5L20 7",
  external: "M14 4h6v6M20 4l-9 9M10 5H5v14h14v-5",
  x: "M6 6l12 12M18 6 6 18",
  settings: "M20 7h-9M14 17H5M17 14a3 3 0 100 6 3 3 0 000-6zM7 4a3 3 0 100 6 3 3 0 000-6z",
  plus: "M12 5v14M5 12h14",
  expand: "M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3m13-5v3a2 2 0 01-2 2h-3",
  edit: "M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z",
  image: "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6M8.5 9.5a1 1 0 110-2 1 1 0 010 2z",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
};
function Ic({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function App() {
  const [state, setState] = useState<WalletState | null>(null);
  const refresh = useCallback(async () => setState(await wallet<WalletState>({ type: "getState" })), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (isApproveWindow()) return <Shell><Brand /><ApproveView /></Shell>;
  if (!state) return <Shell><Brand /><p className="muted">Loading…</p></Shell>;
  if (!state.hasVault) return <Shell><Onboarding onDone={refresh} /></Shell>;
  if (!state.unlocked) return <Shell><Unlock onDone={refresh} /></Shell>;
  return <Shell><WalletHome state={state} onChange={refresh} /></Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  const expanded = isExpanded();
  useEffect(() => {
    if (expanded) document.body.classList.add("expanded-body");
  }, [expanded]);
  return <div className={`wrap${expanded ? " expanded" : ""}`}>{children}</div>;
}

function Brand() {
  return <div className="brand"><img className="brand-mark" src="/lightnode.png" alt="" /> LightNode Wallet</div>;
}

// ---- onboarding ------------------------------------------------------------

function Onboarding({ onDone }: { onDone: () => void }) {
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

// ---- wallet home -----------------------------------------------------------

function WalletHome({ state, onChange }: { state: WalletState; onChange: () => void }) {
  const address = state.accounts[state.activeIndex] ?? state.accounts[0]!;
  const [bal, setBal] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"send" | "receive" | "settings" | "bridge" | "importToken" | "importNft" | null>(null);
  const [nftSel, setNftSel] = useState<NftItem | null>(null);
  const [nfts, setNfts] = useState<NftItem[] | null>(null);
  const [acctOpen, setAcctOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const chain = chainById(state.chainId);
  const sym = chain.nativeCurrency.symbol;
  const explorer = explorerFor(state.chainId);

  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [tab, setTab] = useState<"tokens" | "nfts" | "activity">("tokens");
  const chainId = state.chainId;
  const loadBal = useCallback(() => {
    setBal(null);
    setTokens([]);
    setPrices(null);
    setNfts(null);
    wallet<{ formatted: string }>({ type: "getBalance", address }).then((b) => setBal(b.formatted)).catch(() => setBal("0"));
    wallet<TokenBalance[]>({ type: "getTokens", address }).then((ts) => {
      setTokens(ts);
      wallet<Prices>({ type: "getPrices", chainId, addresses: ts.map((t) => t.address) }).then(setPrices).catch(() => {});
    }).catch(() => setTokens([]));
    wallet<ActivityEntry[]>({ type: "getActivity", chainId }).then(setActivity).catch(() => setActivity([]));
  }, [address, chainId]);
  useEffect(loadBal, [loadBal]);
  const loadNfts = useCallback(() => {
    setNfts(null);
    wallet<NftItem[]>({ type: "getNfts", chainId, owner: address }).then(setNfts).catch(() => setNfts([]));
  }, [chainId, address]);
  useEffect(() => {
    if (tab === "nfts" && nfts === null) loadNfts();
  }, [tab, nfts, loadNfts]);
  const usd = (sym: string, amount: number, addr?: string) => {
    if (!prices) return null;
    const price = addr ? prices.tokenUsd[addr.toLowerCase()] : prices.nativeUsd;
    return price ? fmtUsd(price * amount) : null;
  };
  const total = prices && bal != null ? portfolioUsd(Number(bal), prices, tokens.map((t) => ({ address: t.address, balance: Number(t.balance) }))) : 0;

  const copy = () => {
    void navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const switchChain = (id: number) => void wallet({ type: "setChain", chainId: id }).then(onChange);
  const selectAccount = (i: number) => void wallet({ type: "setActiveAccount", index: i }).then(onChange);
  const addAccount = () => void wallet({ type: "addAccount" }).then(onChange);
  const rename = (i: number, name: string) => void wallet({ type: "setAccountName", index: i, name }).then(onChange);
  const acctName = (i: number) => state.names?.[i]?.trim() || `Account ${i + 1}`;
  const chg = (addr?: string): number | null => {
    if (!prices) return null;
    const c = addr ? prices.tokenChange24h[addr.toLowerCase()] : prices.nativeChange24h;
    return typeof c === "number" ? c : null;
  };
  const assets: Asset[] = [
    { kind: "native", symbol: sym, balance: bal ?? "0" },
    ...tokens.map((t) => ({ kind: "token" as const, symbol: t.symbol, address: t.address, decimals: t.decimals, balance: t.balance })),
  ];

  return (
    <>
      <div className="header">
        <div className="net" style={{ minWidth: 0 }}>
          <button className="acct-btn" onClick={() => setAcctOpen((o) => !o)}>
            <span className="avatar" style={{ background: avatarGradient(address), width: 26, height: 26 }} />
            <span className="acct"><b>{acctName(state.activeIndex)}</b></span>
            <Ic name="chevron" size={13} />
          </button>
          {acctOpen && (
            <AccountMenu accounts={state.accounts} names={state.names ?? []} activeIndex={state.activeIndex} onSelect={selectAccount} onAdd={addAccount} onRename={rename} onClose={() => setAcctOpen(false)} />
          )}
        </div>
        <span className="spacer" />
        <NetworkSwitcher chainId={state.chainId} onSwitch={switchChain} />
        {!isExpanded() && <button className="icon-btn" title="Open in full tab" onClick={openFullTab}><Ic name="expand" size={15} /></button>}
        <button className="icon-btn" title="Settings" onClick={() => setSheet("settings")}><Ic name="settings" size={15} /></button>
        <button className="icon-btn" title="Lock" onClick={() => void wallet({ type: "lock" }).then(onChange)}><Ic name="lock" size={15} /></button>
      </div>

      <div className="hero">
        <div className="hero-chain"><img className="net-logo" src={logoFor(chainId)} alt="" /> {chain.name}</div>
        <div><span className="bal">{bal == null ? "…" : fmtBal(bal)}</span><span className="sym">{sym}</span></div>
        {total > 0 && <div className="sub">≈ {fmtUsd(total)} total</div>}
        <button className="copy-chip" onClick={copy}>{copied ? "Copied!" : short(address)} <Ic name="copy" size={13} /></button>
      </div>

      <div className="actions">
        <button className="act" onClick={() => setSheet("send")}><span className="ic"><Ic name="send" size={17} /></span>Send</button>
        <button className="act" onClick={() => setSheet("receive")}><span className="ic"><Ic name="receive" size={17} /></span>Receive</button>
        <a className="act" href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer"><span className="ic"><Ic name="external" size={16} /></span>Explorer</a>
      </div>

      <div className="tabs">
        <button className={`tab${tab === "tokens" ? " active" : ""}`} onClick={() => setTab("tokens")}>Tokens</button>
        <button className={`tab${tab === "nfts" ? " active" : ""}`} onClick={() => setTab("nfts")}>NFTs</button>
        <button className={`tab${tab === "activity" ? " active" : ""}`} onClick={() => setTab("activity")}>Activity</button>
      </div>

      {tab === "tokens" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div className="list-row">
            <img className="token-logo" src={logoFor(chainId)} alt="" />
            <div className="grow">
              <b style={{ fontSize: 13 }}>{chain.nativeCurrency.name}</b>
              <div className="faint">{sym}{chg() != null && <Change pct={chg()!} />}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              {bal == null ? <span className="skel" style={{ width: 64 }} /> : <b style={{ fontSize: 13 }}>{fmtBal(bal)}</b>}
              {bal != null && usd(sym, Number(bal)) && <div className="faint">{usd(sym, Number(bal))}</div>}
            </div>
          </div>
          {tokens.map((t) => (
            <div className="list-row" key={t.address}>
              {tokenLogo(t.symbol) ? <img className="token-logo" src={tokenLogo(t.symbol)!} alt="" /> : <span className="token-ic">{t.symbol.slice(0, 2)}</span>}
              <div className="grow">
                <b style={{ fontSize: 13 }}>{t.symbol}</b>
                <div className="faint">{short(t.address)}{chg(t.address) != null && <Change pct={chg(t.address)!} />}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <b style={{ fontSize: 13 }}>{fmtBal(t.balance)}</b>
                {usd(t.symbol, Number(t.balance), t.address) && <div className="faint">{usd(t.symbol, Number(t.balance), t.address)}</div>}
              </div>
            </div>
          ))}
          <button className="ghost" style={{ fontSize: 12, marginTop: 2 }} onClick={() => setSheet("importToken")}><Ic name="plus" size={13} /> Add token</button>
        </div>
      )}
      {tab === "nfts" && (
        <NftGrid nfts={nfts} onImport={() => setSheet("importNft")} onOpen={setNftSel} />
      )}
      {tab === "activity" && <ActivityList items={activity} explorer={explorer} />}

      {chainId === 9200 && <WorkerPanel address={address} />}

      <GovernanceCard chainId={chainId} address={address} />

      <div className="card">
        <h2>More</h2>
        <button className="ghost" style={{ width: "100%" }} onClick={() => setSheet("bridge")}>Bridge LCAI · Ethereum ⇄ LightChain</button>
        <p className="faint" style={{ marginTop: 8 }}>Encrypted AI inference lands next.</p>
      </div>

      {sheet === "send" && <SendSheet from={address} assets={assets} explorer={explorer} chainId={chainId} own={state.accounts} onClose={() => setSheet(null)} onSent={loadBal} />}
      {sheet === "receive" && <ReceiveSheet address={address} chainName={chain.name} onClose={() => setSheet(null)} />}
      {sheet === "settings" && <SettingsSheet onClose={() => setSheet(null)} onRemoved={onChange} />}
      {sheet === "bridge" && <BridgeSheet from={address} onClose={() => setSheet(null)} onSent={loadBal} />}
      {sheet === "importToken" && <ImportTokenSheet chainId={chainId} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadBal(); }} />}
      {sheet === "importNft" && <ImportNftSheet chainId={chainId} owner={address} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadNfts(); }} />}
      {nftSel && <NftSheet nft={nftSel} from={address} chainId={chainId} explorer={explorer} own={state.accounts} onClose={() => setNftSel(null)} onChanged={() => { setNftSel(null); loadNfts(); }} />}
    </>
  );
}

type DaoView = { supported: boolean; votingPower: string; delegated: boolean; voteUrl: string };

function GovernanceCard({ chainId, address }: { chainId: number; address: string }) {
  const [st, setSt] = useState<DaoView | null>(null);
  useEffect(() => {
    let live = true;
    setSt(null);
    wallet<DaoView>({ type: "daoStatus", chainId, address }).then((r) => { if (live) setSt(r); }).catch(() => { if (live) setSt(null); });
    return () => { live = false; };
  }, [chainId, address]);
  if (!st || !st.supported) return null;
  const power = Number(st.votingPower);
  return (
    <div className="card">
      <h2>Governance</h2>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="muted">Your voting power</span>
        <b style={{ fontSize: 15 }}>{power.toLocaleString(undefined, { maximumFractionDigits: 4 })}</b>
      </div>
      {power > 0 && !st.delegated && <p className="faint" style={{ marginTop: 6 }}>These tokens are not delegated, so they do not count toward any vote yet. Activate them on the DAO.</p>}
      <a href={st.voteUrl} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 8, fontSize: 12 }}>{power > 0 ? "Vote on the LightChain DAO →" : "Open the LightChain DAO →"}</a>
    </div>
  );
}

function BridgeSheet({ from, onClose, onSent }: { from: string; onClose: () => void; onSent: () => void }) {
  const [dir, setDir] = useState<"eth-to-lc" | "lc-to-eth">("eth-to-lc");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setFee(null);
    wallet<{ fee: string }>({ type: "bridgeFee", direction: dir }).then((f) => setFee(f.fee)).catch(() => setFee(null));
  }, [dir]);
  const [srcName, dstName] = dir === "eth-to-lc" ? ["Ethereum", "LightChain"] : ["LightChain", "Ethereum"];
  const explorer = dir === "eth-to-lc" ? "https://etherscan.io" : "https://mainnet.lightscan.app";
  const ok = Number(amount) > 0;
  const bridge = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await wallet<{ hash: string }>({ type: "bridge", from, direction: dir, amount });
      setHash(r.hash);
      onSent();
    } catch (e) {
      setErr(humanizeError((e as Error).message, "LCAI"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h1>Bridge LCAI</h1><button className="icon-btn" onClick={onClose}><Ic name="x" size={15} /></button></div>
        {hash ? (
          <>
            <p className="ok">Submitted on {srcName}. Your LCAI lands on {dstName} after the Hyperlane relay (~minutes).</p>
            <a className="addr" href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction →</a>
            <button onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <div className="tabs">
              <button className={`tab${dir === "eth-to-lc" ? " active" : ""}`} onClick={() => setDir("eth-to-lc")}>Eth → LC</button>
              <button className={`tab${dir === "lc-to-eth" ? " active" : ""}`} onClick={() => setDir("lc-to-eth")}>LC → Eth</button>
            </div>
            <div><div className="muted" style={{ marginBottom: 6 }}>Amount (LCAI)</div><input inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
            {fee && <p className="muted">Relayer fee ≈ {Number(fee).toLocaleString(undefined, { maximumFractionDigits: 6 })} {dir === "eth-to-lc" ? "ETH" : "LCAI"}</p>}
            <p className="faint">Signs on {srcName}{dir === "eth-to-lc" ? " (approve LCAI, then transfer)" : ""}.</p>
            {err && <p className="err">{err}</p>}
            <button disabled={!ok || busy} onClick={bridge}>{busy ? "Bridging…" : `Bridge to ${dstName}`}</button>
          </>
        )}
      </div>
    </div>
  );
}

function AccountMenu({ accounts, names, activeIndex, onSelect, onAdd, onRename, onClose }: { accounts: string[]; names: string[]; activeIndex: number; onSelect: (i: number) => void; onAdd: () => void; onRename: (i: number, name: string) => void; onClose: () => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const save = (i: number) => {
    onRename(i, draft);
    setEditing(null);
  };
  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 20 }} onClick={onClose} />
      <div className="net-menu" style={{ left: 0, right: "auto", width: 248 }}>
        {accounts.map((a, i) => (
          <div key={a} className={`net-item${i === activeIndex ? " sel" : ""}`} style={{ cursor: "default" }}>
            {editing === i ? (
              <>
                <input autoFocus value={draft} placeholder={`Account ${i + 1}`} maxLength={24} style={{ padding: "5px 8px", fontSize: 12 }}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => save(i)}
                  onKeyDown={(e) => { if (e.key === "Enter") save(i); if (e.key === "Escape") setEditing(null); }} />
                <button className="icon-btn" style={{ width: 26, height: 26, flexShrink: 0 }} title="Save" onMouseDown={(e) => { e.preventDefault(); save(i); }}><Ic name="check" size={13} /></button>
              </>
            ) : (
              <>
                <button style={{ all: "unset", display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => { onSelect(i); onClose(); }}>
                  <span className="avatar" style={{ width: 22, height: 22, background: avatarGradient(a), flexShrink: 0 }} />
                  <span className="grow" style={{ minWidth: 0 }}><b style={{ fontSize: 12 }}>{names[i]?.trim() || `Account ${i + 1}`}</b><span className="faint" style={{ display: "block" }}>{short(a)}</span></span>
                </button>
                {i === activeIndex && <span className="check"><Ic name="check" size={14} /></span>}
                <button className="icon-btn" style={{ width: 26, height: 26, flexShrink: 0 }} title="Rename" onClick={() => { setEditing(i); setDraft(names[i] ?? ""); }}><Ic name="edit" size={12} /></button>
              </>
            )}
          </div>
        ))}
        <button className="net-item" style={{ color: "var(--brand)", fontWeight: 600 }} onClick={() => { onAdd(); onClose(); }}>
          <Ic name="plus" size={15} /> Add account
        </button>
      </div>
    </>
  );
}

function SettingsSheet({ onClose, onRemoved }: { onClose: () => void; onRemoved: () => void }) {
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
    <div className="sheet" onClick={onClose}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h1>Settings</h1><button className="icon-btn" onClick={onClose}><Ic name="x" size={15} /></button></div>
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
      </div>
    </div>
  );
}

function ActivityList({ items, explorer }: { items: ActivityEntry[]; explorer: string }) {
  if (items.length === 0) return <div className="empty">No activity yet on this network. Your sends will appear here.</div>;
  const ago = (ts: number) => {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {items.map((e) => (
        <a className="list-row" key={e.hash} href={`${explorer}/tx/${e.hash}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
          <span className="token-ic"><Ic name="send" size={14} /></span>
          <div className="grow"><b style={{ fontSize: 13 }}>Sent {e.symbol}</b><div className="faint">To {short(e.to)} · {ago(e.ts)}</div></div>
          <b style={{ fontSize: 13 }}>-{fmtBal(e.amount)}</b>
        </a>
      ))}
    </div>
  );
}

function NetworkSwitcher({ chainId, onSwitch }: { chainId: number; onSwitch: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="net">
      <button className="net-btn" title={chainById(chainId).name} onClick={() => setOpen((o) => !o)}>
        <img className="net-logo" src={logoFor(chainId)} alt="" />
        <Ic name="chevron" size={13} />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
          <div className="net-menu">
            {CHAIN_LIST.map((c) => (
              <button key={c.id} className={`net-item${c.id === chainId ? " sel" : ""}`} onClick={() => { onSwitch(c.id); setOpen(false); }}>
                <img className="net-logo" src={logoFor(c.id)} alt="" />
                {c.name}
                {c.id === chainId && <span className="check"><Ic name="check" size={15} /></span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Change({ pct }: { pct: number }) {
  // Derive sign from the ROUNDED value so -0.004 never renders a red "-0.00%".
  const rounded = Number(pct.toFixed(2)) + 0;
  if (Math.abs(rounded) < 0.005) return <span className="chg faint">0.00%</span>;
  const up = rounded > 0;
  return <span className={`chg ${up ? "chg-up" : "chg-down"}`}>{up ? "+" : ""}{rounded.toFixed(2)}%</span>;
}

function NftGrid({ nfts, onImport, onOpen }: { nfts: NftItem[] | null; onImport: () => void; onOpen: (n: NftItem) => void }) {
  if (nfts === null) {
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

function ImportNftSheet({ chainId, owner, onClose, onDone }: { chainId: number; owner: string; onClose: () => void; onDone: () => void }) {
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
    <div className="sheet" onClick={onClose}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h1>Import NFT</h1><button className="icon-btn" onClick={onClose}><Ic name="x" size={15} /></button></div>
        <p className="muted">Ownership is verified on-chain before the NFT is added.</p>
        <div><div className="muted" style={{ marginBottom: 6 }}>Contract address</div><input placeholder="0x…" value={token} onChange={(e) => setToken(e.target.value)} /></div>
        {token.trim() && !/^0x[0-9a-fA-F]{40}$/.test(token.trim()) && <p className="faint">Not a valid 0x address.</p>}
        <div><div className="muted" style={{ marginBottom: 6 }}>Token id</div><input inputMode="numeric" placeholder="e.g. 1234" value={tokenId} onChange={(e) => setTokenId(e.target.value.replace(/\D/g, ""))} /></div>
        {err && <p className="err">{err}</p>}
        <button disabled={!valid || busy} onClick={importIt}>{busy ? "Verifying…" : "Import NFT"}</button>
      </div>
    </div>
  );
}

function ImportTokenSheet({ chainId, onClose, onDone }: { chainId: number; onClose: () => void; onDone: () => void }) {
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
    <div className="sheet" onClick={onClose}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h1>Add token</h1><button className="icon-btn" onClick={onClose}><Ic name="x" size={15} /></button></div>
        <p className="muted">The symbol and decimals are read from the contract on this network.</p>
        <div><div className="muted" style={{ marginBottom: 6 }}>Token contract address</div><input placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} /></div>
        {addr.trim() && !valid && <p className="faint">Not a valid 0x address.</p>}
        {err && <p className="err">{err}</p>}
        <button disabled={!valid || busy} onClick={importIt}>{busy ? "Reading…" : "Add token"}</button>
      </div>
    </div>
  );
}

function NftSheet({ nft, from, chainId, explorer, own, onClose, onChanged }: { nft: NftItem; from: string; chainId: number; explorer: string; own: string[]; onClose: () => void; onChanged: () => void }) {
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
      void wallet({ type: "addActivity", entry: { hash: r.hash, to: to.trim(), amount: "1", symbol: `NFT ${nft.name.slice(0, 24)}`, chainId, ts: Date.now() } });
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
    <div className="sheet" onClick={onClose}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h1 className="clamp">{nft.name}</h1><button className="icon-btn" onClick={onClose}><Ic name="x" size={15} /></button></div>
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
      </div>
    </div>
  );
}

function SendSheet({ from, assets, explorer, chainId, own, onClose, onSent }: { from: string; assets: Asset[]; explorer: string; chainId: number; own: string[]; onClose: () => void; onSent: () => void }) {
  const [asset, setAsset] = useState<Asset>(assets[0]!);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fee, setFee] = useState<{ value: number; label: string } | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [txState, setTxState] = useState<"pending" | "confirmed" | "failed">("pending");
  const validAddr = /^0x[0-9a-fA-F]{40}$/.test(to.trim());
  // Validate against the balance BEFORE the node does: catch "1 LCAI on an
  // empty account" inline instead of surfacing a raw RPC error after signing.
  const balNum = Number(asset.balance);
  const amtNum = Number(amount) || 0;
  const needed = asset.kind === "native" ? amtNum + (fee?.value ?? 0) : amtNum;
  const insufficient = amtNum > 0 && needed > balNum;
  const quotable = validAddr && amtNum > 0;
  const ok = quotable && !insufficient;
  const risk = validAddr ? assessRecipient(to.trim(), known, own) : null;
  const setMax = () => {
    if (asset.kind === "token") return setAmount(asset.balance);
    const spendable = Math.max(0, balNum - (fee ? fee.value * 1.1 : 0));
    setAmount(spendable.toFixed(6).replace(/\.?0+$/, "") || "0");
  };
  useEffect(() => {
    wallet<string[]>({ type: "knownRecipients" }).then(setKnown).catch(() => {});
  }, []);
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
        ? { type: "quoteSend" as const, from, to: to.trim(), valueWei: amount }
        : { type: "quoteSend" as const, from, to: to.trim(), token: asset.address, amount, decimals: asset.decimals };
      wallet<{ feeFormatted: string | null; feeSymbol: string }>(req)
        .then((q) => setFee(q.feeFormatted ? { value: Number(q.feeFormatted), label: `${Number(q.feeFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${q.feeSymbol}` } : null))
        .catch(() => setFee(null));
    }, 500);
    return () => clearTimeout(t);
  }, [quotable, to, amount, asset, from]);
  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = asset.kind === "native"
        ? await wallet<{ hash: string }>({ type: "send", from, to: to.trim(), valueWei: amount })
        : await wallet<{ hash: string }>({ type: "sendToken", from, token: asset.address, to: to.trim(), amount, decimals: asset.decimals });
      setHash(r.hash);
      void wallet({ type: "addActivity", entry: { hash: r.hash, to: to.trim(), amount, symbol: asset.symbol, chainId, ts: Date.now() } });
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
    <div className="sheet" onClick={onClose}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h1>Send</h1><button className="icon-btn" onClick={onClose}><Ic name="x" size={15} /></button></div>
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
            <button onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            {assets.length > 1 && (
              <div className="tabs" style={{ flexWrap: "wrap" }}>
                {assets.map((a) => {
                  const logo = a.kind === "native" ? logoFor(chainId) : tokenLogo(a.symbol);
                  return (
                    <button key={a.symbol} className={`tab${a.symbol === asset.symbol ? " active" : ""}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={() => setAsset(a)}>
                      {logo && <img src={logo} alt="" style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff" }} />}
                      {a.symbol}
                    </button>
                  );
                })}
              </div>
            )}
            <div><div className="muted" style={{ marginBottom: 6 }}>Recipient</div><input placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value)} /></div>
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
                <span className="faint">{fmtBal(asset.balance)} {asset.symbol} available</span>
                <button className="ghost" style={{ padding: "3px 10px", fontSize: 11 }} onClick={setMax}>Max</button>
              </div>
            </div>
            {insufficient && <p className="err">Not enough {asset.symbol}. You have {fmtBal(asset.balance)}{asset.kind === "native" && fee ? `, and the network fee is ${fee.label}` : ""}.</p>}
            {!insufficient && fee && <p className="muted">Network fee ≈ {fee.label}</p>}
            {err && <p className="err">{err}</p>}
            <button disabled={!ok || busy} onClick={send}>{busy ? "Sending…" : `Send ${asset.symbol}`}</button>
          </>
        )}
      </div>
    </div>
  );
}

function ReceiveSheet({ address, chainName, onClose }: { address: string; chainName: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h1>Receive</h1><button className="icon-btn" onClick={onClose}><Ic name="x" size={15} /></button></div>
        <p className="muted">Your address on {chainName} - the same on every EVM chain:</p>
        <div className="qr" dangerouslySetInnerHTML={{ __html: encodeQR(address, "svg") }} />
        <div className="card addr" style={{ textAlign: "center", fontSize: 13, lineHeight: 1.7 }}>{address}</div>
        <button onClick={copy}>{copied ? "Copied!" : "Copy address"}</button>
      </div>
    </div>
  );
}

function WorkerPanel({ address }: { address: string }) {
  const [s, setS] = useState<WorkerStatusView | "loading" | "error">("loading");
  useEffect(() => {
    setS("loading");
    wallet<WorkerStatusView>({ type: "workerStatus", address }).then(setS).catch(() => setS("error"));
  }, [address]);
  if (s === "loading") return <div className="card"><h2>Worker</h2><p className="muted">Checking the registry…</p></div>;
  if (s === "error") return <div className="card"><h2>Worker</h2><p className="muted">Could not reach the worker registry.</p></div>;
  if (!s.registered) {
    return (
      <div className="card">
        <h2>Worker</h2>
        <p className="muted">Not a registered LightChain worker. <a href="https://lightchain.ai/onboard" target="_blank" rel="noreferrer">Run a worker →</a></p>
      </div>
    );
  }
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Worker</h2><span className="pill">registered</span></div>
      <div className="row between" style={{ marginTop: 8 }}><span className="muted">Stake</span><span className="addr">{fmt(s.stakeLcai)} LCAI</span></div>
      <div className="row between"><span className="muted">Headroom</span><span className="addr">{fmt(s.headroomLcai)}</span></div>
      {s.claimableLcai > 0 && <div className="row between"><span className="muted">Claimable</span><span className="ok">{fmt(s.claimableLcai)} LCAI</span></div>}
      {s.belowFloor && <p className="warn">Below the stake floor - top up to keep earning.</p>}
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
