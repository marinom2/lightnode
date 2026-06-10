import { PAGE_TO_CONTENT, CONTENT_TO_PAGE, type PageMessage } from "../src/provider/protocol";

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
      const response = await browser.runtime.sendMessage({ kind: "dapp-rpc", request: data.request });
      window.postMessage({ target: CONTENT_TO_PAGE, response }, window.location.origin);
    });
  },
});
