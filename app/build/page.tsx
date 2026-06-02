import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  Code2,
  Database,
  Download,
  ExternalLink,
  FileText,
  Github,
  Globe,
  PackageOpen,
  PlayCircle,
  TerminalSquare,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HideOnDesktop } from "@/components/hide-on-desktop";
import { SectionHeader } from "@/components/build/section-header";

const EXAMPLES_REPO = "marinom2/lightnode-examples";
const STACKBLITZ_URL = `https://stackblitz.com/github/${EXAMPLES_REPO}/tree/main/quickstart-inference`;
const EXAMPLE_REPO_URL = `https://github.com/${EXAMPLES_REPO}/tree/main/quickstart-inference`;

export const metadata = {
  title: "Build with LightChain AI",
  description:
    "Run encrypted LightChain AI inference from your own dApp with lightnode-sdk. Five-line API, read-only network client, bridge, DAO, worker preflight, multi-turn chat, refund queries, models on-chain.",
};

const QUICKSTART = `// 5 lines, key in, answer out. Works in Node, Next.js, anywhere.
import { runInferenceWithKey } from "lightnode-sdk";

const { answer, txs } = await runInferenceWithKey({
  network: "testnet",                              // or "mainnet"
  privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
  prompt: "Reply with a one-sentence fun fact about the ocean.",
});

console.log(answer);                               // decrypted answer
console.log(txs.createSession, txs.submitJob);     // on-chain receipts`;

const ROUTES = [
  {
    href: "/build/sdks",
    icon: Boxes,
    title: "SDK modules",
    desc: "Six interactive cards. Bridge live quotes, real DAO proposals, multi-turn chat, worker preflight, dispute lookup, models. Plus the three API tiers and server-vs-user-pays patterns.",
    cta: "Try each module inline",
  },
  {
    href: "/build/cli",
    icon: FileText,
    title: "CLI",
    desc: "Run lightnode commands from the browser via the interactive runner. Plus the full catalog and how to actually invoke npx without the package-name conflict.",
    cta: "Run a CLI command",
  },
  {
    href: "/build/network",
    icon: Globe,
    title: "Live network",
    desc: "Real mainnet workers + models + per-model performance, refreshed every minute. Plus the five-stage encrypted-inference protocol and live-verified mainnet+testnet receipts.",
    cta: "See live network data",
  },
  {
    href: "/build/reference",
    icon: Database,
    title: "Reference",
    desc: "All 14 read-only LightNode methods. Testnet vs mainnet. Every official contract address. Recent SDK versions. Non-custodial model. Python port. Framework examples.",
    cta: "Browse the reference",
  },
] as const;

export default function BuildHubPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <div className="mb-10">
        <Badge tone="brand" className="mb-4">For builders</Badge>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-content-primary sm:text-5xl">
          Build with <span className="text-gradient">LightChain AI</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-content-soft">
          Run encrypted inference from your own app with{" "}
          <code className="rounded bg-surface-base-faint px-1.5 py-0.5 font-mono text-base text-content-primary">
            lightnode-sdk
          </code>
          . Non-custodial. Your wallet signs on-chain, the SDK does the rest. About 0.022 LCAI per call on mainnet,
          free on testnet, ECDH-P256 + AES-256-GCM end to end.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <Button asChild>
            <Link href="/playground">
              <PlayCircle /> Open the playground
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <a href="https://www.npmjs.com/package/lightnode-sdk" target="_blank" rel="noopener noreferrer">
              <PackageOpen /> View on npm <ExternalLink />
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href="https://github.com/marinom2/lightnode/tree/main/sdk" target="_blank" rel="noopener noreferrer">
              <Github /> Source on GitHub <ExternalLink />
            </a>
          </Button>
        </div>
      </div>

      {/* ── THREE WAYS TO TRY ────────────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Boxes}
          title="Three ways to try it"
          blurb="Pick one. Browser wallet, cloud IDE, or your laptop."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="flex flex-col p-5">
            <div className="mb-3 flex items-center gap-2">
              <PlayCircle className="size-4 text-primary" />
              <span className="text-sm font-semibold text-content-primary">In the browser</span>
              <span className="ml-auto text-[10px] text-content-soft">no install</span>
            </div>
            <p className="mb-4 flex-1 text-xs leading-relaxed text-content-soft">
              The live playground: connect a wallet, type a prompt, watch the decrypted answer stream. Free on testnet.
            </p>
            <Button asChild size="sm" className="w-full">
              <Link href="/playground">
                Open the playground <ExternalLink />
              </Link>
            </Button>
          </Card>
          <Card className="flex flex-col p-5">
            <div className="mb-3 flex items-center gap-2">
              <Code2 className="size-4 text-primary" />
              <span className="text-sm font-semibold text-content-primary">In a cloud IDE</span>
              <span className="ml-auto text-[10px] text-content-soft">about 5 sec</span>
            </div>
            <p className="mb-4 flex-1 text-xs leading-relaxed text-content-soft">
              Runnable starter pre-installed. Fund the printed testnet address with one faucet click, hit Run, see one
              real inference complete.
            </p>
            <div className="flex flex-col gap-2">
              <Button asChild size="sm" variant="outline" className="w-full">
                <a href={STACKBLITZ_URL} target="_blank" rel="noopener noreferrer">
                  Open in StackBlitz <ExternalLink />
                </a>
              </Button>
              <HideOnDesktop>
                <Button asChild size="sm" variant="outline" className="w-full">
                  <a
                    href={`https://codespaces.new/${EXAMPLES_REPO}?machine=basicLinux32gb`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Github /> Open in Codespaces <ExternalLink />
                  </a>
                </Button>
              </HideOnDesktop>
            </div>
          </Card>
          <Card className="flex flex-col p-5">
            <div className="mb-3 flex items-center gap-2">
              <Download className="size-4 text-primary" />
              <span className="text-sm font-semibold text-content-primary">On your laptop</span>
              <span className="ml-auto text-[10px] text-content-soft">git clone</span>
            </div>
            <p className="mb-4 flex-1 text-xs leading-relaxed text-content-soft">
              Clone{" "}
              <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-[11px]">
                marinom2/lightnode-examples
              </code>
              , <code className="font-mono">cd quickstart-inference</code>,{" "}
              <code className="font-mono">npm i</code>, <code className="font-mono">npm start</code>.
            </p>
            <Button asChild size="sm" variant="outline" className="w-full">
              <a href={EXAMPLE_REPO_URL} target="_blank" rel="noopener noreferrer">
                View on GitHub <ExternalLink />
              </a>
            </Button>
          </Card>
        </div>
      </div>

      {/* ── INSTALL + QUICKSTART ─────────────────────────────────────── */}
      <Card className="mb-6 p-6">
        <SectionHeader
          icon={TerminalSquare}
          title="Install"
          blurb="One package, one peer dep. Pure-JS crypto (noble), runs in Node 18+, browsers, StackBlitz, Bun, Cloudflare Workers."
        />
        <pre className="overflow-x-auto rounded-xl border border-bdr-soft code-surface p-4 font-mono text-sm leading-relaxed text-content-default">
          <code>npm install lightnode-sdk viem</code>
        </pre>
      </Card>

      <Card className="mb-12 p-6">
        <SectionHeader
          icon={Code2}
          title="Quickstart"
          blurb="One encrypted inference end to end. Real code, runs as-is."
        />
        <pre className="overflow-x-auto rounded-xl border border-bdr-soft code-surface p-4 font-mono text-[12px] leading-relaxed text-content-default">
          <code>{QUICKSTART}</code>
        </pre>
      </Card>

      {/* ── SCAFFOLDERS ──────────────────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Zap}
          title="One command, you're integrated"
          blurb="Brand-new project? Use the create scaffolder. Existing project? Use add. Both detect Next.js, Hono, and Node."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <PackageOpen className="size-4 text-primary" />
              <span className="text-sm font-semibold text-content-primary">create-lightnode-app</span>
              <span className="ml-auto text-[10px] text-content-soft">about 30 sec</span>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-bdr-soft code-surface p-3 font-mono text-xs leading-relaxed text-content-default">
              <code>npm create lightnode-app my-app</code>
            </pre>
            <p className="mt-3 text-xs leading-relaxed text-content-soft">
              Scaffold a brand-new LightChain AI dApp. Three templates:{" "}
              <code className="font-mono text-content-default">node</code>,{" "}
              <code className="font-mono text-content-default">nextjs-api</code>,{" "}
              <code className="font-mono text-content-default">hono</code>.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href="https://www.npmjs.com/package/create-lightnode-app"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-bdr-soft px-2 py-1 text-[11px] text-content-soft transition-colors hover:border-bdr-light hover:text-content-primary"
              >
                <PackageOpen className="size-3" /> npm <ExternalLink className="size-3" />
              </a>
              <a
                href="https://github.com/marinom2/lightnode/tree/main/create-lightnode-app"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-bdr-soft px-2 py-1 text-[11px] text-content-soft transition-colors hover:border-bdr-light hover:text-content-primary"
              >
                <Github className="size-3" /> source <ExternalLink className="size-3" />
              </a>
            </div>
          </Card>
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              <span className="text-sm font-semibold text-content-primary">lightnode add</span>
              <span className="ml-auto text-[10px] text-content-soft">in your project</span>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-bdr-soft code-surface p-3 font-mono text-xs leading-relaxed text-content-default">
              <code>npx lightnode add inference</code>
            </pre>
            <p className="mt-3 text-xs leading-relaxed text-content-soft">
              Ten subcommands, server-paid and user-paid (web3): inference, chat, judge, agent, analytics-dashboard,
              nft-mint-with-inference, plus inference-web3, chat-web3, judge-web3, and wagmi-setup. Detects your
              framework. Full catalog on the{" "}
              <Link href="/build/cli" className="text-primary hover:underline">
                CLI page
              </Link>
              .
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href="https://www.npmjs.com/package/lightnode-sdk"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-bdr-soft px-2 py-1 text-[11px] text-content-soft transition-colors hover:border-bdr-light hover:text-content-primary"
              >
                <PackageOpen className="size-3" /> npm <ExternalLink className="size-3" />
              </a>
              <a
                href="https://github.com/marinom2/lightnode/tree/main/sdk/src/add.ts"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-bdr-soft px-2 py-1 text-[11px] text-content-soft transition-colors hover:border-bdr-light hover:text-content-primary"
              >
                <Github className="size-3" /> source <ExternalLink className="size-3" />
              </a>
            </div>
          </Card>
        </div>
      </div>

      {/* ── ROUTING CARDS to the 4 sub-pages ─────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={ArrowRight}
          title="Dive in"
          blurb="The rest of /build is split into four focused sub-pages. Pick one."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {ROUTES.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className="group block rounded-xl border border-bdr-soft bg-card p-5 transition-all hover:border-primary/40 hover:bg-surface-base-faint"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg border border-bdr-soft bg-surface-base-faint text-content-soft transition-colors group-hover:border-primary/40 group-hover:text-primary">
                  <r.icon className="size-4" />
                </span>
                <span className="text-sm font-semibold text-content-primary">{r.title}</span>
                <ArrowRight className="ml-auto size-4 text-content-soft transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
              <p className="text-xs leading-relaxed text-content-soft">{r.desc}</p>
              <span className="mt-3 inline-block text-[11px] font-medium text-primary">{r.cta} -&gt;</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
