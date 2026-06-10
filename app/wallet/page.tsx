import type { Metadata } from "next";
import Link from "next/link";
import { Server, Sparkles, Landmark, ArrowLeftRight, Fuel, ShieldCheck, Download, KeyRound, Github, Lock } from "lucide-react";

export const metadata: Metadata = {
  title: "LightNode Wallet - a self-custodial wallet for the LightChain ecosystem",
  description:
    "LightNode Wallet: a self-custodial home for your LCAI, your worker, encrypted AI inference, and DAO governance on LightChain. Your keys never leave your device. Independent and community-built.",
};

const REPO = "https://github.com/marinom2/lightnode/tree/main/wallet";
const DOWNLOAD_URL = "https://github.com/marinom2/lightnode/releases/latest/download/lightnode-wallet-chrome.zip";

const FEATURES: { icon: typeof Server; title: string; body: string; status: "live" | "soon" }[] = [
  { icon: ShieldCheck, title: "Self-custodial", body: "Keys are generated and encrypted on your device with AES-256-GCM + scrypt. They never leave it. No server, no custody, no smart contract.", status: "live" },
  { icon: Fuel, title: "Gas done right", body: "LightChain fees are negligible, so the wallet drops the gwei sliders and scary fee modals. One tap, fee shown as what it is: nothing.", status: "live" },
  { icon: Server, title: "Worker control", body: "Your worker, in your wallet: registration, stake, headroom, and claimable rewards at a glance, then stake or top up in a tap.", status: "soon" },
  { icon: Sparkles, title: "Encrypted AI inference", body: "Ask an AI a question and pay per call from your own key, end-to-end encrypted and settled on-chain - right inside the wallet.", status: "soon" },
  { icon: Landmark, title: "DAO intelligence", body: "Decoded proposals, quorum distance, and your voting power, surfaced from the registries. Vote on the official DAO in a tap.", status: "soon" },
  { icon: ArrowLeftRight, title: "Built-in bridge", body: "Move LCAI between Ethereum and LightChain without leaving the wallet, over the Hyperlane warp route.", status: "soon" },
];

function StatusPill({ status }: { status: "live" | "soon" }) {
  return status === "live" ? (
    <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">Live</span>
  ) : (
    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Soon</span>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-primary text-xs font-bold text-white">{n}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-content-primary">{title}</p>
        <div className="mt-1 text-sm text-content-soft">{children}</div>
      </div>
    </div>
  );
}

export default function WalletPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      {/* hero */}
      <section className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Self-custodial · Independent</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-content-primary sm:text-5xl">
          <span className="text-gradient">LightNode</span> Wallet
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-content-soft">
          A self-custodial wallet for the LightChain ecosystem. Hold your LCAI, monitor your worker, run encrypted AI inference, and read the DAO - all in one place. <span className="text-content-primary">Your keys never leave your device.</span>
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <a href={DOWNLOAD_URL} className="inline-flex items-center gap-2 rounded-xl bg-gradient-primary bg-[length:200%_auto] bg-[position:left_center] px-5 py-3 text-sm font-semibold text-white shadow-[0_2px_18px_-4px_rgba(112,100,233,0.7)] transition-all hover:bg-[position:right_center] hover:brightness-110">
            <Download className="size-4" /> Download the wallet
          </a>
          <Link href="#install" className="inline-flex items-center gap-2 rounded-xl border border-bdr-soft px-5 py-3 text-sm font-semibold text-content-soft transition-colors hover:border-primary/40 hover:text-content-primary">
            How to install
          </Link>
          <a href={REPO} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-bdr-soft px-5 py-3 text-sm font-semibold text-content-soft transition-colors hover:border-primary/40 hover:text-content-primary">
            <Github className="size-4" /> Source
          </a>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] text-content-soft">
          {["No smart contract", "Keys never leave your device", "Coexists with MetaMask (EIP-6963)", "Open source"].map((b) => (
            <span key={b} className="inline-flex items-center gap-1.5 rounded-full border border-bdr-soft px-2.5 py-1">
              <Lock className="size-3 text-primary" /> {b}
            </span>
          ))}
        </div>
      </section>

      {/* features */}
      <section className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-bdr-soft bg-card/50 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><f.icon className="size-5" /></span>
              <StatusPill status={f.status} />
            </div>
            <h3 className="mt-3 text-base font-semibold text-content-primary">{f.title}</h3>
            <p className="mt-1 text-sm text-content-soft">{f.body}</p>
          </div>
        ))}
      </section>

      {/* install */}
      <section id="install" className="mt-16 scroll-mt-20 rounded-2xl border border-bdr-soft bg-card/50 p-6 backdrop-blur-sm sm:p-8">
        <h2 className="text-xl font-semibold text-content-primary">Install it (no build needed)</h2>
        <p className="mt-1 text-sm text-content-soft">
          Grab the prebuilt extension and load it in under a minute. A one-click Chrome Web Store listing lands after the security audit.
        </p>
        <div className="mt-6 space-y-5">
          <Step n={1} title="Download the prebuilt wallet">
            <a href={DOWNLOAD_URL} className="mt-1 inline-flex items-center gap-2 rounded-lg bg-gradient-primary px-3.5 py-2 text-xs font-semibold text-white shadow-[0_2px_10px_-2px_rgba(112,100,233,0.6)] transition-all hover:brightness-110">
              <Download className="size-3.5" /> lightnode-wallet-chrome.zip
            </a>
            <p className="mt-1.5 text-[12px]">Then unzip it anywhere - no Node, no build.</p>
          </Step>
          <Step n={2} title="Load it into Chrome">
            Open <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono">chrome://extensions</code>, enable <span className="text-content-primary">Developer mode</span> (top right), click <span className="text-content-primary">Load unpacked</span>, and select the unzipped folder.
          </Step>
          <Step n={3} title="Create or import your wallet">
            Pin the extension, open it, and create a new 24-word wallet (or import one). The recovery phrase is shown once and encrypted on your device - write it down; nobody, including us, can recover it.
          </Step>
        </div>
        <p className="mt-6 flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/6 p-3 text-[12px] text-content-soft">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" />
          Once installed, the wallet appears automatically in dApp connect dialogs via EIP-6963 - it coexists cleanly with any other wallet you have.
        </p>
        <details className="mt-4 text-sm text-content-soft">
          <summary className="cursor-pointer font-medium text-content-primary">Prefer to build from source? (developers)</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-bdr-soft bg-surface-base-faint p-3 font-mono text-xs leading-relaxed text-content-default">{`git clone https://github.com/marinom2/lightnode
cd lightnode/wallet
npm install
npm run build      # outputs wallet/.output/chrome-mv3`}</pre>
        </details>
      </section>

      {/* security */}
      <section className="mt-12 rounded-2xl border border-bdr-soft bg-card/50 p-6 backdrop-blur-sm sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-content-primary"><ShieldCheck className="size-5 text-primary" /> Security</h2>
        <ul className="mt-4 grid gap-3 text-sm text-content-soft sm:grid-cols-2">
          <li><span className="text-content-primary">Self-custodial.</span> Keys are generated and encrypted on your device and never transmitted. We never hold your funds.</li>
          <li><span className="text-content-primary">Strong vault.</span> The recovery phrase is sealed with AES-256-GCM under a scrypt-derived key; a wrong password simply fails to decrypt.</li>
          <li><span className="text-content-primary">Locked by default.</span> Auto-locks on inactivity and boots locked after a browser restart.</li>
          <li><span className="text-content-primary">Honest about the gate.</span> Like every wallet, it needs an external security audit before holding meaningful mainnet funds. The keyring is tested against the standard BIP-44 vectors today.</li>
        </ul>
        <p className="mt-5 text-[12px] text-content-soft">Independent and community-built. Not an official LightChain product.</p>
      </section>
    </div>
  );
}
