/** The wallet home: header, hero, actions, tabs, cards. */
import { useCallback, useEffect, useRef, useState } from "react";
import { wallet, type WalletState, type WorkerStatusView } from "./wallet-api";
import { chainById, CHAIN_LIST, explorerFor, logoFor } from "../../src/rpc/chains";
import type { TokenBalance } from "../../src/rpc/tokens";
import type { NftItem } from "../../src/rpc/nfts";
import type { HistoryItem } from "../../src/rpc/history";
import { portfolioUsd, fmtUsd, type Prices } from "../../src/rpc/prices";
import { humanizeError } from "../../src/rpc/humanize";
import { type Asset, type DaoView, Ic, short, fmtBal, tokenLogo, avatarGradient, timeAgo, isExpanded, openFullTab, Change } from "./shared";
import { SendSheet, ReceiveSheet, ImportTokenSheet, ImportNftSheet, NftSheet, NftGrid } from "./sheets-assets";
import { SwapSheet } from "./sheets-swap";
import { DaoSheet } from "./sheets-dao";
import { WorkerSheet } from "./sheets-worker";
import { SettingsSheet } from "./sheets-settings";

export function WalletHome({ state, onChange }: { state: WalletState; onChange: () => void }) {
  const address = state.accounts[state.activeIndex] ?? state.accounts[0]!;
  // undefined = loading, null = unreachable (NEVER shown as zero), string = truth.
  const [bal, setBal] = useState<string | null | undefined>(undefined);
  const [sheet, setSheet] = useState<"send" | "receive" | "settings" | "swap" | "dao" | "worker" | "importToken" | "importNft" | null>(null);
  const [nftSel, setNftSel] = useState<NftItem | null>(null);
  const [nfts, setNfts] = useState<NftItem[] | null | undefined>(undefined);
  const [acctOpen, setAcctOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const chain = chainById(state.chainId);
  const sym = chain.nativeCurrency.symbol;
  const explorer = explorerFor(state.chainId);

  const [tokens, setTokens] = useState<TokenBalance[] | null | undefined>(undefined);
  // undefined = loading, null = explorer unreachable with no cache, [] = truly empty.
  const [history, setHistory] = useState<HistoryItem[] | null | undefined>(undefined);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [tab, setTab] = useState<"tokens" | "nfts" | "activity">("tokens");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all"); // lifted: survives tab switches
  const [hideZero, setHideZero] = useState(false);
  useEffect(() => {
    void chrome.storage.local.get("ui-hide-zero").then((r) => setHideZero(Boolean(r["ui-hide-zero"])));
  }, []);
  const toggleHideZero = () => {
    setHideZero((v) => {
      void chrome.storage.local.set({ "ui-hide-zero": !v });
      return !v;
    });
  };
  const chainId = state.chainId;
  // Guards in-flight responses: after an account/chain switch, a slow reply for
  // the OLD pair must not overwrite the new view (wrong-chain explorer links).
  const epochRef = useRef(0);
  const tickRef = useRef(0);
  // silent=true refreshes values in place (no skeleton flicker) for live updates.
  const loadBal = useCallback((silent = false) => {
    const epoch = ++epochRef.current;
    const live = () => epochRef.current === epoch;
    if (!silent) {
      setBal(undefined);
      setTokens(undefined);
      setPrices(null);
      setNfts(undefined);
      setHistory(undefined);
    }
    wallet<{ formatted: string }>({ type: "getBalance", address })
      .then((b) => live() && setBal(b.formatted))
      .catch(() => !silent && live() && setBal(null)); // unreachable, not zero
    wallet<TokenBalance[]>({ type: "getTokens", address }).then((ts) => {
      if (!live()) return;
      setTokens((prev) => {
        // Prices barely move tick to tick (CoinGecko rate limit), but a token
        // that APPEARS mid-session still needs its first quote.
        const newAddrs = ts.some((t) => !(prev ?? []).some((p) => p.address.toLowerCase() === t.address.toLowerCase()));
        if (!silent || newAddrs || tickRef.current % 4 === 0) {
          wallet<Prices>({ type: "getPrices", chainId, addresses: ts.map((t) => t.address) }).then((p) => live() && setPrices(p)).catch(() => {});
        }
        return ts;
      });
    }).catch(() => !silent && live() && setTokens(null));
    // Stale-while-revalidate: paint the cache instantly, then fetch fresh.
    if (!silent) {
      wallet<{ items: HistoryItem[] | null }>({ type: "getHistory", chainId, address })
        .then((r) => live() && r.items !== null && setHistory(r.items))
        .catch(() => {});
    }
    wallet<{ items: HistoryItem[] | null }>({ type: "getHistory", chainId, address, refresh: true })
      .then((r) => {
        if (!live()) return;
        if (r.items !== null) setHistory(r.items);
        else if (!silent) setHistory((h) => h ?? null); // unreachable + no cache -> error state
      })
      .catch(() => {});
  }, [address, chainId]);
  useEffect(() => loadBal(), [loadBal]);
  // The user should never have to reopen the popup to see a received payment.
  // refreshTick also re-fires the DAO/Worker cards (their balances move too).
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => { tickRef.current += 1; setRefreshTick(tickRef.current); loadBal(true); }, 15000);
    return () => clearInterval(t);
  }, [loadBal]);
  const loadNfts = useCallback(() => {
    setNfts(undefined);
    wallet<NftItem[]>({ type: "getNfts", chainId, owner: address }).then(setNfts).catch(() => setNfts(null));
  }, [chainId, address]);
  useEffect(() => {
    if (tab === "nfts" && nfts === undefined) loadNfts();
  }, [tab, nfts, loadNfts]);
  const usd = (sym: string, amount: number, addr?: string) => {
    if (!prices) return null;
    const price = addr ? prices.tokenUsd[addr.toLowerCase()] : prices.nativeUsd;
    return price ? fmtUsd(price * amount) : null;
  };
  const total = prices && typeof bal === "string" ? portfolioUsd(Number(bal), prices, (tokens ?? []).map((t) => ({ address: t.address, balance: Number(t.balance) }))) : 0;

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
    { kind: "native", symbol: sym, balance: typeof bal === "string" ? bal : "0" },
    ...(tokens ?? []).map((t) => ({ kind: "token" as const, symbol: t.symbol, address: t.address, decimals: t.decimals, balance: t.balance })),
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
        <div>
          {bal === undefined ? (
            <span className="skel" style={{ width: 120, height: 30, verticalAlign: "middle" }} />
          ) : (
            <span className="bal" title={bal === null ? "Could not refresh; retrying" : undefined}>{bal === null ? "--" : fmtBal(bal)}</span>
          )}
          <span className="sym">{sym}</span>
        </div>
        {total > 0 && <div className="sub">≈ {fmtUsd(total)} total</div>}
        <button className="copy-chip" onClick={copy}>{copied ? "Copied!" : short(address)} <Ic name="copy" size={13} /></button>
      </div>

      <div className="actions actions-4">
        <button className="act" onClick={() => setSheet("send")}><span className="ic"><Ic name="send" size={17} /></span>Send</button>
        <button className="act" onClick={() => setSheet("receive")}><span className="ic"><Ic name="receive" size={17} /></span>Receive</button>
        <button className="act" onClick={() => setSheet("swap")}><span className="ic"><Ic name="swap" size={16} /></span>Swap</button>
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
              {bal === undefined ? <span className="skel" style={{ width: 64 }} /> : bal === null ? <b style={{ fontSize: 13 }} title="Could not refresh">--</b> : <b style={{ fontSize: 13 }}>{fmtBal(bal)}</b>}
              {typeof bal === "string" && usd(sym, Number(bal)) && <div className="faint">{usd(sym, Number(bal))}</div>}
            </div>
          </div>
          {tokens === undefined && [0, 1].map((i) => (
            <div className="list-row" key={`skel-${i}`}><span className="token-ic skel-block" /><div className="grow"><span className="skel" style={{ width: 90 }} /></div><span className="skel" style={{ width: 50 }} /></div>
          ))}
          {tokens === null && <p className="faint" style={{ padding: "2px 4px" }}>Could not refresh token balances. They will retry automatically.</p>}
          {(tokens ?? []).filter((t) => !hideZero || Number(t.balance) > 0).map((t) => (
            <div className="list-row" key={t.address}>
              {tokenLogo(t.address) ? <img className="token-logo" src={tokenLogo(t.address)!} alt="" /> : <span className="token-ic">{t.symbol.slice(0, 2)}</span>}
              <div className="grow">
                <b style={{ fontSize: 13 }}>{t.symbol}{t.discovered && <span className="tag tag-auto" title="Found automatically; verify before trusting">auto</span>}</b>
                <div className="faint">{short(t.address)}{chg(t.address) != null && <Change pct={chg(t.address)!} />}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <b style={{ fontSize: 13 }}>{fmtBal(t.balance)}</b>
                {usd(t.symbol, Number(t.balance), t.address) && <div className="faint">{usd(t.symbol, Number(t.balance), t.address)}</div>}
              </div>
            </div>
          ))}
          <div className="row" style={{ gap: 8, marginTop: 2 }}>
            <button className="ghost" style={{ fontSize: 12, flex: 1 }} onClick={() => setSheet("importToken")}><Ic name="plus" size={13} /> Add token</button>
            <button className={`chip${hideZero ? " active" : ""}`} style={{ flexShrink: 0 }} onClick={toggleHideZero}>Hide zero</button>
          </div>
        </div>
      )}
      {tab === "nfts" && (
        <NftGrid nfts={nfts} onImport={() => setSheet("importNft")} onOpen={setNftSel} />
      )}
      {tab === "activity" && <HistoryList items={history} explorer={explorer} owner={address} filter={historyFilter} onFilter={setHistoryFilter} onRetry={() => loadBal()} />}

      <WorkerCard address={address} refreshKey={refreshTick} onOpen={() => setSheet("worker")} />

      <GovernanceCard chainId={chainId} address={address} refreshKey={refreshTick} onOpen={() => setSheet("dao")} />

      {sheet === "send" && <SendSheet from={address} assets={assets} explorer={explorer} chainId={chainId} own={state.accounts} onClose={() => setSheet(null)} onSent={loadBal} />}
      {sheet === "receive" && <ReceiveSheet address={address} chainName={chain.name} onClose={() => setSheet(null)} />}
      {sheet === "settings" && <SettingsSheet onClose={() => setSheet(null)} onRemoved={onChange} />}
      {sheet === "swap" && <SwapSheet from={address} chainId={chainId} assets={assets} onClose={() => setSheet(null)} onDone={loadBal} />}
      {sheet === "dao" && <DaoSheet from={address} onClose={() => setSheet(null)} />}
      {sheet === "worker" && <WorkerSheet address={address} onClose={() => setSheet(null)} />}
      {sheet === "importToken" && <ImportTokenSheet chainId={chainId} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadBal(); }} />}
      {sheet === "importNft" && <ImportNftSheet chainId={chainId} owner={address} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadNfts(); }} />}
      {nftSel && <NftSheet nft={nftSel} from={address} chainId={chainId} explorer={explorer} own={state.accounts} onClose={() => setNftSel(null)} onChanged={() => { setNftSel(null); loadNfts(); }} />}
    </>
  );
}


function GovernanceCard({ chainId, address, refreshKey, onOpen }: { chainId: number; address: string; refreshKey: number; onOpen: () => void }) {
  const [st, setSt] = useState<DaoView | null>(null);
  // Chain/account changed: drop the old chain's data (no stale cross-chain power).
  useEffect(() => setSt(null), [chainId, address]);
  useEffect(() => {
    let live = true;
    // refreshKey re-fires this silently: voting power updates without a reopen.
    wallet<DaoView>({ type: "daoStatus", chainId, address }).then((r) => { if (live) setSt(r); }).catch(() => {});
    return () => { live = false; };
  }, [chainId, address, refreshKey]);
  const power = st && st.supported ? Number(st.votingPower) : null;
  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}><Ic name="gov" size={12} /> Governance</h2>
        {power != null && <b style={{ fontSize: 14 }}>{power.toLocaleString(undefined, { maximumFractionDigits: 2 })} votes</b>}
      </div>
      {power != null && power > 0 && st && !st.delegated && <p className="faint" style={{ marginTop: 6 }}>Not delegated yet, so these votes do not count. Delegate on the DAO.</p>}
      <button className="ghost" style={{ width: "100%", marginTop: 10 }} onClick={onOpen}>Proposals + vote from the wallet →</button>
    </div>
  );
}

function WorkerCard({ address, refreshKey, onOpen }: { address: string; refreshKey: number; onOpen: () => void }) {
  const [s, setS] = useState<WorkerStatusView | null>(null);
  useEffect(() => setS(null), [address]); // new account: do not show the old one's stake
  useEffect(() => {
    let live = true;
    wallet<WorkerStatusView>({ type: "workerStatus", address }).then((r) => { if (live) setS(r); }).catch(() => {});
    return () => { live = false; };
  }, [address, refreshKey]);
  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}><Ic name="server" size={12} /> Worker</h2>
        {s?.registered && <span className="pill">registered</span>}
      </div>
      {s?.registered ? (
        <div className="row between" style={{ marginTop: 8 }}>
          <span className="muted">Claimable</span>
          <span className={s.claimableLcai > 0 ? "ok" : "addr"}>{s.claimableLcai.toLocaleString(undefined, { maximumFractionDigits: 2 })} LCAI</span>
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 6 }}>Run a LightChain AI worker and earn LCAI for inference jobs.</p>
      )}
      <button className="ghost" style={{ width: "100%", marginTop: 10 }} onClick={onOpen}>{s?.registered ? "Open the worker hub →" : "Explore the worker network →"}</button>
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
type HistoryFilter = "all" | "in" | "out" | "nft";
const HISTORY_FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in", label: "Received" },
  { key: "out", label: "Sent" },
  { key: "nft", label: "NFTs" },
];

function HistoryRow({ h, explorer, owner, onChanged }: { h: HistoryItem; explorer: string; owner: string; onChanged: () => void }) {
  const inbound = h.direction === "in";
  const self = h.direction === "self";
  const [busy, setBusy] = useState(false);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const title = h.kind === "contract" ? h.label : self ? `Self transfer · ${h.label}` : `${inbound ? "Received" : "Sent"} ${h.label}`;
  const amountClass = h.failed ? "strike" : inbound ? "ok" : "";
  const sign = self ? "" : inbound ? "+" : "-";
  const replace = async (mode: "speedup" | "cancel") => {
    setBusy(true);
    setRowErr(null);
    try {
      await wallet({ type: "replaceTx", from: owner, hash: h.hash, mode });
      onChanged();
    } catch (e) {
      setRowErr(humanizeError((e as Error).message, h.label));
    } finally {
      setBusy(false);
    }
  };
  const actionable = h.pending && !h.failed && h.direction === "out";
  const body = (
    <>
      <span className={`token-ic ${inbound ? "dir-in" : "dir-out"}`}><Ic name={inbound ? "receive" : "send"} size={14} /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <b style={{ fontSize: 13, display: "block" }} className="clamp">{title}</b>
        <div className="faint">
          {self ? "To yourself" : `${inbound ? "From" : "To"} ${h.counterparty ? short(h.counterparty) : "contract"}`} · {timeAgo(h.ts)}
          {h.failed && <span className="tag tag-bad">failed</span>}
          {h.pending && !h.failed && <span className="tag tag-warn">pending</span>}
        </div>
      </div>
      {h.kind === "nft" ? (
        <span className="pill">NFT</span>
      ) : h.amount ? (
        <b style={{ fontSize: 13, flexShrink: 0 }} className={amountClass}>{sign}{fmtBal(h.amount)}</b>
      ) : null}
    </>
  );
  if (!actionable) {
    return (
      <a className="list-row" href={`${explorer}/tx/${h.hash}`} target="_blank" rel="noreferrer" title="View on explorer" style={{ textDecoration: "none" }}>
        {body}
      </a>
    );
  }
  // Pending own tx: same row plus inline rescue actions (no explorer-only dead end).
  return (
    <div className="list-row" style={{ flexWrap: "wrap" }}>
      {body}
      <div className="row" style={{ gap: 6, width: "100%", marginTop: 8 }}>
        <button className="ghost" style={{ flex: 1, padding: "6px 0", fontSize: 11 }} disabled={busy} onClick={() => replace("speedup")}>Speed up</button>
        <button className="ghost" style={{ flex: 1, padding: "6px 0", fontSize: 11 }} disabled={busy} onClick={() => replace("cancel")}>Cancel</button>
        <a className="ghost-btnlike" href={`${explorer}/tx/${h.hash}`} target="_blank" rel="noreferrer">View</a>
      </div>
      {rowErr && <p className="err" style={{ width: "100%" }}>{rowErr}</p>}
    </div>
  );
}

function HistoryList({ items, explorer, owner, filter, onFilter, onRetry }: { items: HistoryItem[] | null | undefined; explorer: string; owner: string; filter: HistoryFilter; onFilter: (f: HistoryFilter) => void; onRetry: () => void }) {
  if (items === undefined) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {[0, 1, 2].map((i) => (
          <div className="list-row" key={i}><span className="token-ic skel-block" /><div className="grow"><span className="skel" style={{ width: 110 }} /></div><span className="skel" style={{ width: 46 }} /></div>
        ))}
      </div>
    );
  }
  if (items === null) {
    return (
      <div className="empty">
        <div className="empty-ic"><Ic name="external" size={20} /></div>
        Could not reach the network explorer, so your history is unknown right now.
        <button className="ghost" style={{ fontSize: 12, marginTop: 10 }} onClick={onRetry}>Try again</button>
      </div>
    );
  }
  const shown = items.filter((h) => {
    if (filter === "all") return true;
    if (filter === "nft") return h.kind === "nft";
    return h.direction === filter || h.direction === "self";
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div className="chips">
        {HISTORY_FILTERS.map((f) => (
          <button key={f.key} className={`chip${filter === f.key ? " active" : ""}`} onClick={() => onFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><Ic name={filter === "nft" ? "image" : filter === "in" ? "receive" : "send"} size={20} /></div>
          {filter === "all" ? "No activity yet on this network." : `Nothing ${filter === "nft" ? "NFT-related" : filter === "in" ? "received" : "sent"} yet on this network.`}
        </div>
      ) : (
        shown.map((h) => <HistoryRow key={h.logIndex != null ? `${h.hash}-${h.logIndex}` : `${h.hash}-${h.kind}-${h.direction}-${h.label}-${h.amount}`} h={h} explorer={explorer} owner={owner} onChanged={onRetry} />)
      )}
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
