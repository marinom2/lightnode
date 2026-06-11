import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LightNode Wallet - Privacy Policy",
  description: "LightNode Wallet is self-custodial and collects no data. Your keys and settings stay on your device.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-lg font-semibold text-content-primary">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-content-soft">{children}</div>
    </section>
  );
}

export default function WalletPrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <h1 className="text-3xl font-bold tracking-tight text-content-primary">LightNode Wallet - Privacy Policy</h1>
      <p className="mt-3 text-sm text-content-soft">
        LightNode Wallet is a <span className="text-content-primary">self-custodial</span> browser extension, built so we never see your money or your data.
      </p>

      <Section title="What we collect">
        <p><span className="text-content-primary">Nothing.</span> There is no backend we operate, no analytics, and no telemetry. We do not collect, store, or transmit any personal information, addresses, balances, or activity to any server we control.</p>
      </Section>

      <Section title="Where your data lives">
        <p>Your recovery phrase is encrypted on your device (AES-256-GCM with a scrypt-derived key) and stored only in your browser&apos;s local extension storage. It never leaves your device, and only your password can decrypt it - we cannot recover it.</p>
        <p>Settings (selected network, added tokens, your local activity list) are stored locally in your browser.</p>
      </Section>

      <Section title="Network requests">
        <p>To show balances and broadcast transactions, the extension talks directly to public blockchain RPC endpoints (LightChain, Ethereum, Base, Arbitrum, Optimism, Polygon) and, on LightChain, the public worker-registry contracts. To show USD values it also requests coin and token prices from CoinGecko&apos;s public API (which sees the token contract addresses, not your wallet address). These requests go from your browser to those public endpoints; they are not routed through any server we run. Public RPC and price providers may log requests under their own policies.</p>
      </Section>

      <Section title="Permissions">
        <p><code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono">storage</code> keeps the encrypted vault and settings on your device. <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono">alarms</code> auto-locks after inactivity. <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono">notifications</code> are optional request alerts. The page content script injects the standard wallet provider so sites can request to connect; it holds no keys.</p>
      </Section>

      <Section title="Your control">
        <p>You can reveal your recovery phrase (password-gated) or remove the wallet from your device at any time in Settings. Removing it deletes the encrypted vault from your browser.</p>
      </Section>

      <p className="mt-8 text-xs text-content-soft">Independent, community-built software. Not an official LightChain product.</p>
    </div>
  );
}
