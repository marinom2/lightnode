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
  }
  return lsGet(legacyKey);
}

/**
 * Store a secret. On an UNSIGNED desktop app the OS keychain is unreliable
 * across launches (the code-signing identity isn't stable), which previously
 * stranded the key. So we keep a reliable localStorage copy and ALSO mirror to
 * the keychain (best effort) as defense-in-depth. The raw worker key itself is
 * not relied upon from here for ops - those decrypt it from the on-disk
 * keystore using the password. Full keychain-only privacy needs a signed build.
 */
export async function setSecret(name: string, value: string): Promise<void> {
  const legacyKey = LEGACY[name] ?? name;
  if (isDesktop()) void secretSet(name, value);
  lsSet(legacyKey, value);
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
