import Link from "next/link";
import {
  Boxes,
  Code2,
  Download,
  ExternalLink,
  Github,
  PackageOpen,
  PlayCircle,
  Rocket,
  ShieldCheck,
  TerminalSquare,
  Wallet2,
  Workflow,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { HideOnDesktop } from "@/components/hide-on-desktop";

const STACKBLITZ_URL = "https://stackblitz.com/github/marinom2/lightnode/tree/main/examples/quickstart-inference";
const EXAMPLE_REPO_URL = "https://github.com/marinom2/lightnode/tree/main/examples/quickstart-inference";
const LCAI_IDE_URL = "https://github.com/lightchain-protocol/lcai-ide";

interface FrameworkExample {
  name: string;
  blurb: string;
  path: string;
  badge: string;
}

const FRAMEWORK_EXAMPLES: FrameworkExample[] = [
  {
    name: "Node CLI / script",
    blurb: "Standalone Node + tsx. 120 lines, prints the decrypted answer + 3 tx hashes.",
    path: "examples/quickstart-inference",
    badge: "starter",
  },
  {
    name: "Next.js API route",
    blurb: "Drop-in app/api/inference/route.ts. POST a prompt from the browser, get JSON back.",
    path: "examples/nextjs-api-route",
    badge: "App Router",
  },
  {
    name: "Hono server",
    blurb: "Tiny standalone microservice. Same JSON contract; deploys to Bun, Node, Railway, Fly.",
    path: "examples/hono-server",
    badge: "any Node",
  },
];

export const metadata = {
  title: "Build with LightChain AI · LightNode",
  description:
    "Run encrypted LightChain AI inference from your own dApp with lightnode-sdk: install, sign with your wallet, get a streamed answer. Live-verified on mainnet and testnet.",
};

// Live-verified transactions from the SDK's release run (mainnet + testnet).
// Hard-coded so the page is purely static and these proofs survive forever.
const VERIFIED = {
  mainnet: {
    createSession: "0xf091957f515eb472e71f6d442ee24c9c74e948412e2b7ad658dfbb4b57d4a6ca",
    submitJob: "0x6ff44a4aa4b08cd38715369705a4338af3bb6ee456f2b8819d62fc779846bb89",
    explorer: "https://mainnet.lightscan.app",
    output:
      "Did you know there is a type of jellyfish called the 'Upside-Down Jellyfish' that actually swims on its back, using its tentacles to catch prey and defend itself from predators?",
  },
  testnet: {
    createSession: "0x77686f3fc37573f0745f256a5c74f5944d3a2a7de745129bd918e8b0ef2bc587",
    submitJob: "0xba9d48c4f8eacf24d363ceb884f6c6c2fcca54a82fa0a341625944d293b2bd96",
    explorer: "https://testnet.lightscan.app",
    output:
      "Did you know that the deepest part of the ocean, the Mariana Trench, is so deep that if you were to drop Mount Everest into it, its peak would still be more than 1 mile underwater?!",
  },
} as const;

const QUICKSTART = `import WS from "ws";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  LightNode, prepareSession, submitPrompt, decryptResponse,
  JOB_REGISTRY_CONSUMER_ABI, consumerGatewayUrl, GatewayClient,
} from "lightnode-sdk";

// 1. Auth your wallet against the gateway (SIWE → JWT).
const ln = new LightNode("testnet");
const acct = privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`);
const wal = createWalletClient({ account: acct, transport: http(ln.network.rpc), chain });
const ch = await (await fetch(\`\${consumerGatewayUrl("testnet")}/api/auth/challenge?address=\${acct.address}\`)).json();
const sig = await wal.signMessage({ message: ch.message });
const { token } = await (await fetch(\`\${consumerGatewayUrl("testnet")}/api/auth/verify\`, { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: ch.message, signature: sig }) })).json();

// 2. Prepare a session and sign createSession on-chain.
const gateway = new GatewayClient({ network: "testnet", bearer: token });
const { sessionKey, createSessionArgs } = await prepareSession(gateway, "llama3-8b");
// ...sign createSession, then submitPrompt + submitJob, then stream the response over the relay WS and decryptResponse.
// Full ~120 line example in the SDK README.`;

const PHASES = [
  { icon: Wallet2, label: "Auth", desc: "SIWE handshake → bearer JWT for the gateway" },
  { icon: Workflow, label: "Prepare", desc: "Worker selected, session key wrapped with ECDH-P256" },
  { icon: ShieldCheck, label: "Sign", desc: "Your wallet signs createSession on-chain" },
  { icon: Zap, label: "Submit", desc: "AES-GCM-encrypted prompt uploaded; submitJob pays the fee" },
  { icon: PlayCircle, label: "Stream", desc: "Encrypted relay frames decrypted live with the session key" },
];

function TxRow({
  net,
  data,
}: {
  net: "mainnet" | "testnet";
  data: (typeof VERIFIED)["mainnet"] | (typeof VERIFIED)["testnet"];
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Badge tone={net === "mainnet" ? "success" : "brand"}>{net}</Badge>
        <span className="text-xs text-content-soft">chain {net === "mainnet" ? "9200" : "8200"}</span>
      </div>
      <div className="space-y-2 font-mono text-xs">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-content-soft">createSession</span>
          <a
            href={`${data.explorer}/tx/${data.createSession}`}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary hover:underline"
          >
            {data.createSession.slice(0, 12)}…{data.createSession.slice(-10)}
            <ExternalLink className="ml-1 inline size-3" />
          </a>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-content-soft">submitJob</span>
          <a
            href={`${data.explorer}/tx/${data.submitJob}`}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary hover:underline"
          >
            {data.submitJob.slice(0, 12)}…{data.submitJob.slice(-10)}
            <ExternalLink className="ml-1 inline size-3" />
          </a>
        </div>
      </div>
      <p className="mt-4 rounded-lg border border-bdr-soft bg-surface-base-faint p-3 text-sm leading-relaxed text-content-default">
        <span className="mr-1 text-xs uppercase tracking-wide text-content-soft">decrypted</span>
        {data.output}
      </p>
    </Card>
  );
}

export default function BuildPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-10">
        <Badge tone="brand" className="mb-4">
          For builders
        </Badge>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-content-primary sm:text-5xl">
          Build with <span className="text-gradient">LightChain AI</span> in 5 minutes
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-content-soft">
          Run encrypted inference from your own dApp with{" "}
          <code className="rounded bg-surface-base-faint px-1.5 py-0.5 font-mono text-base text-content-primary">
            lightnode-sdk
          </code>
          . Non-custodial - your wallet signs on-chain, the SDK does the rest. ~0.02 LCAI per call,
          ECDH-P256 + AES-256-GCM end-to-end, no infrastructure to run.
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

      <div className="mb-10">
        <div className="mb-4 flex items-center gap-3">
          <IconChip icon={Boxes} size="md" />
          <div>
            <h2 className="text-base font-semibold tracking-tight text-content-primary">Three ways to try it</h2>
            <p className="text-xs text-content-soft">
              Pick one. Same flow, three runtimes - browser wallet, cloud IDE, or your laptop.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="flex flex-col p-5">
            <div className="mb-3 flex items-center gap-2">
              <PlayCircle className="size-4 text-primary" />
              <span className="text-sm font-semibold text-content-primary">In the browser</span>
              <Badge tone="success" className="ml-auto">no install</Badge>
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
              <Badge tone="brand" className="ml-auto">~30 sec</Badge>
            </div>
            <p className="mb-4 flex-1 text-xs leading-relaxed text-content-soft">
              Open the runnable starter (Node + the SDK + viem + ws) pre-installed in a full cloud dev environment.
              Paste your funded testnet key, hit Run, see one real inference complete.
            </p>
            <div className="flex flex-col gap-2">
              <Button asChild size="sm" variant="outline" className="w-full">
                <a href={STACKBLITZ_URL} target="_blank" rel="noopener noreferrer">
                  Open in StackBlitz <ExternalLink />
                </a>
              </Button>
              {/* Codespaces is web-only - the desktop app already has a local
                  environment, so this button would just dead-end there. */}
              <HideOnDesktop>
                <Button asChild size="sm" variant="outline" className="w-full">
                  <a
                    href="https://codespaces.new/marinom2/lightnode?machine=basicLinux32gb"
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
              <Badge tone="muted" className="ml-auto">git clone</Badge>
            </div>
            <p className="mb-4 flex-1 text-xs leading-relaxed text-content-soft">
              <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-[11px]">
                examples/quickstart-inference
              </code>{" "}
              in the repo. <code className="font-mono">npm i</code> →{" "}
              <code className="font-mono">cp .env.example .env</code> → <code className="font-mono">npm start</code>.
            </p>
            <Button asChild size="sm" variant="outline" className="w-full">
              <a href={EXAMPLE_REPO_URL} target="_blank" rel="noopener noreferrer">
                View on GitHub <ExternalLink />
              </a>
            </Button>
          </Card>
        </div>
      </div>

      <div className="mb-10">
        <div className="mb-4 flex items-center gap-3">
          <IconChip icon={Workflow} size="md" />
          <div>
            <h2 className="text-base font-semibold tracking-tight text-content-primary">In your stack</h2>
            <p className="text-xs text-content-soft">
              Same flow, three drop-in shapes. Pick the one closest to your project.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {FRAMEWORK_EXAMPLES.map((ex) => (
            <Card key={ex.path} className="flex flex-col p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-content-primary">{ex.name}</span>
                <Badge tone="muted" className="ml-auto">
                  {ex.badge}
                </Badge>
              </div>
              <p className="mb-4 flex-1 text-xs leading-relaxed text-content-soft">{ex.blurb}</p>
              <div className="flex flex-col gap-2">
                <Button asChild size="sm" variant="outline" className="w-full">
                  <a
                    href={`https://github.com/marinom2/lightnode/tree/main/${ex.path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Github /> View source <ExternalLink />
                  </a>
                </Button>
                <Button asChild size="sm" className="w-full">
                  <a
                    href={`https://stackblitz.com/github/marinom2/lightnode/tree/main/${ex.path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Code2 /> Open in StackBlitz <ExternalLink />
                  </a>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Card className="mb-10 p-6">
        <div className="mb-3 flex items-center gap-3">
          <IconChip icon={TerminalSquare} size="md" />
          <h2 className="text-base font-semibold tracking-tight text-content-primary">Install</h2>
        </div>
        <pre className="overflow-x-auto rounded-xl border border-bdr-soft bg-[#0b0b14] p-4 font-mono text-sm leading-relaxed text-content-default">
          <code>npm install lightnode-sdk viem ws</code>
        </pre>
        <p className="mt-3 text-xs text-content-soft">
          Single peer dep: <code className="font-mono text-content-default">viem</code>. The SDK is ESM, Node 18+
          compatible. Works in browser too (the bundled crypto uses Web Crypto via globalThis).
        </p>
      </Card>

      <div className="mb-10">
        <div className="mb-4 flex items-center gap-3">
          <IconChip icon={Zap} size="md" />
          <div>
            <h2 className="text-base font-semibold tracking-tight text-content-primary">One command, you&apos;re integrated</h2>
            <p className="text-xs text-content-soft">
              Scaffold a brand-new project, or patch your existing one. Auto-detects Next.js, Hono, and Node.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-content-primary">Brand-new project</span>
              <Badge tone="success" className="ml-auto">
                ~30 sec
              </Badge>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-xs leading-relaxed text-content-default">
              <code>npm create lightnode-app my-app</code>
            </pre>
            <p className="mt-3 text-xs leading-relaxed text-content-soft">
              Pick from three templates (Node CLI, Next.js app, Hono server), set a private key, run. Same{" "}
              <code>create-X-app</code> pattern as <code>create-next-app</code>.
            </p>
          </Card>
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-content-primary">Existing project</span>
              <Badge tone="brand" className="ml-auto">
                in-place
              </Badge>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-xs leading-relaxed text-content-default">
              <code>npx lightnode add inference</code>
            </pre>
            <p className="mt-3 text-xs leading-relaxed text-content-soft">
              Detects your framework (Next.js, Hono, Node) and writes the right file in the right place plus an{" "}
              <code>.env.example</code>. Idempotent; never overwrites without <code>--force</code>.
            </p>
          </Card>
        </div>
      </div>

      <Card className="mb-10 p-6">
        <div className="mb-3 flex items-center gap-3">
          <IconChip icon={Code2} size="md" />
          <div>
            <h2 className="text-base font-semibold tracking-tight text-content-primary">Quickstart</h2>
            <p className="text-xs text-content-soft">
              One encrypted inference end to end. Real testable code; ~120 lines including the relay WS.
            </p>
          </div>
        </div>
        <pre className="overflow-x-auto rounded-xl border border-bdr-soft bg-[#0b0b14] p-4 font-mono text-[12px] leading-relaxed text-content-default">
          <code>{QUICKSTART}</code>
        </pre>
        <p className="mt-3 text-xs text-content-soft">
          Full runnable file (with the createSession + submitJob viem calls, relay WS, JobCompleted poll) is in the SDK
          README and the{" "}
          <a
            className="text-primary hover:underline"
            href="https://github.com/marinom2/lightnode/blob/main/sdk/README.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub repo
          </a>
          .
        </p>
      </Card>

      <Card className="mb-10 p-6">
        <div className="mb-4 flex items-center gap-3">
          <IconChip icon={Workflow} size="md" />
          <div>
            <h2 className="text-base font-semibold tracking-tight text-content-primary">How it works</h2>
            <p className="text-xs text-content-soft">
              Five stages. The SDK handles the protocol; your wallet signs the on-chain bits.
            </p>
          </div>
        </div>
        <ol className="space-y-2.5">
          {PHASES.map((p, i) => (
            <li
              key={p.label}
              className="flex items-start gap-3 rounded-xl border border-bdr-soft bg-surface-base-faint px-4 py-3"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 font-mono text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p.icon className="size-4 text-content-soft" />
                  <span className="text-sm font-semibold text-content-primary">{p.label}</span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-content-soft">{p.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="mb-10">
        <div className="mb-4 flex items-center gap-3">
          <IconChip icon={Rocket} size="md" />
          <div>
            <h2 className="text-base font-semibold tracking-tight text-content-primary">
              Live-verified end to end
            </h2>
            <p className="text-xs text-content-soft">
              The SDK was tested with real LCAI before release. The on-chain transactions below ran the same code path
              you would call from your app.
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <TxRow net="mainnet" data={VERIFIED.mainnet} />
          <TxRow net="testnet" data={VERIFIED.testnet} />
        </div>
      </div>

      <Card className="mb-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconChip icon={PlayCircle} size="md" />
            <div>
              <h2 className="text-base font-semibold tracking-tight text-content-primary">Try it in your browser</h2>
              <p className="text-xs text-content-soft">
                Free testnet LCAI, no install, no server. Connect a wallet and run one real inference end to end.
              </p>
            </div>
          </div>
          <Button asChild>
            <Link href="/playground">
              Open playground <ExternalLink />
            </Link>
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconChip icon={ShieldCheck} size="md" />
            <div>
              <h2 className="text-base font-semibold tracking-tight text-content-primary">
                Want to inspect the contracts directly?
              </h2>
              <p className="text-xs text-content-soft">
                LightChain&apos;s Remix-fork IDE lets you load the JobRegistry / AIConfig contracts, decode tx
                payloads, and write custom callers in Solidity. Great if you&apos;re building a contract that talks to
                the protocol, not just a dApp that uses it.
              </p>
            </div>
          </div>
          <Button asChild variant="outline">
            <a href={LCAI_IDE_URL} target="_blank" rel="noopener noreferrer">
              Open lcai-ide <ExternalLink />
            </a>
          </Button>
        </div>
      </Card>
    </div>
  );
}
