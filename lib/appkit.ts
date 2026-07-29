/**
 * Lazily-created AppKit modal.
 *
 * `createAppKit()` used to run at module scope in components/providers.tsx,
 * which app/layout.tsx renders for EVERY route. So a visitor reading the
 * landing page - or an operator on /onboard who has not touched a wallet -
 * still downloaded, parsed and executed the whole wallet stack: AppKit's UI,
 * WalletConnect, and the Coinbase SDK that `enableCoinbase: false` disables at
 * runtime but does not remove from the bundle. Measured against production:
 * 1,395 KB in a single chunk, 53% of everything /onboard shipped.
 *
 * Nothing about that stack is needed until someone actually opens the wallet
 * modal, so it now loads on the first `openWallet()` call. The import is cached
 * in a module-level promise: concurrent clicks share one download, and
 * `createAppKit` runs exactly once (calling it twice registers a second modal
 * and the account state desynchronises).
 *
 * Reading connection state does NOT go through here. Components use wagmi's
 * own `useAccount` / `useChainId`, which are already in the eager bundle
 * because WagmiProvider wraps the tree - so the connect button renders, and
 * shows a connected address across reloads, without pulling AppKit at all.
 */
import type { AppKit } from "@reown/appkit";

let modalPromise: Promise<AppKit> | null = null;

/** Options accepted by AppKit's `open()`, kept structural to avoid the import. */
export type OpenWalletOptions = { view?: "Account" | "Connect" | "Networks" };

async function createModal(): Promise<AppKit> {
  // Both imports are dynamic on purpose: lib/wagmi.ts constructs the
  // WagmiAdapter, which drags in @wagmi/connectors, so importing it eagerly
  // here would defeat the split.
  const [{ createAppKit }, { wagmiAdapter, projectId, networks }] = await Promise.all([
    import("@reown/appkit/react"),
    import("./wagmi"),
  ]);

  return createAppKit({
    adapters: [wagmiAdapter],
    projectId,
    networks,
    defaultNetwork: networks[0],
    metadata: {
      name: "LightNode",
      description: "The open toolkit for LightChain AI: SDK, wallet, worker onboarding, and live dashboards.",
      url: "https://lightnode.app",
      icons: ["https://lightnode.app/lightnode-mark.png"],
    },
    themeMode: "dark",
    // Coinbase/Base connectors bundle their own IndexedDB telemetry, which
    // throws in the desktop WebView and isn't usable there anyway. Keep
    // injected (MetaMask) + WalletConnect, which cover the real flows.
    enableCoinbase: false,
    themeVariables: {
      "--w3m-accent": "#7064e9",
      "--w3m-color-mix": "#7064e9",
      "--w3m-color-mix-strength": 12,
      "--w3m-font-family": "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
      "--w3m-border-radius-master": "2.5px",
    },
    features: { analytics: false, email: true, socials: ["google", "x", "github", "discord"] },
  });
}

/**
 * Open the wallet modal, creating it on first use.
 *
 * Rejections are swallowed deliberately: a failed chunk fetch (offline, CDN
 * blip) must not surface as an unhandled rejection from a click handler. The
 * cache is cleared so the next click retries rather than reusing a promise that
 * can never resolve.
 */
export async function openWallet(options?: OpenWalletOptions): Promise<void> {
  try {
    modalPromise ??= createModal();
    const modal = await modalPromise;
    await modal.open(options);
  } catch {
    modalPromise = null;
  }
}

/** Warm the chunk without opening anything - e.g. on hover of a connect CTA. */
export function prefetchWallet(): void {
  modalPromise ??= createModal();
  void modalPromise.catch(() => {
    modalPromise = null;
  });
}
