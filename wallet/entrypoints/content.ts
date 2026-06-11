import { PAGE_TO_CONTENT, CONTENT_TO_PAGE, CONTENT_TO_PAGE_EVENT, EVENT_PORT, type PageMessage } from "../src/provider/protocol";

// Isolated-world relay. Holds NO keys: it only forwards the page's EIP-1193
// requests to the background (which records the real origin from the sender) and
// posts responses back. The provider itself is injected into the MAIN world.
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  async main() {
    await injectScript("/inpage.js", { keepInDom: false });

    window.addEventListener("message", async (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as PageMessage | undefined;
      if (!data || data.target !== PAGE_TO_CONTENT) return;
      // A dapp promise must NEVER hang: if the service worker died or the
      // extension updated underneath us, settle with a provider error.
      try {
        const response = await browser.runtime.sendMessage({ kind: "dapp-rpc", request: data.request });
        window.postMessage({ target: CONTENT_TO_PAGE, response }, window.location.origin);
      } catch {
        window.postMessage(
          { target: CONTENT_TO_PAGE, response: { id: data.request.id, error: { code: 4900, message: "Wallet disconnected. Reload the page." } } },
          window.location.origin,
        );
      }
    });

    // Long-lived port for background -> page provider events (chainChanged /
    // accountsChanged). Reconnect with exponential backoff when the MV3 service
    // worker recycles; stop entirely once the extension context is invalidated
    // (otherwise every open tab wakes the SW in a tight loop forever).
    let backoff = 500;
    const connectEvents = () => {
      let port: ReturnType<typeof browser.runtime.connect>;
      try {
        port = browser.runtime.connect({ name: EVENT_PORT });
      } catch {
        return; // context invalidated (extension updated/removed): end the loop
      }
      port.onMessage.addListener((m: unknown) => {
        backoff = 500; // a live message proves the channel: reset the backoff
        const e = m as { event?: string; data?: unknown };
        if (e?.event) window.postMessage({ target: CONTENT_TO_PAGE_EVENT, event: e.event, data: e.data }, window.location.origin);
      });
      port.onDisconnect.addListener(() => {
        const wait = backoff;
        backoff = Math.min(backoff * 2, 60000);
        setTimeout(connectEvents, wait);
      });
    };
    connectEvents();
  },
});
