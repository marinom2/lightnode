/** Swap: Uniswap v3 market swaps + the LCAI cross-network move. */
import { useEffect, useRef, useState } from "react";
import { wallet } from "./wallet-api";
import { humanizeError } from "../../src/rpc/humanize";
import { explorerFor } from "../../src/rpc/chains";
import { LCAI_ERC20 } from "../../src/rpc/bridge";
import { type Asset, assetKey, Ic, fmtBal, Sheet } from "./shared";

const LCAI_ON_ETH = { symbol: "LCAI", address: LCAI_ERC20, decimals: 18 } as const;
type SwapQuoteView = { amountOut: string; amountOutWei: string; fee: number; impactBps: number | null } | null;

export function SwapSheet({ from, chainId, assets, onClose, onDone }: { from: string; chainId: number; assets: Asset[]; onClose: () => void; onDone: () => void }) {
  const onLightChain = chainId === 9200 || chainId === 8200;
  const [mode, setMode] = useState<"market" | "network">(onLightChain ? "network" : "market");
  return (
    <Sheet title="Swap" onClose={onClose} dirty>
        <div className="tabs">
          <button className={`tab${mode === "market" ? " active" : ""}`} onClick={() => setMode("market")}>Market swap</button>
          <button className={`tab${mode === "network" ? " active" : ""}`} onClick={() => setMode("network")}>LCAI across networks</button>
        </div>
        {mode === "market" ? (
          onLightChain
            ? <p className="muted">Market swaps run on Ethereum and the EVM networks (there is no DEX on LightChain). Switch network to swap, or move LCAI across networks here.</p>
            : <MarketSwap from={from} chainId={chainId} assets={assets} onDone={onDone} />
        ) : (
          <NetworkMove from={from} onDone={onDone} />
        )}
    </Sheet>
  );
}

function MarketSwap({ from, chainId, assets, onDone }: { from: string; chainId: number; assets: Asset[]; onDone: () => void }) {
  // "to" candidates: the user's assets plus LCAI on Ethereum (the home token).
  const toList: Asset[] = chainId === 1 && !assets.some((a) => a.kind === "token" && a.address.toLowerCase() === LCAI_ON_ETH.address.toLowerCase())
    ? [...assets, { kind: "token", balance: "0", ...LCAI_ON_ETH }]
    : assets;
  const [tIn, setTIn] = useState<Asset>(assets[0]!);
  const [tOut, setTOut] = useState<Asset>(toList.find((a) => a.symbol !== assets[0]!.symbol) ?? toList[0]!);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuoteView | "loading" | null>(null);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const amtNum = Number(amount) || 0;
  const balKnown = tIn.balance !== null;
  const balNum = balKnown ? Number(tIn.balance) : 0;
  const insufficient = balKnown && amtNum > 0 && amtNum > balNum;
  const samePair = assetKey(tIn) === assetKey(tOut);
  const quotable = amtNum > 0 && !samePair;
  const quoteEpoch = useRef(0);
  useEffect(() => {
    if (!quotable) {
      setQuote(null);
      return;
    }
    setQuote("loading");
    const epoch = ++quoteEpoch.current;
    const t = setTimeout(() => {
      wallet<{ quote: SwapQuoteView }>({
        type: "quoteSwap", chainId,
        tokenIn: tIn.kind === "token" ? tIn.address : null, decimalsIn: tIn.kind === "token" ? tIn.decimals : 18,
        tokenOut: tOut.kind === "token" ? tOut.address : null, decimalsOut: tOut.kind === "token" ? tOut.decimals : 18,
        amountIn: amount,
        // Guard: a slow response for a previous amount must not win the race.
      }).then((r) => { if (quoteEpoch.current === epoch) setQuote(r.quote); }).catch(() => { if (quoteEpoch.current === epoch) setQuote(null); });
    }, 600);
    return () => clearTimeout(t);
  }, [quotable, amount, tIn, tOut, chainId]);
  const setMax = () => {
    if (!balKnown) return;
    if (tIn.kind === "token") return setAmount(tIn.balance ?? "0");
    // Native in: the swap needs value = amount + gas, so reserve a gas buffer.
    const reserve = chainId === 1 ? 0.003 : 0.0004;
    setAmount(Math.max(0, balNum - reserve).toFixed(6).replace(/\.?0+$/, "") || "0");
  };
  const swap = async () => {
    if (!quote || quote === "loading") return;
    setBusy(true);
    setErr(null);
    try {
      // The background re-quotes and derives the slippage floor itself; we only
      // pass what we showed the user so it can abort on a large adverse move.
      const r = await wallet<{ hash: string }>({
        type: "swap", from, chainId,
        tokenIn: tIn.kind === "token" ? tIn.address : null, decimalsIn: tIn.kind === "token" ? tIn.decimals : 18,
        tokenOut: tOut.kind === "token" ? tOut.address : null, decimalsOut: tOut.kind === "token" ? tOut.decimals : 18,
        amountIn: amount, expectedOutWei: quote.amountOutWei,
      });
      setHash(r.hash);
      onDone();
    } catch (e) {
      setErr(humanizeError((e as Error).message, tIn.symbol));
    } finally {
      setBusy(false);
    }
  };
  const pick = (list: Asset[], current: Asset, set: (a: Asset) => void) => (
    <div className="tabs" style={{ flexWrap: "wrap" }}>
      {list.map((a) => (
        <button key={assetKey(a)} className={`tab${assetKey(a) === assetKey(current) ? " active" : ""}`} onClick={() => set(a)}>{a.symbol}</button>
      ))}
    </div>
  );
  if (hash) {
    return (
      <>
        <p className="ok">Swap submitted. Your {tOut.symbol} arrives when the transaction confirms.</p>
        <a className="addr" href={`${explorerFor(chainId)}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction →</a>
      </>
    );
  }
  return (
    <>
      <div><div className="muted" style={{ marginBottom: 6 }}>You pay</div>{pick(assets, tIn, setTIn)}</div>
      <div>
        <input inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
        <div className="row between" style={{ marginTop: 6 }}>
          <span className="faint">{balKnown ? `${fmtBal(tIn.balance!)} ${tIn.symbol} available` : "Balance unavailable right now"}</span>
          <button className="ghost" style={{ padding: "3px 10px", fontSize: 11 }} disabled={!balKnown} onClick={setMax}>Max</button>
        </div>
      </div>
      <div><div className="muted" style={{ marginBottom: 6 }}>You receive</div>{pick(toList, tOut, setTOut)}</div>
      {samePair && <p className="faint">Pick two different assets.</p>}
      {insufficient && <p className="err">Not enough {tIn.symbol}. You have {fmtBal(tIn.balance!)}.</p>}
      {quote === "loading" && <p className="muted">Fetching the best price…</p>}
      {quote && quote !== "loading" && (
        <div className="card" style={{ padding: 10 }}>
          <div className="row between"><span className="muted">You receive ≈</span><b>{Number(quote.amountOut).toLocaleString(undefined, { maximumFractionDigits: 6 })} {tOut.symbol}</b></div>
          <div className="row between"><span className="faint">Min after 0.5% slippage</span><span className="faint">{(Number(quote.amountOut) * 0.995).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span></div>
          <div className="row between"><span className="faint">Pool fee</span><span className="faint">{quote.fee / 10000}%</span></div>
          {quote.impactBps != null && (
            <div className="row between"><span className="faint">Price impact</span><span className={quote.impactBps > 300 ? "err" : "faint"}>{(quote.impactBps / 100).toFixed(2)}%</span></div>
          )}
        </div>
      )}
      {quote === null && quotable && <p className="muted">No market found for this pair on this network.</p>}
      {quote && quote !== "loading" && quote.impactBps != null && quote.impactBps > 300 && (
        <p className="warn">High price impact: this trade moves the pool by {(quote.impactBps / 100).toFixed(1)}%. Consider a smaller amount.</p>
      )}
      {err && <p className="err">{err}</p>}
      <button disabled={!quote || quote === "loading" || insufficient || busy} onClick={swap}>{busy ? "Swapping…" : "Swap"}</button>
      <p className="faint">Swaps route through Uniswap v3 with a 0.5% slippage limit. Token approvals are exact-amount only.</p>
    </>
  );
}

function NetworkMove({ from, onDone }: { from: string; onDone: () => void }) {
  const [dir, setDir] = useState<"eth-to-lc" | "lc-to-eth">("eth-to-lc");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [srcBal, setSrcBal] = useState<string | null>(null);
  useEffect(() => {
    setFee(null);
    setSrcBal(null);
    wallet<{ fee: string }>({ type: "bridgeFee", direction: dir }).then((f) => setFee(f.fee)).catch(() => setFee(null));
    // Validate against the source-side balance before the node does.
    wallet<{ balance: string }>({ type: "bridgeBalance", direction: dir, account: from }).then((b) => setSrcBal(b.balance)).catch(() => {});
  }, [dir, from]);
  const [srcName, dstName] = dir === "eth-to-lc" ? ["Ethereum", "LightChain"] : ["LightChain", "Ethereum"];
  const explorer = dir === "eth-to-lc" ? "https://etherscan.io" : "https://mainnet.lightscan.app";
  const amtNum = Number(amount) || 0;
  const insufficient = srcBal !== null && amtNum > 0 && amtNum > Number(srcBal);
  const ok = amtNum > 0 && !insufficient;
  const move = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await wallet<{ hash: string }>({ type: "bridge", from, direction: dir, amount });
      setHash(r.hash);
      onDone();
    } catch (e) {
      setErr(humanizeError((e as Error).message, "LCAI"));
    } finally {
      setBusy(false);
    }
  };
  if (hash) {
    return (
      <>
        <p className="ok">Submitted on {srcName}. Your LCAI lands on {dstName} after the Hyperlane relay (~minutes).</p>
        <a className="addr" href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction →</a>
      </>
    );
  }
  return (
    <>
      <p className="muted">Moves LCAI between its Ethereum ERC-20 and native LightChain over the Hyperlane route.</p>
      <div className="tabs">
        <button className={`tab${dir === "eth-to-lc" ? " active" : ""}`} onClick={() => setDir("eth-to-lc")}>Ethereum → LightChain</button>
        <button className={`tab${dir === "lc-to-eth" ? " active" : ""}`} onClick={() => setDir("lc-to-eth")}>LightChain → Ethereum</button>
      </div>
      <div>
        <div className="muted" style={{ marginBottom: 6 }}>Amount (LCAI)</div>
        <input inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
        {srcBal !== null && (
          <div className="row between" style={{ marginTop: 6 }}>
            <span className="faint">{fmtBal(srcBal)} LCAI on {srcName}</span>
            <button className="ghost" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => setAmount(srcBal)}>Max</button>
          </div>
        )}
      </div>
      {insufficient && <p className="err">Not enough LCAI on {srcName}. You have {fmtBal(srcBal!)}.</p>}
      {fee && <p className="muted">Relayer fee ≈ {Number(fee).toLocaleString(undefined, { maximumFractionDigits: 6 })} {dir === "eth-to-lc" ? "ETH" : "LCAI"}</p>}
      <p className="faint">Signs on {srcName}{dir === "eth-to-lc" ? " (approve LCAI, then transfer)" : ""}.</p>
      {err && <p className="err">{err}</p>}
      <button disabled={!ok || busy} onClick={move}>{busy ? "Moving…" : `Move to ${dstName}`}</button>
    </>
  );
}
