import { defineConfig } from "wxt";
import { fileURLToPath } from "node:url";

// MV3 web-accessible-resource entry. The bundled @types/chrome omits the
// standard `use_dynamic_url` field, so we model it locally to keep it typed
// (no `any`) instead of dropping to an untyped object.
type WebAccessibleResource = { resources: string[]; matches: string[]; use_dynamic_url?: boolean };

// LightNode Wallet - self-custodial EOA extension. Keys never leave the device.
// The inpage provider is web-accessible (required to inject into the MAIN world);
// use_dynamic_url randomizes its URL per session to blunt wallet fingerprinting.
const webAccessibleResources: WebAccessibleResource[] = [
  { resources: ["inpage.js"], matches: ["<all_urls>"], use_dynamic_url: true },
];

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  manifest: {
    name: "LightNode Wallet",
    description: "Self-custodial wallet for LightChain and EVM chains. Your keys never leave this device.",
    minimum_chrome_version: "120",
    permissions: ["storage", "alarms"],
    host_permissions: ["https://api.coingecko.com/*"],
    icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
    action: { default_icon: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" } },
    web_accessible_resources: webAccessibleResources,
    // img-src 'self' data: https: lets legitimate NFT images (https, any host) and
    // inline data: images render, while blocking http: and other schemes that could
    // beacon a wallet holder's IP. Untrusted (spam-flagged) NFTs are additionally
    // gated behind an explicit "Load image" click in the popup, see sheets-assets.tsx.
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' data: https:" },
  },
});
