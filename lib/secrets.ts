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

/** True when the command runner can inject secrets from the keychain by name. */
export function hasNativeSecrets(): boolean {
  return isDesktop();
}
