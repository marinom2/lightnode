/**
 * Background service worker = the ONLY place plaintext keys exist (in volatile
 * module memory). Owns the vault, the unlocked session, dapp RPC routing, and the
 * approval queue. Content/inpage scripts are dumb relays; the popup is the UI.
 *
 * Session model (per security review C1): we keep the encrypted vault in
 * storage.local and, while unlocked, the mnemonic in storage.session - which is
 * in-memory, TRUSTED_CONTEXTS-only (content scripts can't read it), and cleared on
 * browser restart / extension reload. We do NOT "encrypt the seed with a key stored
 * beside it" (that adds surface for zero gain). Threat model documented in README.
 */
import { createPublicClient, http, parseEther, formatEther, formatUnits, type TypedDataDefinition } from "viem";
import { Keyring } from "../src/keyring/keyring";
import { parseTypedData } from "../src/provider/typed-data";
import { DEFAULT_TOKENS, readTokenBalances, fetchTokenMeta, erc20TransferData, discoverTokens, stripControls, type TokenMeta } from "../src/rpc/tokens";
import { CG_NATIVE, CG_PLATFORM, LCAI_PRICE_CONTRACT, type Prices } from "../src/rpc/prices";
import { parseTransfers, netChanges, NATIVE_SENTINEL, type SimLog } from "../src/rpc/simulate";
import { bridgeTransfer, bridgeFee, bridgeSourceBalance } from "../src/rpc/bridge";
import { daoStatus } from "../src/rpc/dao";
import { importNft, stillOwned, nftTransferData, type NftItem } from "../src/rpc/nfts";
import { fetchHistory, mergeHistory, type HistoryItem } from "../src/rpc/history";
import { quoteSwap, executeSwap, type SwapSide } from "../src/rpc/swap";
import { listProposals, castVoteData, GOVERNORS } from "../src/rpc/governance";
import { readWorkerStatus, readNetworkStats, readWorkerLifetime, withdrawTarget } from "../src/rpc/worker";
import { readGasTiers, type GasSpeed } from "../src/rpc/gas";
import { resolveEnsName } from "../src/rpc/ens";
import { encryptVault, decryptVault, type EncryptedVault } from "../src/keyring/vault";
import { chainById, isSupportedChain, DEFAULT_CHAIN_ID } from "../src/rpc/chains";
import { type BgMessage, type WalletOp, type JsonRpcRequest, type ActivityEntry, EVENT_PORT, RpcError } from "../src/provider/protocol";
import { APPROVAL_REQUIRED, LOCAL_READ, isAllowedMethod } from "../src/provider/rpc-methods";
import { canonicalizeDappTx } from "../src/provider/dapp-tx";

const VAULT_KEY = "vault";
const SESSION_KEY = "session-mnemonic";
const PERMS_KEY = "connected-origins";
const CHAIN_KEY = "selected-chain";
const COUNT_KEY = "account-count";
const ACTIVE_KEY = "active-account";
const NAMES_KEY = "account-names";
// Per-owner: account A's prune must never touch account B's imports (review).
const NFTS_KEY = (chainId: number, owner: string) => `nfts-${chainId}-${owner.toLowerCase()}`;
const AUTO_LOCK_MIN = 15;

// How many accounts to derive (persisted, so added accounts survive lock/unlock).
async function accountCount(): Promise<number> {
  const { [COUNT_KEY]: n } = await browser.storage.local.get(COUNT_KEY);
  return typeof n === "number" && n >= 1 ? n : 1;
}
async function activeIndex(max: number): Promise<number> {
  const { [ACTIVE_KEY]: i } = await browser.storage.local.get(ACTIVE_KEY);
  return typeof i === "number" && i >= 0 && i < max ? i : 0;
}

let live: Keyring | null = null;
const pending = new Map<string, { request: JsonRpcRequest; origin: string; resolve: (r: unknown) => void; reject: (e: { code: number; message: string }) => void }>();
let pendingSeq = 0;

// Long-lived ports from each tab's content script. We push EIP-1193 events
// (chainChanged / accountsChanged) through them when the popup changes state.
interface EventPort {
  name: string;
  postMessage: (msg: unknown) => void;
  onDisconnect: { addListener: (cb: () => void) => void };
  sender?: { url?: string; origin?: string };
}
// port -> the page origin it belongs to, so per-origin events (e.g. a revoke)
// reach only that site instead of broadcasting a disconnect to every tab.
const eventPorts = new Map<EventPort, string>();
function emitEvent(event: string, data: unknown, onlyOrigin?: string): void {
  for (const [port, origin] of eventPorts) {
    if (onlyOrigin && origin !== onlyOrigin) continue;
    try {
      port.postMessage({ event, data });
    } catch {
      eventPorts.delete(port); // the tab went away mid-send
    }
  }
}

// The user's selected network (persisted). Every read/write/sign uses it.
async function selectedChainId(): Promise<number> {
  const { [CHAIN_KEY]: id } = await browser.storage.local.get(CHAIN_KEY);
  return typeof id === "number" && isSupportedChain(id) ? id : DEFAULT_CHAIN_ID;
}
const clientFor = (id: number) => createPublicClient({ chain: chainById(id), transport: http() });
const publicClient = async () => clientFor(await selectedChainId());

// Tracked tokens per chain = the shipped defaults + any the user added.
const TOKENS_KEY = (chainId: number) => `tokens-${chainId}`;
async function trackedTokens(chainId: number): Promise<TokenMeta[]> {
  const key = TOKENS_KEY(chainId);
  const { [key]: user = [] } = (await browser.storage.local.get(key)) as Record<string, TokenMeta[]>;
  return [...(DEFAULT_TOKENS[chainId] ?? []), ...user];
}

// ---- session lifecycle -----------------------------------------------------

async function restore(): Promise<Keyring | null> {
  if (live) return live;
  const { [SESSION_KEY]: mnemonic } = await browser.storage.session.get(SESSION_KEY);
  if (typeof mnemonic === "string" && mnemonic) live = Keyring.fromMnemonic(mnemonic, await accountCount());
  return live;
}

async function bumpAutoLock(): Promise<void> {
  await browser.alarms.create("autolock", { delayInMinutes: AUTO_LOCK_MIN });
}

async function lock(): Promise<void> {
  live?.wipe();
  live = null;
  await browser.storage.session.remove(SESSION_KEY);
}

browser.alarms.onAlarm.addListener((a) => {
  if (a.name === "autolock") void lock();
});

// ---- wallet ops (from our popup) -------------------------------------------

async function handleWalletOp(op: WalletOp): Promise<unknown> {
  switch (op.type) {
    case "getState": {
      const { [VAULT_KEY]: vault } = await browser.storage.local.get(VAULT_KEY);
      const kr = await restore();
      const accounts = kr ? kr.accounts.map((a) => a.address) : [];
      const { [NAMES_KEY]: names = [] } = (await browser.storage.local.get(NAMES_KEY)) as { [NAMES_KEY]?: string[] };
      return {
        hasVault: Boolean(vault),
        unlocked: Boolean(kr),
        accounts,
        activeIndex: await activeIndex(accounts.length || 1),
        chainId: await selectedChainId(),
        names,
      };
    }
    case "setChain": {
      if (!isSupportedChain(op.chainId)) throw RpcError.invalidParams;
      await browser.storage.local.set({ [CHAIN_KEY]: op.chainId });
      emitEvent("chainChanged", `0x${op.chainId.toString(16)}`); // notify connected dapps
      return { chainId: op.chainId };
    }
    case "setActiveAccount": {
      await browser.storage.local.set({ [ACTIVE_KEY]: op.index });
      const kr = await restore();
      const addr = kr?.accounts[op.index]?.address;
      if (addr) emitEvent("accountsChanged", [addr]); // notify connected dapps
      return { ok: true };
    }
    case "revealMnemonic": {
      const { [VAULT_KEY]: vault } = (await browser.storage.local.get(VAULT_KEY)) as { vault?: EncryptedVault };
      if (!vault) throw RpcError.invalidParams;
      return { mnemonic: await decryptVault(vault, op.password) }; // throws "Invalid password"
    }
    case "removeWallet": {
      await lock();
      // Clear everything tied to this wallet's identity, not just the vault:
      // stale names/NFT lists must not attach to a different seed imported later.
      const all = (await browser.storage.local.get(null)) as Record<string, unknown>;
      const stale = Object.keys(all).filter((k) => k.startsWith("nfts-") || k.startsWith("tokens-") || k.startsWith("history-") || k.startsWith("disc-meta-"));
      await browser.storage.local.remove([VAULT_KEY, COUNT_KEY, ACTIVE_KEY, NAMES_KEY, PERMS_KEY, "activity", ...stale]);
      return { ok: true };
    }
    case "createVault":
    case "importVault": {
      const vault = await encryptVault(op.mnemonic, op.password);
      await browser.storage.local.set({ [VAULT_KEY]: vault, [COUNT_KEY]: 1, [ACTIVE_KEY]: 0 });
      await browser.storage.session.set({ [SESSION_KEY]: op.mnemonic });
      live = Keyring.fromMnemonic(op.mnemonic, 1);
      await bumpAutoLock();
      return { unlocked: true, accounts: live.accounts.map((a) => a.address) };
    }
    case "unlock": {
      const { [VAULT_KEY]: vault } = (await browser.storage.local.get(VAULT_KEY)) as { vault?: EncryptedVault };
      if (!vault) throw RpcError.invalidParams;
      const mnemonic = await decryptVault(vault, op.password); // throws "Invalid password"
      live = Keyring.fromMnemonic(mnemonic, await accountCount());
      await browser.storage.session.set({ [SESSION_KEY]: mnemonic });
      await bumpAutoLock();
      return { unlocked: true, accounts: live.accounts.map((a) => a.address) };
    }
    case "lock":
      await lock();
      return { unlocked: false };
    case "addAccount": {
      const kr = await restore();
      if (!kr) throw RpcError.locked;
      const acct = kr.addAccount();
      await browser.storage.local.set({ [COUNT_KEY]: kr.accounts.length });
      await bumpAutoLock();
      return { address: acct.address };
    }
    case "getBalance": {
      const wei = await (await publicClient()).getBalance({ address: op.address as `0x${string}` });
      return { wei: wei.toString(), formatted: formatEther(wei) };
    }
    case "getTokens": {
      const cid = await selectedChainId();
      const [tracked, discovered] = await Promise.all([trackedTokens(cid), discoverTokens(cid, op.address)]);
      // Merge: tracked wins on duplicates; discovery is additive. Balances are
      // re-read on-chain for ALL of them, so the indexer never sets a number.
      // Discovered symbol/decimals are re-read ON-CHAIN once (cached): the
      // indexer must not control what the send path divides by.
      const known = new Set(tracked.map((t) => t.address.toLowerCase()));
      const fresh = discovered.filter((d) => !known.has(d.address.toLowerCase()));
      const metaKey = `disc-meta-${cid}`;
      const { [metaKey]: metaCache = {} } = (await browser.storage.local.get(metaKey)) as Record<string, Record<string, TokenMeta>>;
      let cacheDirty = false;
      const verified: TokenMeta[] = [];
      for (const d of fresh) {
        const k = d.address.toLowerCase();
        let m = metaCache[k];
        if (!m) {
          try {
            const onchain = await fetchTokenMeta(clientFor(cid), d.address);
            m = { ...onchain, symbol: stripControls(onchain.symbol) || "?" };
            metaCache[k] = m;
            cacheDirty = true;
          } catch {
            continue; // unverifiable contract: do not show it at all
          }
        }
        verified.push(m);
      }
      if (cacheDirty) await browser.storage.local.set({ [metaKey]: metaCache });
      const discoveredSet = new Set(verified.map((v) => v.address.toLowerCase()));
      const balances = await readTokenBalances(clientFor(cid), op.address as `0x${string}`, [...tracked, ...verified]);
      return balances.map((b) => (discoveredSet.has(b.address.toLowerCase()) ? { ...b, discovered: true } : b));
    }
    case "addToken": {
      const meta = await fetchTokenMeta(clientFor(op.chainId), op.address);
      const key = TOKENS_KEY(op.chainId);
      const { [key]: list = [] } = (await browser.storage.local.get(key)) as Record<string, TokenMeta[]>;
      if (!list.some((t) => t.address.toLowerCase() === meta.address.toLowerCase())) {
        await browser.storage.local.set({ [key]: [...list, meta] });
      }
      return meta;
    }
    case "workerStatus":
      // Worker contracts live on LightChain mainnet, so read there regardless of
      // the selected network. Returns number/bool fields only (clone-safe).
      return readWorkerStatus(clientFor(9200), op.address as `0x${string}`);
    case "send": {
      const kr = await restore();
      const acct = kr?.accountFor(op.from);
      if (!acct) throw RpcError.locked;
      await bumpAutoLock();
      const hash = await signAndSend(acct.account, op.to as `0x${string}`, parseEther(op.valueWei), undefined, op.speed);
      void logActivity({ hash, to: op.to, amount: op.valueWei, symbol: chainById(await selectedChainId()).nativeCurrency.symbol, chainId: await selectedChainId(), ts: Date.now(), from: op.from, kind: "native" });
      return { hash };
    }
    case "gasTiers":
      return readGasTiers(clientFor(await selectedChainId()));
    case "resolveEns":
      return { address: await resolveEnsName(op.name) };
    case "quoteSend": {
      // Estimate the network fee (gas x fee/gas) before the user signs.
      const cid = await selectedChainId();
      const client = clientFor(cid);
      const feeSymbol = chainById(cid).nativeCurrency.symbol;
      try {
        const gas = op.token
          ? await client.estimateGas({ account: op.from as `0x${string}`, to: op.token as `0x${string}`, data: erc20TransferData(op.to, op.amount ?? "0", op.decimals ?? 18) })
          : await client.estimateGas({ account: op.from as `0x${string}`, to: op.to as `0x${string}`, value: parseEther(op.valueWei ?? "0"), data: op.data && /^0x[0-9a-fA-F]*$/.test(op.data) ? (op.data as `0x${string}`) : undefined });
        const fees = await client.estimateFeesPerGas().catch(() => null);
        const perGas = fees?.maxFeePerGas ?? (await client.getGasPrice());
        return { feeFormatted: formatEther(gas * perGas), feeSymbol };
      } catch {
        return { feeFormatted: null, feeSymbol };
      }
    }
    case "replaceTx": {
      // Speed up or cancel a pending tx: rebroadcast with the SAME nonce and a
      // fee bumped >=30% (replacement needs >=10%). Cancel = 0-value self-send.
      const kr = await restore();
      const acct = kr?.accountFor(op.from);
      if (!acct) throw RpcError.locked;
      const cid = await selectedChainId();
      const client = clientFor(cid);
      const orig = await client.getTransaction({ hash: op.hash as `0x${string}` });
      const bump = (v: bigint) => (v * 130n) / 100n;
      const base = orig.maxFeePerGas ?? orig.gasPrice ?? (await client.getGasPrice());
      const prio = orig.maxPriorityFeePerGas ?? base / 10n;
      const { createWalletClient } = await import("viem");
      const w = createWalletClient({ account: acct.account, chain: chainById(cid), transport: http() });
      await bumpAutoLock();
      const tx =
        op.mode === "cancel"
          ? { to: op.from as `0x${string}`, value: 0n, nonce: orig.nonce, maxFeePerGas: bump(base), maxPriorityFeePerGas: bump(prio) }
          : { to: orig.to ?? (op.from as `0x${string}`), value: orig.value, data: orig.input, nonce: orig.nonce, maxFeePerGas: bump(base), maxPriorityFeePerGas: bump(prio) };
      const replacement = await w.sendTransaction(tx);
      // Re-point the local send log at the replacement, or the old hash would
      // sit in Activity as "pending" forever (the explorer never indexes it).
      const { activity = [] } = (await browser.storage.local.get("activity")) as { activity?: ActivityEntry[] };
      await browser.storage.local.set({ activity: activity.map((e) => (e.hash.toLowerCase() === op.hash.toLowerCase() ? { ...e, hash: replacement } : e)) });
      return { hash: replacement };
    }
    case "daoStatus":
      return daoStatus(op.chainId, op.address);
    case "getNfts": {
      // Return the imported list, pruning anything the account no longer owns.
      const key = NFTS_KEY(op.chainId, op.owner);
      const { [key]: list = [] } = (await browser.storage.local.get(key)) as Record<string, NftItem[]>;
      const owned = await Promise.all(list.map((n) => stillOwned(clientFor(op.chainId), op.owner as `0x${string}`, n)));
      const kept = list.filter((_, i) => owned[i]);
      if (kept.length !== list.length) await browser.storage.local.set({ [key]: kept });
      return kept;
    }
    case "addNft": {
      const item = await importNft(clientFor(op.chainId), op.owner as `0x${string}`, op.token as `0x${string}`, op.tokenId);
      const key = NFTS_KEY(op.chainId, op.owner);
      const { [key]: list = [] } = (await browser.storage.local.get(key)) as Record<string, NftItem[]>;
      const dup = list.some((n) => n.address.toLowerCase() === item.address.toLowerCase() && n.tokenId === item.tokenId);
      if (!dup) await browser.storage.local.set({ [key]: [...list, item] });
      return item;
    }
    case "removeNft": {
      const key = NFTS_KEY(op.chainId, op.owner);
      const { [key]: list = [] } = (await browser.storage.local.get(key)) as Record<string, NftItem[]>;
      await browser.storage.local.set({ [key]: list.filter((n) => !(n.address.toLowerCase() === op.token.toLowerCase() && n.tokenId === op.tokenId)) });
      return true;
    }
    case "sendNft": {
      const kr = await restore();
      const acct = kr?.accountFor(op.from);
      if (!acct) throw RpcError.locked;
      await bumpAutoLock();
      const data = nftTransferData(op.standard, op.from, op.to, op.tokenId);
      const hash = await signAndSend(acct.account, op.token as `0x${string}`, 0n, data);
      void logActivity({ hash, to: op.to, amount: "1", symbol: "NFT", chainId: await selectedChainId(), ts: Date.now(), from: op.from, kind: "nft" });
      return { hash };
    }
    case "getOrigins": {
      const { [PERMS_KEY]: perms = {} } = (await browser.storage.local.get(PERMS_KEY)) as { [PERMS_KEY]?: Record<string, string[]> };
      return Object.keys(perms);
    }
    case "revokeOrigin": {
      const { [PERMS_KEY]: perms = {} } = (await browser.storage.local.get(PERMS_KEY)) as { [PERMS_KEY]?: Record<string, string[]> };
      const { [op.origin]: _gone, ...rest } = perms;
      await browser.storage.local.set({ [PERMS_KEY]: rest });
      emitEvent("accountsChanged", [], op.origin); // ONLY the revoked site sees the disconnect
      return true;
    }
    case "getHistory": {
      // Stale-while-revalidate, driven by the popup: refresh=false returns the
      // cache instantly (no network); refresh=true (or no cache yet) fetches.
      // items=null means UNKNOWN (explorer unreachable, no cache) - never
      // conflate that with an empty history.
      const cacheKey = `history-${op.chainId}-${op.address.toLowerCase()}`;
      const { [cacheKey]: cached = null } = (await browser.storage.local.get(cacheKey)) as Record<string, HistoryItem[] | null>;
      const symbol = chainById(op.chainId).nativeCurrency.symbol;
      let base: HistoryItem[] | null = cached;
      if (op.refresh || cached === null) {
        const fresh = await fetchHistory(op.chainId, op.address, symbol).catch(() => null);
        if (fresh) {
          // A partial answer (one endpoint 429ed) must not erase cached rows.
          base = fresh.complete ? fresh.items : mergeHistory(fresh.items, cached ?? []);
          if (fresh.complete) await browser.storage.local.set({ [cacheKey]: base });
        }
      }
      if (base === null) return { items: null };
      const { activity = [] } = (await browser.storage.local.get("activity")) as { activity?: ActivityEntry[] };
      const indexed = new Set(base.map((h) => h.hash.toLowerCase()));
      const me = op.address.toLowerCase();
      const pending: HistoryItem[] = activity
        .filter((e) => e.chainId === op.chainId && e.from?.toLowerCase() === me && !indexed.has(e.hash.toLowerCase()))
        .map((e) => ({
          hash: e.hash,
          direction: "out" as const,
          kind: e.kind ?? (e.symbol === symbol ? ("native" as const) : ("token" as const)),
          label: e.symbol.replace(/^NFT /, ""),
          amount: e.kind === "nft" ? "" : e.amount,
          counterparty: e.to,
          ts: e.ts,
          failed: false,
          pending: true,
        }));
      return { items: mergeHistory(pending, base) };
    }
    case "quoteSwap": {
      const tIn: SwapSide = { token: op.tokenIn as `0x${string}` | null, decimals: op.decimalsIn };
      const tOut: SwapSide = { token: op.tokenOut as `0x${string}` | null, decimals: op.decimalsOut };
      return { quote: await quoteSwap(op.chainId, tIn, tOut, op.amountIn) };
    }
    case "swap": {
      const kr = await restore();
      const acct = kr?.accountFor(op.from);
      if (!acct) throw RpcError.locked;
      await bumpAutoLock();
      const tIn: SwapSide = { token: op.tokenIn as `0x${string}` | null, decimals: op.decimalsIn };
      const tOut: SwapSide = { token: op.tokenOut as `0x${string}` | null, decimals: op.decimalsOut };
      const res = await executeSwap(acct.account, op.chainId, tIn, tOut, op.amountIn, BigInt(op.expectedOutWei), Math.floor(Date.now() / 1000));
      const meta = op.tokenIn ? (await trackedTokens(op.chainId)).find((t) => t.address.toLowerCase() === op.tokenIn!.toLowerCase()) : null;
      void logActivity({ hash: res.hash, to: "swap", amount: op.amountIn, symbol: meta?.symbol ?? chainById(op.chainId).nativeCurrency.symbol, chainId: op.chainId, ts: Date.now(), from: op.from, kind: op.tokenIn ? "token" : "native" });
      return res;
    }
    case "getProposals":
      return { proposals: await listProposals(op.chainId, op.voter) };
    case "castVote": {
      const kr = await restore();
      const acct = kr?.accountFor(op.from);
      if (!acct) throw RpcError.locked;
      const governor = GOVERNORS[op.chainId];
      if (!governor) throw RpcError.invalidParams;
      await bumpAutoLock();
      // Vote on the governor's OWN chain regardless of the selected network.
      return { hash: await signAndSendOn(op.chainId, acct.account, governor, castVoteData(op.proposalId, op.support)) };
    }
    case "networkStats":
      return readNetworkStats(clientFor(9200));
    case "workerLifetime":
      return { lifetime: await readWorkerLifetime(op.address) };
    case "withdrawRewards": {
      const kr = await restore();
      const acct = kr?.accountFor(op.from);
      if (!acct) throw RpcError.locked;
      await bumpAutoLock();
      // JobRegistry lives on LightChain mainnet; send there explicitly.
      const t = withdrawTarget();
      return { hash: await signAndSendOn(9200, acct.account, t.to, t.data) };
    }
    case "setAccountName": {
      const max = await accountCount();
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= max) throw RpcError.invalidParams;
      const { [NAMES_KEY]: names = [] } = (await browser.storage.local.get(NAMES_KEY)) as { [NAMES_KEY]?: string[] };
      // Densify: sparse arrays JSON-serialize holes to null and would leak into the UI.
      const next = Array.from({ length: Math.max(names.length, op.index + 1) }, (_, i) => names[i] ?? "");
      next[op.index] = op.name.trim().slice(0, 24);
      await browser.storage.local.set({ [NAMES_KEY]: next });
      return true;
    }
    case "bridgeFee":
      return { fee: await bridgeFee(op.direction) };
    case "bridgeBalance":
      return { balance: await bridgeSourceBalance(op.direction, op.account as `0x${string}`) };
    case "bridge": {
      const kr = await restore();
      const acct = kr?.accountFor(op.from);
      if (!acct) throw RpcError.locked;
      await bumpAutoLock();
      return bridgeTransfer(acct.account, op.direction, op.amount);
    }
    case "txStatus": {
      try {
        const r = await (await publicClient()).getTransactionReceipt({ hash: op.hash as `0x${string}` });
        return { status: r.status === "success" ? "confirmed" : "failed" };
      } catch {
        return { status: "pending" }; // receipt not mined yet
      }
    }
    case "sendToken": {
      const kr = await restore();
      const acct = kr?.accountFor(op.from);
      if (!acct) throw RpcError.locked;
      await bumpAutoLock();
      const data = erc20TransferData(op.to, op.amount, op.decimals);
      const hash = await signAndSend(acct.account, op.token as `0x${string}`, 0n, data, op.speed);
      const cid = await selectedChainId();
      const meta = (await trackedTokens(cid)).find((t) => t.address.toLowerCase() === op.token.toLowerCase());
      void logActivity({ hash, to: op.to, amount: op.amount, symbol: meta?.symbol ?? "tokens", chainId: cid, ts: Date.now(), from: op.from, kind: "token" });
      return { hash };
    }
    case "addActivity": {
      const { activity = [] } = (await browser.storage.local.get("activity")) as { activity?: ActivityEntry[] };
      await browser.storage.local.set({ activity: [op.entry, ...activity].slice(0, 40) });
      return { ok: true };
    }
    case "getActivity": {
      const { activity = [] } = (await browser.storage.local.get("activity")) as { activity?: ActivityEntry[] };
      return activity.filter((e) => e.chainId === op.chainId);
    }
    case "getPrices": {
      // Best-effort USD prices from CoinGecko's public API (needs the host
      // permission). Failures just leave USD blank in the UI.
      const native = CG_NATIVE[op.chainId];
      const platform = CG_PLATFORM[op.chainId];
      const out: Prices = { nativeUsd: null, nativeChange24h: null, tokenUsd: {}, tokenChange24h: {} };
      try {
        if (native) {
          const j = (await (await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${native}&vs_currencies=usd&include_24hr_change=true`)).json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
          out.nativeUsd = j[native]?.usd ?? null;
          out.nativeChange24h = j[native]?.usd_24h_change ?? null;
        } else if (op.chainId === 9200 || op.chainId === 8200) {
          // LightChain's native LCAI is priced via its Ethereum ERC-20.
          const key = LCAI_PRICE_CONTRACT.toLowerCase();
          const j = (await (await fetch(`https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${key}&vs_currencies=usd&include_24hr_change=true`)).json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
          out.nativeUsd = j[key]?.usd ?? null;
          out.nativeChange24h = j[key]?.usd_24h_change ?? null;
        }
        if (platform && op.addresses.length) {
          const list = op.addresses.map((a) => a.toLowerCase()).join(",");
          const j = (await (await fetch(`https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${list}&vs_currencies=usd&include_24hr_change=true`)).json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
          for (const [addr, v] of Object.entries(j)) {
            out.tokenUsd[addr.toLowerCase()] = v?.usd ?? 0;
            if (typeof v?.usd_24h_change === "number") out.tokenChange24h[addr.toLowerCase()] = v.usd_24h_change;
          }
        }
      } catch {
        return out; // prices are optional; surface what we have
      }
      return out;
    }
    case "simulateTx": {
      // eth_simulateV1 with traceTransfers -> the signer's net balance changes,
      // so we can preview "you send X / you receive Y" before they approve. The
      // from balance is overridden so the sim never fails on funds.
      const cid = await selectedChainId();
      const client = clientFor(cid);
      const from = (op.from || "0x").toLowerCase();
      try {
        const res = (await client.request({
          method: "eth_simulateV1" as never,
          params: [
            {
              blockStateCalls: [
                {
                  stateOverrides: { [from]: { balance: "0xffffffffffffffffffffffffffffffff" } },
                  calls: [{ from, to: op.to, value: op.value ?? "0x0", data: op.data ?? "0x" }],
                },
              ],
              traceTransfers: true,
              validation: false,
            },
            "latest",
          ] as never,
        })) as Array<{ calls: Array<{ status: string; logs: SimLog[] }> }>;
        const call = res?.[0]?.calls?.[0];
        if (!call) return { ok: false };
        const net = netChanges(parseTransfers(call.logs ?? []), from);
        const changes: Array<{ symbol: string; formatted: string; direction: "in" | "out" }> = [];
        for (const [token, delta] of net) {
          const abs = delta > 0n ? delta : -delta;
          const direction = delta > 0n ? ("in" as const) : ("out" as const);
          let symbol = chainById(cid).nativeCurrency.symbol;
          let decimals = 18;
          if (token !== NATIVE_SENTINEL) {
            const meta = await fetchTokenMeta(client, token).catch(() => null);
            if (meta) {
              symbol = meta.symbol;
              decimals = meta.decimals;
            } else {
              symbol = `${token.slice(0, 6)}…`;
            }
          }
          changes.push({ symbol, formatted: formatUnits(abs, decimals), direction });
        }
        return { ok: true, reverted: call.status !== "0x1", changes };
      } catch {
        return { ok: false }; // RPC may not support eth_simulateV1; UI falls back to the decode
      }
    }
    case "knownRecipients": {
      // Distinct addresses you've sent to before (across chains) - the trusted
      // set the send flow checks new recipients against for address poisoning.
      const { activity = [] } = (await browser.storage.local.get("activity")) as { activity?: ActivityEntry[] };
      return [...new Set(activity.map((e) => e.to.toLowerCase()))];
    }
    case "listPending":
      return [...pending.entries()].map(([id, p]) => ({ id, method: p.request.method, origin: p.origin, params: p.request.params }));
    case "resolvePending":
      await resolvePending(op.id, op.approved);
      return { ok: true };
  }
}

/** Record an activity entry the moment a hash exists, regardless of popup life. */
async function logActivity(entry: ActivityEntry): Promise<void> {
  const { activity = [] } = (await browser.storage.local.get("activity")) as { activity?: ActivityEntry[] };
  await browser.storage.local.set({ activity: [entry, ...activity].slice(0, 40) });
}

/** Send a tx on an EXPLICIT chain (governance, rewards: not the selected one). */
async function signAndSendOn(chainId: number, account: Keyring["accounts"][number]["account"], to: `0x${string}`, data: `0x${string}`): Promise<string> {
  const { createWalletClient } = await import("viem");
  const wallet = createWalletClient({ account, chain: chainById(chainId), transport: http() });
  return wallet.sendTransaction({ to, data });
}

async function signAndSend(account: Keyring["accounts"][number]["account"], to: `0x${string}`, value: bigint, data?: `0x${string}`, speed?: GasSpeed): Promise<string> {
  const { createWalletClient } = await import("viem");
  const cid = await selectedChainId();
  const chain = chainById(cid);
  const wallet = createWalletClient({ account, chain, transport: http() });
  if (!speed || speed === "normal") return wallet.sendTransaction({ to, value, data });
  const tiers = await readGasTiers(clientFor(cid));
  const t = tiers[speed];
  return wallet.sendTransaction({ to, value, data, maxFeePerGas: BigInt(t.maxFeePerGas), maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGas) });
}

// ---- dapp RPC + approval queue ---------------------------------------------

async function handleDappRpc(request: JsonRpcRequest, origin: string): Promise<unknown> {
  if (!isAllowedMethod(request.method)) throw RpcError.unsupported;

  if (LOCAL_READ.has(request.method)) {
    const cid = await selectedChainId();
    if (request.method === "eth_chainId") return `0x${cid.toString(16)}`;
    if (request.method === "net_version") return String(cid);
    if (request.method === "eth_accounts") return await connectedAccounts(origin);
    if (request.method === "wallet_switchEthereumChain") return await switchChain(request);
  }

  if (APPROVAL_REQUIRED.has(request.method)) return await enqueueApproval(request, origin);

  // Everything else on the allowlist: read-only passthrough to the selected chain's pinned RPC.
  return (await publicClient()).request({ method: request.method as never, params: request.params as never });
}

// Switch the wallet to a code-pinned supported chain, or reject (4902) so the
// dapp knows it is unrecognized. The inpage provider emits chainChanged on success.
async function switchChain(request: JsonRpcRequest): Promise<null> {
  const param = (request.params?.[0] ?? {}) as { chainId?: string };
  const id = param.chainId ? Number(param.chainId) : NaN;
  if (!isSupportedChain(id)) throw { code: 4902, message: "Unrecognized chain. Add it in the wallet first." };
  await browser.storage.local.set({ [CHAIN_KEY]: id });
  return null;
}

async function connectedAccounts(origin: string): Promise<string[]> {
  const { [PERMS_KEY]: perms = {} } = (await browser.storage.local.get(PERMS_KEY)) as { [PERMS_KEY]?: Record<string, string[]> };
  const kr = await restore();
  const granted = perms[origin] ?? [];
  // Only surface accounts that still exist in the keyring.
  return kr ? granted.filter((a) => kr.accountFor(a)) : [];
}

// One approval window at a time: new requests queue into it; closing it
// rejects everything still pending (a dapp promise must never hang forever).
let approvalWindowId: number | null = null;
// Synchronous guard: two requests racing before windows.create resolves must
// share ONE window, or the id tracks only the second and closes go unobserved.
let approvalOpening: Promise<void> | null = null;

function enqueueApproval(request: JsonRpcRequest, origin: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = `req-${++pendingSeq}`;
    pending.set(id, { request, origin, resolve, reject });
    if (approvalOpening) return; // a window is being created; it will drain the queue
    if (approvalWindowId !== null) {
      // Focus the existing window; its queue drains request by request.
      void browser.windows.update(approvalWindowId, { focused: true, drawAttention: true }).catch(() => {
        approvalWindowId = null;
        startApprovalWindow();
      });
      return;
    }
    startApprovalWindow();
  });
}

function startApprovalWindow(): void {
  if (approvalOpening) return;
  approvalOpening = browser.windows
    .create({ url: browser.runtime.getURL("/popup.html#/approve"), type: "popup", width: 380, height: 600 })
    .then((w) => {
      approvalWindowId = w.id ?? null;
    })
    .catch(() => undefined)
    .finally(() => {
      approvalOpening = null;
    });
}

browser.windows.onRemoved.addListener((closedId) => {
  if (closedId !== approvalWindowId) return;
  approvalWindowId = null;
  // Dismissing the window IS a rejection for everything still queued.
  for (const [id, p] of pending) {
    pending.delete(id);
    p.reject(RpcError.userRejected);
  }
});

async function resolvePending(id: string, approved: boolean): Promise<void> {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (!approved) return p.reject(RpcError.userRejected);
  try {
    p.resolve(await fulfilApproved(p.request, p.origin));
  } catch (e) {
    p.reject({ code: -32603, message: (e as Error).message?.slice(0, 120) ?? "request failed" });
  }
}

async function fulfilApproved(request: JsonRpcRequest, origin: string): Promise<unknown> {
  const kr = await restore();
  if (!kr) throw RpcError.locked;
  if (request.method === "eth_requestAccounts") {
    const addr = kr.accounts[await activeIndex(kr.accounts.length)]!.address;
    const { [PERMS_KEY]: perms = {} } = (await browser.storage.local.get(PERMS_KEY)) as { [PERMS_KEY]?: Record<string, string[]> };
    perms[origin] = [addr];
    await browser.storage.local.set({ [PERMS_KEY]: perms });
    return [addr];
  }
  if (request.method === "personal_sign") {
    const [data, address] = request.params as [`0x${string}`, string];
    const acct = kr.accountFor(address);
    if (!acct) throw RpcError.unauthorized;
    return acct.account.signMessage({ message: { raw: data } });
  }
  if (request.method === "eth_sendTransaction") {
    // approve==sign: sign exactly the canonical tx the popup displayed (review H1),
    // INCLUDING the calldata - without it every dapp contract call would silently
    // become an empty transfer.
    const [raw] = request.params as [{ from: string; to?: string; value?: string; data?: string }];
    const acct = kr.accountFor(raw.from);
    if (!acct) throw RpcError.unauthorized;
    const tx = canonicalizeDappTx(raw);
    return signAndSend(acct.account, tx.to, tx.value, tx.data);
  }
  if (request.method === "eth_signTypedData_v4") {
    const [address, json] = request.params as [string, string];
    const acct = kr.accountFor(address);
    if (!acct) throw RpcError.unauthorized;
    const td = parseTypedData(json);
    if (!td?.domain || !td.primaryType || !td.types || td.message === undefined) throw RpcError.invalidParams;
    // Bind the signature to a supported chain - never sign typed data aimed elsewhere (review H5).
    const chainId = td.domain.chainId != null ? Number(td.domain.chainId) : undefined;
    if (chainId === undefined || !isSupportedChain(chainId)) throw { code: 4901, message: "Typed data targets an unsupported chain" };
    const types = { ...(td.types as Record<string, unknown>) };
    delete types.EIP712Domain; // viem derives the domain type itself
    const def = { domain: td.domain, types, primaryType: td.primaryType, message: td.message } as unknown as TypedDataDefinition;
    return acct.account.signTypedData(def);
  }
  throw RpcError.unsupported;
}

// ---- message router --------------------------------------------------------

export default defineBackground(() => {
  // First install: open onboarding in a full browser tab (a 360px popup is a
  // cramped first impression for seed-phrase setup).
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== "install") return;
    void browser.tabs.create({ url: browser.runtime.getURL("/popup.html#/expanded") });
  });
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== EVENT_PORT) return;
    const p = port as unknown as EventPort;
    const origin = p.sender?.origin ?? (p.sender?.url ? new URL(p.sender.url).origin : "");
    eventPorts.set(p, origin);
    port.onDisconnect.addListener(() => eventPorts.delete(p));
  });
  browser.runtime.onMessage.addListener((message: unknown, sender: { origin?: string; url?: string }) => {
    const msg = message as BgMessage;
    if (msg.kind === "wallet") {
      return handleWalletOp(msg.op).then(
        (result) => ({ result }),
        (error: { code?: number; message?: string }) => ({ error: { code: error.code ?? -32603, message: error.message ?? "error" } }),
      );
    }
    if (msg.kind === "dapp-rpc") {
      const origin = sender.origin ?? sender.url ?? "unknown";
      return handleDappRpc(msg.request, origin).then(
        (result) => ({ id: msg.request.id, result }),
        (error: { code?: number; message?: string }) => ({ id: msg.request.id, error: { code: error.code ?? -32603, message: error.message ?? "error" } }),
      );
    }
    return undefined;
  });
});
