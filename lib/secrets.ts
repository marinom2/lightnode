/**
 * Worker-secret storage with the most private backend available:
 * - Desktop shell: the OS keychain (Keychain / Credential Manager / Secret
 *   Service) via native commands - the raw key/password never persist in the
 *   web layer.
 * - Web: localStorage fallback (a browser tab has no keychain access).
 *
 * Secret NAMES match the env vars the toolkit expects, so on desktop a command
 * can pull them straight from the keychain by name (see runSetupStreamed's
 * `secretEnv`) without the web ever holding the value.
 */
import { privateKeyToAccount } from "viem/accounts";
import { isDesktop, secretGet, secretSet, secretDelete, nativeSecretsAvailable } from "./tauri";
import type { NetworkId } from "./network";

// Real capability probe (not just isDesktop): true only when the running binary
// actually has the keychain commands. Use this to decide secretEnv injection.
export { nativeSecretsAvailable };

// Base secret names (also the env-var names the toolkit expects). Storage is
// keyed PER NETWORK (`<name>.<net>`) so a testnet and a mainnet worker can coexist
// without overwriting each other - toggling the network points at the right one.
export const SECRET_WORKER_KEY = "WORKER_PRIVKEY";
export const SECRET_WORKER_PW = "WORKER_PASSWORD";
export const WORKER_ADDR_STORE = "lightnode.workerAddress"; // legacy single key (fallback only)

// Pre-keychain builds stored these in localStorage; still read them as a fallback.
const LEGACY: Record<string, string> = {
  [SECRET_WORKER_KEY]: "lightnode.funderKey",
  [SECRET_WORKER_PW]: "lightnode.workerPw",
};

const addrKey = (net: NetworkId) => `${WORKER_ADDR_STORE}.${net}`;

function lsGet(k: string): string {
  try {
    return window.localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}
function lsSet(k: string, v: string): void {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* unavailable */
  }
}
function lsDel(k: string): void {
  try {
    window.localStorage.removeItem(k);
  } catch {
    /* unavailable */
  }
}

/**
 * Read a per-network secret (keychain on desktop, else localStorage). Strictly
 * per-network: we do NOT fall back to a non-per-network single value, because a
 * key/password stored for one network (e.g. a freshly funded mainnet worker)
 * must never answer another network's read - that cross-contamination caused
 * settle/withdraw to sign with the wrong worker. If a network has no stored
 * secret, on-chain ops derive the key from the on-disk keystore instead.
 */
export async function getSecret(name: string, net: NetworkId): Promise<string> {
  const perNet = `${name}.${net}`;
  const legacyNet = `${LEGACY[name] ?? name}.${net}`;
  if (isDesktop()) {
    const v = await secretGet(perNet);
    if (v) return v;
  }
  return lsGet(legacyNet);
}

/**
 * Store a per-network secret. On an UNSIGNED desktop app the OS keychain is
 * unreliable across launches, so we keep a reliable localStorage copy and ALSO
 * mirror to the keychain (best effort). Ops mostly derive the key from the
 * on-disk keystore anyway; this is for the in-app withdraw + non-native fallback.
 */
export async function setSecret(name: string, value: string, net: NetworkId): Promise<void> {
  const perNet = `${name}.${net}`;
  const legacyNet = `${LEGACY[name] ?? name}.${net}`;
  if (isDesktop()) void secretSet(perNet, value);
  lsSet(legacyNet, value);
}

/** Delete a per-network secret from both backends. */
export async function deleteSecret(name: string, net: NetworkId): Promise<void> {
  if (isDesktop()) await secretDelete(`${name}.${net}`);
  lsDel(`${LEGACY[name] ?? name}.${net}`);
}

/**
 * One-time migration of the worker key. Early builds stored the key under a
 * single, non-per-network name (`WORKER_PRIVKEY`), so generating a second
 * network's worker overwrote the first, and a per-network read misses it
 * entirely (the key reveal shows nothing). If a bare key exists and its address
 * matches the address recorded for THIS network, copy it into the per-network
 * slot. Address-matched so it can only ever land on the network it belongs to.
 */
export async function migrateBareWorkerKey(net: NetworkId): Promise<void> {
  // Already have a per-network key? Nothing to do.
  if (await getSecret(SECRET_WORKER_KEY, net)) return;
  const bareLegacy = LEGACY[SECRET_WORKER_KEY];
  const bare = isDesktop() ? await secretGet(SECRET_WORKER_KEY) : lsGet(bareLegacy);
  if (!bare || !/^0x[0-9a-fA-F]{64}$/.test(bare)) return;
  let addr = "";
  try {
    addr = privateKeyToAccount(bare as `0x${string}`).address.toLowerCase();
  } catch {
    return; // not a usable key
  }
  const want = getWorkerAddr(net).toLowerCase();
  if (want && addr === want) await setSecret(SECRET_WORKER_KEY, bare, net);
}

export interface RetiredWorker {
  addr: string;
  key: string;
  pw: string;
  ts: number;
}

const retiredKey = (net: NetworkId) => `lightnode.retired.${net}`;

/**
 * Archive a worker key+password that is being retired (e.g. the user generated a
 * replacement) so a STAKED worker's key is never silently lost - losing it would
 * strand the on-chain stake. Append-only per network in localStorage, and mirrored
 * to the keychain on desktop, keyed by address so retirements never collide.
 */
export async function archiveRetiredWorker(net: NetworkId, addr: string, key: string, pw: string): Promise<void> {
  if (!key) return;
  const lk = retiredKey(net);
  let list: RetiredWorker[] = [];
  try {
    const parsed: unknown = JSON.parse(lsGet(lk) || "[]");
    if (Array.isArray(parsed)) list = parsed as RetiredWorker[];
  } catch {
    list = [];
  }
  if (!list.some((e) => e.key === key)) {
    list.push({ addr, key, pw, ts: Date.now() });
    lsSet(lk, JSON.stringify(list));
  }
  if (isDesktop() && addr) {
    const a = addr.toLowerCase();
    void secretSet(`${SECRET_WORKER_KEY}.${net}.retired.${a}`, key);
    if (pw) void secretSet(`${SECRET_WORKER_PW}.${net}.retired.${a}`, pw);
  }
}

/** Retired (replaced) worker keys for a network, newest first - so the user can
 *  recover a key they replaced and reclaim a stranded stake. */
export function listRetiredWorkers(net: NetworkId): RetiredWorker[] {
  try {
    const parsed: unknown = JSON.parse(lsGet(retiredKey(net)) || "[]");
    return Array.isArray(parsed) ? (parsed as RetiredWorker[]).slice().sort((a, b) => b.ts - a.ts) : [];
  } catch {
    return [];
  }
}

/** Wipe a network's worker secrets + its (public) address. */
export async function wipeWorkerSecrets(net: NetworkId): Promise<void> {
  await deleteSecret(SECRET_WORKER_KEY, net);
  await deleteSecret(SECRET_WORKER_PW, net);
  lsDel(addrKey(net));
}

/** The (public) worker address for a network - per-network, with a fallback to
 *  the old single value. */
export function getWorkerAddr(net: NetworkId): string {
  return lsGet(addrKey(net)) || lsGet(WORKER_ADDR_STORE);
}

/** Record the (public) worker address for a network. */
export function setWorkerAddr(net: NetworkId, addr: string): void {
  lsSet(addrKey(net), addr);
}

/**
 * The address of the worker the app MANAGES for a network: the one whose private
 * key it holds. The key is the source of truth (the public address record can
 * drift - e.g. viewing another watchlisted worker), so we derive the address from
 * the stored key and re-sync the public record. Falls back to the recorded address
 * when the app holds no key for the network.
 */
export async function resolveManagedWorkerAddr(net: NetworkId): Promise<string> {
  const k = await getSecret(SECRET_WORKER_KEY, net);
  if (k && /^0x[0-9a-fA-F]{64}$/.test(k)) {
    try {
      const a = privateKeyToAccount(k as `0x${string}`).address;
      if (getWorkerAddr(net).toLowerCase() !== a.toLowerCase()) setWorkerAddr(net, a);
      return a;
    } catch {
      /* not a usable key - fall back */
    }
  }
  return getWorkerAddr(net);
}

const modelsKey = (net: NetworkId) => `lightnode.servedModels.${net}`;

/** The model set this network's worker serves (public). Empty if unknown. */
export function getServedModels(net: NetworkId): string[] {
  try {
    const parsed: unknown = JSON.parse(lsGet(modelsKey(net)) || "[]");
    return Array.isArray(parsed) ? (parsed as string[]).filter((m) => typeof m === "string" && m) : [];
  } catch {
    return [];
  }
}

/** Record the model set this network's worker serves. */
export function setServedModels(net: NetworkId, models: string[]): void {
  lsSet(modelsKey(net), JSON.stringify(models));
}

/** True when the command runner can inject secrets from the keychain by name. */
export function hasNativeSecrets(): boolean {
  return isDesktop();
}
