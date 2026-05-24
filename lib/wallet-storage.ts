/**
 * Hybrid wagmi storage with a "Remember this device" opt-in — ported (and
 * trimmed) from the LightChallenge wallet setup.
 *
 * Default: wallet connection lives in sessionStorage (cleared when the tab
 * closes). If the user opts in, it moves to localStorage so reconnect survives
 * restarts. SSR-safe (falls back to an in-memory store on the server).
 */
import { createStorage, type Storage } from "wagmi";

const WAGMI_KEY = "wagmi.lightnode";
const REMEMBER_KEY = "lightnode.wallet.remember";

// WalletConnect / Coinbase hint keys we migrate when the flag flips.
const HINT_KEYS = [
  "walletconnect",
  "WALLETCONNECT_DEEPLINK_CHOICE",
  "wc@2:client:0.3//session",
  "wc@2:core:0.3//pairing",
  "coinbaseWalletSDKSession",
];

export function getRemember(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(REMEMBER_KEY) === "1";
  } catch {
    return false;
  }
}

function setRememberFlag(v: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REMEMBER_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const memoryStore: Record<string, string> = {};
function adapter(base: globalThis.Storage | null): Storage {
  if (!base) {
    return {
      key: WAGMI_KEY,
      getItem: ((k, def) => (k in memoryStore ? memoryStore[k] : (def ?? null))) as Storage["getItem"],
      setItem: ((k, v) => {
        if (v == null) delete memoryStore[k];
        else memoryStore[k] = String(v);
      }) as Storage["setItem"],
      removeItem: (k: string) => {
        delete memoryStore[k];
      },
    };
  }
  return {
    key: WAGMI_KEY,
    getItem: ((k, def) => {
      try {
        const raw = base.getItem(k);
        return raw === null ? (def ?? null) : raw;
      } catch {
        return def ?? null;
      }
    }) as Storage["getItem"],
    setItem: ((k, v) => {
      try {
        if (v == null) base.removeItem(k);
        else base.setItem(k, String(v));
      } catch {
        /* ignore */
      }
    }) as Storage["setItem"],
    removeItem: (k: string) => {
      try {
        base.removeItem(k);
      } catch {
        /* ignore */
      }
    },
  };
}

function active(): Storage {
  if (typeof window === "undefined") return adapter(null);
  try {
    return adapter(getRemember() ? window.localStorage : window.sessionStorage);
  } catch {
    return adapter(null);
  }
}

const hybrid: Storage = {
  key: WAGMI_KEY,
  getItem: ((k, def) => active().getItem(k, def as never)) as Storage["getItem"],
  setItem: ((k, v) => active().setItem(k, v as never)) as Storage["setItem"],
  removeItem: (k: string) => active().removeItem(k),
};

export const walletStorage = createStorage({ storage: hybrid, key: WAGMI_KEY });

/** Flip persistence and migrate keys so reconnect behaviour is deterministic. */
export function setWalletRemembered(remember: boolean) {
  if (typeof window === "undefined") {
    setRememberFlag(remember);
    return;
  }
  try {
    const from = remember ? window.sessionStorage : window.localStorage;
    const to = remember ? window.localStorage : window.sessionStorage;
    for (const k of [WAGMI_KEY, ...HINT_KEYS]) {
      const v = from.getItem(k);
      if (remember) {
        if (v != null) to.setItem(k, v);
      } else {
        to.removeItem(k); // purge persistent hints
      }
    }
  } catch {
    /* ignore */
  }
  setRememberFlag(remember);
}
