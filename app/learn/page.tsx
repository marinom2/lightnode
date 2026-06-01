import Link from "next/link";
import { ArrowRight, Cpu, Globe, KeyRound, Lock, Network, Shield, Sparkles, Wallet2, Workflow } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LiveStats } from "@/components/live-stats";

export const metadata = {
  title: "How LightChain AI works - LightNode",
  description:
    "What LightChain AI is, why decentralized inference matters, and how a single encrypted job flows from your wallet through a worker and back. Non-technical, with live data.",
};

const FLOW = [
  {
    icon: Wallet2,
    title: "Your wallet picks a worker",
    body: "You connect a wallet on LightChain. The gateway picks a worker from the public pool based on stake and recent reliability.",
  },
  {
    icon: Lock,
    title: "Your prompt is encrypted to the worker only",
    body: "An ECDH key exchange wraps a fresh session key. Your prompt is encrypted with that key. Only the chosen worker can decrypt it.",
  },
  {
    icon: Cpu,
    title: "The worker runs the model",
    body: "The worker runs Ollama under the hood on its own GPU, locally on its machine. No cloud, no third party. The answer streams back encrypted.",
  },
  {
    icon: Shield,
    title: "Proof anchored on chain",
    body: "Job ID, model ID, worker, and timing land on chain. Anyone can read who ran what. If the worker stalls, the protocol times them out and refunds the fee.",
  },
  {
    icon: Sparkles,
    title: "You get the answer",
    body: "Your client decrypts the answer with its session key. Usual end-to-end latency is 5-25 seconds, depending on model + prompt size.",
  },
] as const;

const WHY = [
  {
    icon: Lock,
    title: "Your prompts never sit on a third-party server",
    body: "End-to-end encrypted between you and the worker. No log retention contract to read, no policy to trust - the worker physically cannot store what it cannot decrypt after the session ends.",
  },
  {
    icon: KeyRound,
    title: "You hold the keys, not a platform",
    body: "Your wallet is your identity. No account to deactivate, no rate-limit table behind someone's API key. The protocol takes payment per call, in LCAI.",
  },
  {
    icon: Network,
    title: "The network is open",
    body: "Anyone with a GPU can register a worker and earn LCAI for serving inference. No allow-list, no application form. That is what makes the supply side decentralized.",
  },
  {
    icon: Globe,
    title: "On-chain proof, off-chain compute",
    body: "Heavy work runs on the worker. Only the receipts (who, when, which model) sit on the LightChain L1 - cheap to read, cheap to audit, never goes away.",
  },
] as const;

const ECOSYSTEM = [
  {
    name: "LightChain AI",
    line: "The base layer. Sovereign L1, chain ID 9200. Hosts the worker registry, job registry, fee pool, and the LCAI token.",
    href: "https://lightchain.ai",
  },
  {
    name: "Lightscan",
    line: "Block explorer for LightChain. Look up any job, worker, contract, or transaction.",
    href: "https://mainnet.lightscan.app",
  },
  {
    name: "Worker explorer",
    line: "Public dashboard of registered workers, stake, and recent jobs across mainnet + testnet.",
    href: "https://workers-testnet.lightchain.ai",
  },
  {
    name: "AI Chat",
    line: "The official consumer chat. Same encrypted-inference pipeline LightNode SDKs use.",
    href: "https://chat.lightchain.ai",
  },
  {
    name: "DAO",
    line: "LCAI governance lives on both Ethereum (LCAIGovernor) and LightChain (LightChainGovernor + NativeVotes precompile).",
    href: "https://dao.lightchain.ai",
  },
  {
    name: "LightNode",
    line: "Community SDK + UX layer. Encrypted inference in 5 lines, scaffolders for new apps, a one-click desktop worker app.",
    href: "/build",
  },
] as const;

export default function LearnPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      {/* Hero */}
      <div className="mb-12">
        <p className="mb-2 text-[11px] uppercase tracking-wide text-content-soft">For everyone</p>
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-content-primary sm:text-4xl">
          How LightChain AI works
        </h1>
        <p className="mt-3 max-w-2xl text-content-soft">
          The short version: a decentralized network of GPU operators serves AI inference, paid in LCAI, with every job
          anchored on chain. No central API, no platform middleman. This page explains it without jargon - the SDK
          docs cover the cryptography if you want it.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild variant="gradient">
            <Link href="/playground">
              Try a real inference <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/network">See live network stats</Link>
          </Button>
        </div>
      </div>

      {/* Live data tile - keeps the page from feeling static */}
      <Card className="mb-12 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Network className="size-4 text-primary" />
          <span className="text-sm font-semibold text-content-primary">Right now on the network</span>
        </div>
        <LiveStats />
      </Card>

      {/* How an inference happens */}
      <section className="mb-12">
        <h2 className="mb-1 text-xl font-semibold tracking-tight text-content-primary">A single inference, end to end</h2>
        <p className="mb-5 text-sm text-content-soft">
          Five steps. Wallet to answer in 5-25 seconds on the public network.
        </p>
        <ol className="space-y-3">
          {FLOW.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-bdr-soft bg-surface-base-faint text-xs font-medium text-content-soft">
                {i + 1}
              </div>
              <Card className="flex-1 p-4">
                <div className="mb-1 flex items-center gap-2">
                  <s.icon className="size-4 text-primary" />
                  <span className="text-sm font-semibold text-content-primary">{s.title}</span>
                </div>
                <p className="text-xs leading-relaxed text-content-soft">{s.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* Why this matters */}
      <section className="mb-12">
        <h2 className="mb-1 text-xl font-semibold tracking-tight text-content-primary">Why decentralized inference</h2>
        <p className="mb-5 text-sm text-content-soft">
          What the protocol gives you that a hosted API does not.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {WHY.map((w) => (
            <Card key={w.title} className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <w.icon className="size-4 text-primary" />
                <span className="text-sm font-semibold text-content-primary">{w.title}</span>
              </div>
              <p className="text-xs leading-relaxed text-content-soft">{w.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Ecosystem map */}
      <section className="mb-12">
        <h2 className="mb-1 text-xl font-semibold tracking-tight text-content-primary">The ecosystem</h2>
        <p className="mb-5 text-sm text-content-soft">
          What runs where, who built what, what to read for more.
        </p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {ECOSYSTEM.map((e) => {
            const external = e.href.startsWith("http");
            return (
              <Card key={e.name} className="p-4">
                <div className="mb-1.5 flex items-center gap-2">
                  <Workflow className="size-4 text-primary" />
                  <span className="text-sm font-semibold text-content-primary">{e.name}</span>
                </div>
                <p className="mb-2 text-xs leading-relaxed text-content-soft">{e.line}</p>
                <Link
                  href={e.href}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noopener noreferrer" : undefined}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  {external ? e.href.replace(/^https?:\/\//, "") : `Open ${e.name}`}
                  <ArrowRight className="size-3" />
                </Link>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Three doors */}
      <section className="mb-4">
        <h2 className="mb-5 text-xl font-semibold tracking-tight text-content-primary">What to do next</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="flex flex-col p-5">
            <span className="text-sm font-semibold text-content-primary">Just curious</span>
            <p className="mb-3 mt-1 flex-1 text-xs leading-relaxed text-content-soft">
              Run one real encrypted inference in your browser. Connects to your wallet, signs two transactions, gets a
              streamed answer back. Use the testnet faucet so it is free.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/playground">
                Open the playground <ArrowRight />
              </Link>
            </Button>
          </Card>
          <Card className="flex flex-col p-5">
            <span className="text-sm font-semibold text-content-primary">Have a GPU</span>
            <p className="mb-3 mt-1 flex-1 text-xs leading-relaxed text-content-soft">
              The desktop app generates worker keys, funds them, stakes, and brings your node online. Earn LCAI for
              every job served. macOS, Windows, Linux.
            </p>
            <Button asChild size="sm" variant="gradient">
              <Link href="/onboard">
                Run a worker <ArrowRight />
              </Link>
            </Button>
          </Card>
          <Card className="flex flex-col p-5">
            <span className="text-sm font-semibold text-content-primary">Want to build with it</span>
            <p className="mb-3 mt-1 flex-1 text-xs leading-relaxed text-content-soft">
              Five-line encrypted inference, Bridge + DAO SDKs, parallel batch + agent loops, the worker-operator
              write surface. One npm install, nine modules. Works in Node, browsers, edge runtimes.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/build">
                Builder hub <ArrowRight />
              </Link>
            </Button>
          </Card>
        </div>
      </section>
    </div>
  );
}
