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
import { readWorkerStatus } from "../src/rpc/worker";
import { DEFAULT_TOKENS, readTokenBalances, fetchTokenMeta, erc20TransferData, type TokenMeta } from "../src/rpc/tokens";
import { CG_NATIVE, CG_PLATFORM, type Prices } from "../src/rpc/prices";
import { parseTransfers, netChanges, NATIVE_SENTINEL, type SimLog } from "../src/rpc/simulate";
import { bridgeTransfer, bridgeFee } from "../src/rpc/bridge";
import { daoStatus } from "../src/rpc/dao";
import { encryptVault, decryptVault, type EncryptedVault } from "../src/keyring/vault";
import { chainById, isSupportedChain, DEFAULT_CHAIN_ID } from "../src/rpc/chains";
import { type BgMessage, type WalletOp, type JsonRpcRequest, type ActivityEntry, EVENT_PORT, RpcError } from "../src/provider/protocol";
import { APPROVAL_REQUIRED, LOCAL_READ, isAllowedMethod } from "../src/provider/rpc-methods";

const VAULT_KEY = "vault";
const SESSION_KEY = "session-mnemonic";
const PERMS_KEY = "connected-origins";
const CHAIN_KEY = "selected-chain";
const COUNT_KEY = "account-count";
const ACTIVE_KEY = "active-account";
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
}
const eventPorts = new Set<EventPort>();
function emitEvent(event: string, data: unknown): void {
  for (const port of eventPorts) {
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
      return {
        hasVault: Boolean(vault),
        unlocked: Boolean(kr),
        accounts,
        activeIndex: await activeIndex(accounts.length || 1),
        chainId: await selectedChainId(),
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
      await browser.storage.local.remove([VAULT_KEY, COUNT_KEY, ACTIVE_KEY]);
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
      const tokens = await trackedTokens(cid);
      return readTokenBalances(clientFor(cid), op.address as `0x${string}`, tokens);
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
      return { hash: await signAndSend(acct.account, op.to as `0x${string}`, parseEther(op.valueWei)) };
    }
    case "quoteSend": {
      // Estimate the network fee (gas x fee/gas) before the user signs.
      const cid = await selectedChainId();
      const client = clientFor(cid);
      const feeSymbol = chainById(cid).nativeCurrency.symbol;
      try {
        const gas = op.token
          ? await client.estimateGas({ account: op.from as `0x${string}`, to: op.token as `0x${string}`, data: erc20TransferData(op.to, op.amount ?? "0", op.decimals ?? 18) })
          : await client.estimateGas({ account: op.from as `0x${string}`, to: op.to as `0x${string}`, value: parseEther(op.valueWei ?? "0") });
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
      return { hash: await w.sendTransaction(tx) };
    }
    case "daoStatus":
      return daoStatus(op.chainId, op.address);
    case "bridgeFee":
      return { fee: await bridgeFee(op.direction) };
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
      return { hash: await signAndSend(acct.account, op.token as `0x${string}`, 0n, data) };
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
      const out: Prices = { nativeUsd: null, tokenUsd: {} };
      try {
        if (native) {
          const j = (await (await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${native}&vs_currencies=usd`)).json()) as Record<string, { usd?: number }>;
          out.nativeUsd = j[native]?.usd ?? null;
        }
        if (platform && op.addresses.length) {
          const list = op.addresses.map((a) => a.toLowerCase()).join(",");
          const j = (await (await fetch(`https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${list}&vs_currencies=usd`)).json()) as Record<string, { usd?: number }>;
          for (const [addr, v] of Object.entries(j)) out.tokenUsd[addr.toLowerCase()] = v?.usd ?? 0;
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

async function signAndSend(account: Keyring["accounts"][number]["account"], to: `0x${string}`, value: bigint, data?: `0x${string}`): Promise<string> {
  const { createWalletClient } = await import("viem");
  const chain = chainById(await selectedChainId());
  const wallet = createWalletClient({ account, chain, transport: http() });
  return wallet.sendTransaction({ to, value, data });
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

function enqueueApproval(request: JsonRpcRequest, origin: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = `req-${++pendingSeq}`;
    pending.set(id, { request, origin, resolve, reject });
    void browser.windows.create({ url: browser.runtime.getURL("/popup.html#/approve"), type: "popup", width: 380, height: 600 });
  });
}

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
    // approve==sign: sign exactly the canonical tx the popup displayed (review H1).
    const [tx] = request.params as [{ from: string; to: `0x${string}`; value?: `0x${string}`; data?: `0x${string}` }];
    const acct = kr.accountFor(tx.from);
    if (!acct) throw RpcError.unauthorized;
    return signAndSend(acct.account, tx.to, tx.value ? BigInt(tx.value) : 0n);
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
    eventPorts.add(p);
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
