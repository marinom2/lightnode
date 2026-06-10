import { PAGE_TO_CONTENT, CONTENT_TO_PAGE, type ContentMessage } from "../src/provider/protocol";

// Injected into the page's MAIN world. Exposes a standard EIP-1193 provider and
// announces it via EIP-6963 so dapps can pick "LightNode Wallet" alongside any other wallet.
// We do not overwrite window.ethereum (only set it if nothing else has).
type Handler = (args: unknown) => void;

function createProvider() {
  let nextId = 1;
  const waiting = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const listeners = new Map<string, Set<Handler>>();
  const emit = (event: string, data: unknown) => listeners.get(event)?.forEach((h) => h(data));

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as ContentMessage | undefined;
    if (!data || data.target !== CONTENT_TO_PAGE) return;
    const pendingReq = waiting.get(data.response.id);
    if (!pendingReq) return;
    waiting.delete(data.response.id);
    if (data.response.error) pendingReq.reject(data.response.error);
    else pendingReq.resolve(data.response.result);
  });

  const provider = {
    isLightNodeWallet: true,
    request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
      if (typeof method !== "string") return Promise.reject({ code: -32602, message: "Invalid params" });
      const id = nextId++;
      return new Promise((resolve, reject) => {
        waiting.set(id, {
          resolve: (result) => {
            // Standard EIP-1193: notify the dapp the chain changed after a switch.
            if (method === "wallet_switchEthereumChain") {
              const cid = (Array.isArray(params) ? (params[0] as { chainId?: string })?.chainId : undefined);
              if (cid) emit("chainChanged", cid);
            }
            resolve(result);
          },
          reject,
        });
        window.postMessage({ target: PAGE_TO_CONTENT, request: { id, method, params: Array.isArray(params) ? params : [] } }, window.location.origin);
      });
    },
    on(event: string, handler: Handler) {
      (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(handler);
      return provider;
    },
    removeListener(event: string, handler: Handler) {
      listeners.get(event)?.delete(handler);
      return provider;
    },
  };
  return provider;
}

function announce(provider: ReturnType<typeof createProvider>) {
  const info = {
    uuid: crypto.randomUUID(),
    name: "LightNode Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiM3MDY0ZTkiLz48L3N2Zz4=",
    rdns: "app.lightnode.wallet",
  };
  const emit = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", emit);
  emit();
}

export default defineUnlistedScript(() => {
  const provider = createProvider();
  announce(provider);
  // Legacy fallback only - never clobber an existing injected provider.
  if (!(window as unknown as { ethereum?: unknown }).ethereum) {
    (window as unknown as { ethereum: unknown }).ethereum = provider;
  }
});
