import { defineConfig } from "wxt";
import { fileURLToPath } from "node:url";

// LightNode Wallet - self-custodial EOA extension. Keys never leave the device.
// The inpage provider is web-accessible (required to inject into the MAIN world);
// use_dynamic_url randomizes its URL per session to blunt wallet fingerprinting.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  manifest: {
    name: "LightNode Wallet",
    description: "Self-custodial wallet for LightChain and EVM chains. Your keys never leave this device.",
    minimum_chrome_version: "120",
    permissions: ["storage", "alarms", "notifications"],
    host_permissions: ["https://api.coingecko.com/*"],
    icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
    action: { default_icon: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" } },
    web_accessible_resources: [{ resources: ["inpage.js"], matches: ["<all_urls>"] }],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  },
});
