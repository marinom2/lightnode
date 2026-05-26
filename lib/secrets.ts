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

// Real capability probe (not just isDesktop): true only when the running binary
// actually has the keychain commands. Use this to decide secretEnv injection.
export { nativeSecretsAvailable };

export const SECRET_WORKER_KEY = "WORKER_PRIVKEY";
export const SECRET_WORKER_PW = "WORKER_PASSWORD";
export const WORKER_ADDR_STORE = "lightnode.workerAddress"; // public, always localStorage

// Pre-keychain builds stored these in localStorage; migrate them on first read.
const LEGACY: Record<string, string> = {
  [SECRET_WORKER_KEY]: "lightnode.funderKey",
  [SECRET_WORKER_PW]: "lightnode.workerPw",
};

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

/** Read a secret. On desktop, migrates any legacy localStorage value into the
 *  keychain (then clears it) so old installs upgrade transparently. */
export async function getSecret(name: string): Promise<string> {
  const legacyKey = LEGACY[name] ?? name;
  if (isDesktop()) {
    const v = await secretGet(name);
    if (v) return v;
    // Migrate any legacy localStorage value into the keychain, and drop the
    // local copy ONLY if the keychain round-trips (so a denied/unavailable
    // keychain never strands the key).
    const legacy = lsGet(legacyKey);
    if (legacy) {
      const ok = await secretSet(name, legacy);
      if (ok && (await secretGet(name)) === legacy) lsDel(legacyKey);
      return legacy;
    }
    return "";
  }
  return lsGet(legacyKey);
}

/**
 * Store a secret in the most private place that actually works: the OS keychain
 * on desktop. We verify it round-trips; only then do we remove the localStorage
 * copy (keeping the key out of the web layer). If the keychain is unavailable or
 * denied, we keep a localStorage copy so nothing is ever stranded.
 */
export async function setSecret(name: string, value: string): Promise<void> {
  const legacyKey = LEGACY[name] ?? name;
  if (isDesktop()) {
    const ok = await secretSet(name, value);
    if (ok && (await secretGet(name)) === value) {
      lsDel(legacyKey); // keychain verified - keep the raw key out of localStorage
      return;
    }
  }
  lsSet(legacyKey, value); // web, or keychain unavailable/denied: reliable fallback
}

/** Delete a secret from both backends. */
export async function deleteSecret(name: string): Promise<void> {
  if (isDesktop()) await secretDelete(name);
  lsDel(LEGACY[name] ?? name);
}

/** Wipe all worker secrets + the (public) address. */
export async function wipeWorkerSecrets(): Promise<void> {
  await deleteSecret(SECRET_WORKER_KEY);
  await deleteSecret(SECRET_WORKER_PW);
  lsDel(WORKER_ADDR_STORE);
}

/** True when the command runner can inject secrets from the keychain by name. */
export function hasNativeSecrets(): boolean {
  return isDesktop();
}
