import Link from "next/link";
import {
  Activity,
  AlertOctagon,
  Boxes,
  Code2,
  Database,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Github,
  Globe,
  KeyRound,
  Layers,
  Lock,
  PackageOpen,
  PlayCircle,
  Rocket,
  Server,
  ShieldCheck,
  TerminalSquare,
  User2,
  Wallet2,
  Workflow,
  Zap,
} from "lucide-react";
import { LightNode } from "lightnode-sdk";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { HideOnDesktop } from "@/components/hide-on-desktop";
import { CliRunner } from "@/components/cli-runner";

// /build is server-rendered with live SDK data so the page reads as a
// living artifact, not a docs page. revalidate keeps the data within ~60s
// of fresh without forcing a request-time fetch for every visitor.
export const revalidate = 60;

// Examples live in their own tiny repo so StackBlitz / Codespaces clone in <1s
// (cloning the full lightnode monorepo took 30s+ and often timed out).
const EXAMPLES_REPO = "marinom2/lightnode-examples";
const STACKBLITZ_URL = `https://stackblitz.com/github/${EXAMPLES_REPO}/tree/main/quickstart-inference`;
const EXAMPLE_REPO_URL = `https://github.com/${EXAMPLES_REPO}/tree/main/quickstart-inference`;
const LCAI_IDE_URL = "https://github.com/lightchain-protocol/lcai-ide";

export const metadata = {
  title: "Build with LightChain AI · LightNode",
  description:
    "Run encrypted LightChain AI inference from your own dApp with lightnode-sdk. 13 read-only network methods, 3 paid-inference tiers, 5 add scaffolders, full contract addresses, non-custodial by default.",
};

// Live-verified transactions from the SDK's release run (mainnet + testnet).
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

// Three deploy targets for the runnable examples. `path` is the subdir inside
// lightnode-examples.
const FRAMEWORK_EXAMPLES = [
  {
    name: "Node CLI / script",
    blurb:
      "Standalone Node + tsx. ~30 lines using runInferenceWithKey. Auto-generates a testnet key on first run, supports `--key 0x...` to reuse one you funded earlier.",
    path: "quickstart-inference",
    badge: "starter",
  },
  {
    name: "Next.js API route",
    blurb:
      "Drop-in app/api/inference/route.ts. POST a prompt from the browser, get JSON back. Wallet stays on the server.",
    path: "nextjs-api-route",
    badge: "App Router",
  },
  {
    name: "Hono server",
    blurb:
      "Tiny standalone microservice. Same JSON contract as the Next.js variant; deploys to Bun, Cloudflare Workers, Railway, Fly, or any Node host.",
    path: "hono-server",
    badge: "any Node",
  },
] as const;

const QUICKSTART = `// 5 lines, key in, answer out. Works in Node, Next.js, anywhere.
import { runInferenceWithKey } from "lightnode-sdk";
import WS from "ws";

const { answer, txs } = await runInferenceWithKey({
  network: "testnet",                              // or "mainnet"
  privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
  prompt: "Reply with a one-sentence fun fact about the ocean.",
  WebSocket: WS,                                   // omit this line in the browser
});

console.log(answer);                               // decrypted answer
console.log(txs.createSession, txs.submitJob);     // on-chain receipts`;

// Three layers of the paid-inference API. A builder picks the highest one that
// fits their app. Lower layers exist for control, not for prestige.
const INFERENCE_TIERS = [
  {
    name: "runInferenceWithKey",
    line: "Key in, answer out.",
    body:
      "Pass a network ID, a private key, a prompt. The SDK builds the viem clients, runs the SIWE handshake, opens the encrypted session, submits, decrypts. The example in the quickstart-inference folder is this.",
    fit: "Quickest possible builder onboarding. CLI tools, demos, scripts.",
  },
  {
    name: "runInference",
    line: "Bring your own viem clients + JWT.",
    body:
      "You already wire up wagmi or a server-side viem WalletClient. Pass the gateway client (with bearer) plus the wallet and public clients. Same retry, streaming, and proof chain as the high tier.",
    fit: "Production apps with their own auth/keystore. The /playground page uses this with a Reown wallet.",
  },
  {
    name: "prepareSession + submitPrompt + decryptResponse",
    line: "Drive each step yourself.",
    body:
      "Call prepareSession to pick a worker and get a wrapped session key. Sign createSession yourself. Encrypt + upload with submitPrompt. Sign submitJob. Decrypt frames with decryptResponse. Plus the typed errors below if you want to recover differently than the default retry policy.",
    fit: "Multi-turn chat with session reuse, custom retry, batching, anything bespoke.",
  },
] as const;

// Read-only LightNode class methods. Free, no key, paste these into a dashboard
// or analytics page. Order matches lightnode-sdk's source for predictability.
const READONLY_METHODS = [
  { sig: "getWorker(address)", returns: "Worker | null", desc: "Full record for one worker (stake, status, earnings, models served). Null if the indexer has never seen it." },
  { sig: "getWorkers(first = 200)", returns: "Worker[]", desc: "Registered workers, busiest first. Default page is 200." },
  { sig: "getWorkerJobs(address, first = 20)", returns: "Job[]", desc: "Recent jobs for one worker, newest first." },
  { sig: "getModels()", returns: "ModelInfo[]", desc: "Network's registered models: name, fee, max output tokens, whitelist flags." },
  { sig: "getNetworkStats()", returns: "NetworkStats", desc: "One-shot summary: totals, active count, jobs completed, earnings, model count." },
  { sig: "getModelStats(sample = 1000)", returns: "ModelStat[]", desc: "Per-model performance over the last N jobs: completion rate, p50/p95 latency, incomplete, disputes, earnings." },
  { sig: "getNetworkAnalytics(sample = 1000)", returns: "NetworkAnalytics", desc: "Network-wide rollup across all models over the last N jobs." },
  { sig: "getWorkerStats(sample = 1000, limit = 25)", returns: "WorkerStat[]", desc: "Per-worker reliability (completion, p50/p95, incomplete) over the last N jobs. Busiest first." },
  { sig: "isRegistered(address)", returns: "boolean | null", desc: "Authoritative on-chain registration read from WorkerRegistry events. Beats the indexer when there's been a deregister + re-register cycle." },
  { sig: "getEarningsLcai(address)", returns: "number", desc: "Settled worker earnings in whole LCAI (from total_earned wei)." },
  { sig: "modelId(tag)", returns: "0x${string}", desc: "keccak256 of a model tag. Its on-chain + indexer id." },
  { sig: "estimateFee(modelTag)", returns: "number (LCAI)", desc: "On-chain inference fee for a model. What submitJob will charge." },
  { sig: "gateway({ bearer })", returns: "GatewayClient", desc: "Authenticated GatewayClient for this network. Pass your SIWE-issued JWT (or a function that produces one)." },
] as const;

const READONLY_SNIPPET = `import { LightNode } from "lightnode-sdk";

const ln = new LightNode("mainnet");          // or "testnet". Read-only. No key needed.

const top = (await ln.getWorkerStats(1000, 5)).map((w) => ({
  worker: w.address,
  completionPct: w.completionRate * 100,
  p95ms: w.p95LatencyMs,
}));

console.table(top);                           // top 5 most reliable workers, last 1000 jobs`;

// `lightnode` CLI commands. 8 read-only + 5 add subcommands. Same SDK underneath.
const CLI_READONLY = [
  { cmd: "lightnode network", desc: "Network summary JSON: totals, active workers, jobs, earnings, model count." },
  { cmd: "lightnode models", desc: "Table of registered models with fee + token limits + whitelist status." },
  { cmd: "lightnode worker 0x...", desc: "On-chain registration + 5 most recent jobs for one worker." },
  { cmd: "lightnode jobs 0x... [--csv]", desc: "Job history (100 most recent). Table or CSV." },
  { cmd: "lightnode registered 0x...", desc: "Authoritative on-chain registration check. true / false / null." },
  { cmd: "lightnode fee [model]", desc: "On-chain inference fee in LCAI. Defaults to llama3-8b." },
  { cmd: "lightnode analytics [--csv]", desc: "Per-model performance: completion, p50/p95, incomplete." },
  { cmd: "lightnode reliability [--csv]", desc: "Per-worker reliability over recent jobs." },
] as const;

const CLI_ADD = [
  { cmd: "lightnode add inference", desc: "Encrypted inference route or script. Next.js: app/api/inference/route.ts. Hono / Node: lightchain-inference.ts." },
  { cmd: "lightnode add chat", desc: "Chat UI with conversation history. Next.js: app/chat/page.tsx. Node: terminal REPL with rolling memory." },
  { cmd: "lightnode add agent", desc: "Scheduled / loop inference. Next.js: Vercel Cron route + vercel.json. Node: long-running setInterval daemon." },
  { cmd: "lightnode add analytics-dashboard", desc: "Read-only network + worker analytics page. No wallet, no fees. Next.js: SSR page; Node: CLI script." },
  { cmd: "lightnode add nft-mint-with-inference", desc: "AI-generated NFT metadata with on-chain provenance. Mint flow that anchors the answer to a content hash." },
] as const;

// Server-pays vs user-pays patterns. The architectural decision that catches
// most builders by surprise: whose wallet pays for each call?
const PAY_PATTERNS = [
  {
    icon: Server,
    name: "Server-pays",
    line: "Familiar REST shape; the user does not need a wallet.",
    desc: "You hold a hot wallet on the server, top it up, the user just hits your API. Build on runInferenceWithKey or the Next.js route in lightnode-examples. Your cost per call.",
    fits: ["Free tools", "Internal apps", "Anything the user does not have a wallet for"],
    examples: "Next.js API route, Hono server, agent / cron, NFT mint endpoint",
  },
  {
    icon: User2,
    name: "User-pays",
    line: "The user signs both txs in their browser.",
    desc: "Wire wagmi (or Reown / RainbowKit / Web3Modal) into a React page. The user connects a wallet, runs the inference, signs createSession + submitJob. The user pays. You hold no keys.",
    fits: ["dApps", "Wallet-native experiences", "Compliance-strict products"],
    examples: "lightnode.app/playground (open source, copy the source)",
  },
] as const;

const TYPED_ERRORS = [
  { name: "StalledWorkerError", when: "A worker acknowledged the job but never produced an answer.", recover: "Default retry policy assigns a different worker, up to maxRetries (2). Use isStalledWorker(e) to branch on it. The protocol times the stalled worker out and refunds the fee after the dispute window." },
  { name: "OnChainRevertError", when: "createSession or submitJob reverted on-chain (wrong network, insufficient gas, expired session).", recover: "Surfaces which tx reverted plus the tx hash so you can read the exact revert reason from the explorer." },
  { name: "RelayTokenTimeoutError", when: "The dispatcher never issued a relay-streaming token (gateway-side issue).", recover: "Almost always transient. Retry with a fresh prepareSession. Indicates the gateway, not your wallet or the worker." },
  { name: "GatewayAuthError", when: "SIWE challenge failed, verify rejected, or the JWT expired mid-flight.", recover: "Re-run the SIWE handshake. Cache the JWT in sessionStorage with the issued expiry minus a 30s safety margin to avoid this in long-lived UIs (see /playground source for the pattern)." },
] as const;

// Same protocol on both chains, different addresses + economics.
const NETWORK_TABLE = [
  { row: "Chain ID", testnet: "8200", mainnet: "9200" },
  { row: "RPC", testnet: "rpc.testnet.lightchain.ai", mainnet: "rpc.mainnet.lightchain.ai" },
  { row: "Explorer", testnet: "testnet.lightscan.app", mainnet: "mainnet.lightscan.app" },
  { row: "Faucet", testnet: "lightfaucet.ai (~2 LCAI / IP / day)", mainnet: "n/a (bridge from Ethereum)" },
  { row: "Worker min stake", testnet: "5,000 LCAI", mainnet: "50,000 LCAI" },
  { row: "Inference cost", testnet: "free (testnet LCAI)", mainnet: "about 0.022 LCAI per call" },
  { row: "Best for", testnet: "Builder testing, examples, CI", mainnet: "Real users, paid traffic, on-chain proof" },
] as const;

// Public contract addresses (no key required to read).
const CONTRACT_TABLE = [
  { name: "WorkerRegistry", testnet: "0x0000000000000000000000000000000000001002", mainnet: "0x0000000000000000000000000000000000001002", note: "Genesis predeploy. Same on every LightChain network." },
  { name: "AIConfig", testnet: "0xeCF4Ca5Ba6D97ae586993e170764a1E92231b67e", mainnet: "0x24D11533C354092ed6E18b964257819cE78Ce77D", note: "Model registry + fee config. Read calculateJobFee() to get the price." },
  { name: "JobRegistry", testnet: "0x531b3a87c5d785441b9cf55b98169f20fd9056a7", mainnet: "0xfB15F90298e4CcD7106E76fFB5e520315cC42B0b", note: "createSession + submitJob + emits SessionCreated / JobSubmitted / JobCompleted." },
] as const;

const CHANGELOG = [
  { v: "0.5.0", date: "May 2026", line: "Full SDK ecosystem release: Bridge SDK (Hyperlane Warp Route), DAO SDK (LCAIGovernor), on-chain Model Registry reader, multi-turn Conversation, worker preflight + watch, job status reader. Six new modules, all six landed in one cut." },
  { v: "0.4.9", date: "May 2026", line: "lightnode chat + lightnode wallet CLI commands. runInferenceStream (AsyncIterable<string>). Auto-resolve `ws` in Node so no WebSocket import needed." },
  { v: "0.4.8", date: "May 2026", line: "Crypto switched from Web Crypto to noble (P-256 + AES-GCM). Works in StackBlitz / Bolt WebContainer. Public type change: ECDH keys are Uint8Array, not CryptoKey." },
  { v: "0.4.7", date: "May 2026", line: "SDK_VERSION constant exported. Diagnostic crypto error so we know which platform branch broke." },
  { v: "0.4.6", date: "May 2026", line: "Webcrypto fallback via node:crypto for Node 18 + WebContainer." },
  { v: "0.4.5", date: "May 2026", line: "lightnode.app/api/gw CORS proxy. SDK auto-routes via the proxy in browser-like contexts." },
  { v: "0.4.4", date: "May 2026", line: "JobCompleted grace fix: don't drop a delivered answer when the on-chain event is slow." },
  { v: "0.4.3", date: "May 2026", line: "runInferenceWithKey: the real 5-line API. SDK builds viem + SIWE for you." },
  { v: "0.4.1", date: "May 2026", line: "lightnode add agent: scheduled / cron inference. Five `add` subcommands total." },
  { v: "0.4.0", date: "May 2026", line: "runInference orchestrator + four typed errors." },
] as const;

const PHASES = [
  { icon: Wallet2, label: "Auth", desc: "SIWE handshake yields a JWT for the consumer gateway." },
  { icon: Workflow, label: "Prepare", desc: "Worker selected. Session key wrapped with ECDH-P256." },
  { icon: ShieldCheck, label: "Sign", desc: "Your wallet signs createSession on chain." },
  { icon: Zap, label: "Submit", desc: "AES-GCM encrypted prompt uploaded. submitJob pays the fee." },
  { icon: PlayCircle, label: "Stream", desc: "Encrypted relay frames decrypted live with the session key." },
] as const;

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

// --- live data pulled server-side ----------------------------------------

interface LiveData {
  network: { workers: number; active: number; jobsCompleted: number; earningsLcai: number; modelCount: number };
  models: Array<{ name: string; feeLcai: number; maxTokens: number; live: boolean }>;
  topWorkers: Array<{ address: string; completionPct: number; p50s: number | null; jobs: number; earningsLcai: number }>;
  modelStats: Array<{ name: string; total: number; completionPct: number; p50s: number | null; p95s: number | null; incomplete: number }>;
  fetchedAt: number;
  error: string | null;
}

const NULL_LIVE: LiveData = {
  network: { workers: 0, active: 0, jobsCompleted: 0, earningsLcai: 0, modelCount: 0 },
  models: [],
  topWorkers: [],
  modelStats: [],
  fetchedAt: 0,
  error: null,
};

// Pulls a tiny live snapshot of the mainnet so the /build page can render
// real numbers next to the code that produced them. Falls back to nulls if
// any indexer/RPC query throws so the page still renders.
async function fetchLive(): Promise<LiveData> {
  try {
    const ln = new LightNode("mainnet");
    const [net, models, topWorkers, modelStats] = await Promise.all([
      ln.getNetworkStats(),
      ln.getModels(),
      ln.getWorkerStats(500, 5),
      ln.getModelStats(500),
    ]);
    return {
      network: {
        workers: net.total,
        active: net.active,
        jobsCompleted: net.jobsCompleted,
        earningsLcai: net.totalEarnedLcai,
        modelCount: net.models,
      },
      models: models.slice(0, 6).map((m) => ({
        name: m.name,
        feeLcai: Number(BigInt(m.fee ?? "0")) / 1e18,
        maxTokens: m.max_output_tokens,
        live: !!(m.is_whitelisted && m.is_enabled),
      })),
      topWorkers: topWorkers.map((w) => ({
        address: w.address,
        completionPct: Math.round((w.completionRate ?? 0) * 100),
        p50s: w.p50,
        jobs: w.total,
        earningsLcai: w.earnings,
      })),
      modelStats: modelStats.slice(0, 5).map((s) => ({
        name: s.name,
        total: s.total,
        completionPct: Math.round((s.completionRate ?? 0) * 100),
        p50s: s.p50,
        p95s: s.p95,
        incomplete: s.incomplete,
      })),
      fetchedAt: Date.now(),
      error: null,
    };
  } catch (e) {
    return { ...NULL_LIVE, error: (e as Error).message };
  }
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function CodeBox({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-[11px] leading-relaxed text-content-default">
      <code>{children}</code>
    </pre>
  );
}

function LiveDemoCard({
  icon: Icon,
  title,
  desc,
  snippet,
  children,
}: {
  icon: typeof Boxes;
  title: string;
  desc: string;
  snippet: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <span className="text-sm font-semibold text-content-primary">{title}</span>
        <Badge tone="success" className="ml-auto">live · mainnet</Badge>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-content-soft">{desc}</p>
      <CodeBox>{snippet}</CodeBox>
      <div className="mt-3 rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-content-soft">
          <Activity className="size-3 text-success" /> what that call returns right now
        </div>
        {children}
      </div>
    </Card>
  );
}

// The SDK ecosystem we ship today. All six landed in 0.5.0.
const ROADMAP = [
  {
    title: "Bridge SDK",
    blurb:
      "Typed wrapper around the LightChain bridge (Hyperlane Warp Route). new Bridge(client).transfer({ from: 'ethereum', to: 'lightchain-mainnet', amount, recipient, fee }). Bake-in mainnet route + bytes32 padding helper + ERC-20 approve. Reverses too (LightChain to Ethereum, attaches LCAI as native value).",
    badge: "shipped",
  },
  {
    title: "Multi-turn Conversation",
    blurb:
      "new Conversation({ network, privateKey }).send('hi') keeps history client-side and runs one full encrypted inference per turn. Optional system prompt + maxHistoryTurns cap. Works regardless of whether the protocol supports session reuse.",
    badge: "shipped",
  },
  {
    title: "Dispute / refund queries",
    blurb:
      "ln.getJobStatus(jobId) classifies the job (submitted / in-flight / completed / stalled / disputed / resolved) and exposes a refundable flag so a dApp can know when to claim. lightnode job <id> from the CLI returns the same JSON.",
    badge: "shipped",
  },
  {
    title: "DAO SDK (LCAIGovernor)",
    blurb:
      "new DAO(client, 'ethereum').proposal(id) / castVote / propose / queue / execute against the OZ Governor v5 LCAIGovernor on Ethereum. Plus dao.config() returns voting delay/period/threshold live, and PROPOSAL_STATE_LABEL maps the 8-state enum.",
    badge: "shipped",
  },
  {
    title: "Worker preflight + watch",
    blurb:
      "workerPreflight({ network, privateKey }) submits one real test inference and returns verdict (ok / over-deadline / stalled / failed). workerWatch(ln, addr) yields an async-iterable of state-change events (registered / went-stale / jobs-completed / earnings-up). lightnode worker preflight + lightnode worker watch.",
    badge: "shipped",
  },
  {
    title: "On-chain model registry reader",
    blurb:
      "new OnchainModelRegistry({ publicClient, registry, benchmarks }).getBaseModelIds / getVariant / getAccessPolicy / getVariantsForBaseModel. Full ABI for AIVMModelRegistry + BenchmarkRegistry; bring your own deployed address (no official public address yet).",
    badge: "shipped",
  },
] as const;

function SectionHeader({
  icon: Icon,
  title,
  blurb,
}: {
  icon: typeof Boxes;
  title: string;
  blurb: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <IconChip icon={Icon} size="md" />
      <div>
        <h2 className="text-base font-semibold tracking-tight text-content-primary">{title}</h2>
        <p className="text-xs text-content-soft">{blurb}</p>
      </div>
    </div>
  );
}

export default async function BuildPage() {
  const live = await fetchLive();
  const fmt = new Intl.NumberFormat("en-US");
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <div className="mb-10">
        <Badge tone="brand" className="mb-4">
          For builders
        </Badge>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-content-primary sm:text-5xl">
          Build with <span className="text-gradient">LightChain AI</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-content-soft">
          Run encrypted inference from your own app with{" "}
          <code className="rounded bg-surface-base-faint px-1.5 py-0.5 font-mono text-base text-content-primary">
            lightnode-sdk
          </code>
          . Non-custodial. Your wallet signs on-chain, the SDK does the rest. About 0.022 LCAI per call on mainnet,
          free on testnet, ECDH-P256 + AES-256-GCM end to end. Plus a read-only client for network analytics and a
          5-template scaffolder for new and existing projects.
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
          blurb="Pick one. Same flow, three runtimes. Browser wallet, cloud IDE, or your laptop."
        />
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
              <Badge tone="brand" className="ml-auto">about 5 sec</Badge>
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
              <Badge tone="muted" className="ml-auto">git clone</Badge>
            </div>
            <p className="mb-4 flex-1 text-xs leading-relaxed text-content-soft">
              Clone{" "}
              <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-[11px]">
                marinom2/lightnode-examples
              </code>
              , <code className="font-mono">cd quickstart-inference</code>,{" "}
              <code className="font-mono">npm i</code>, <code className="font-mono">npm start</code>. First run prints
              the funded address + faucet URL. .env persists across runs.
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
      <Card className="mb-10 p-6">
        <SectionHeader
          icon={TerminalSquare}
          title="Install"
          blurb="One package, one peer dep. ESM, Node 18+, browser-compatible. Pure-JS crypto (noble), runs anywhere."
        />
        <pre className="overflow-x-auto rounded-xl border border-bdr-soft bg-[#0b0b14] p-4 font-mono text-sm leading-relaxed text-content-default">
          <code>npm install lightnode-sdk viem ws</code>
        </pre>
        <p className="mt-3 text-xs text-content-soft">
          <code className="font-mono text-content-default">ws</code> is only required in Node. In the browser the SDK
          uses the global <code className="font-mono text-content-default">WebSocket</code>.
        </p>
      </Card>

      <Card className="mb-12 p-6">
        <SectionHeader
          icon={Code2}
          title="Quickstart"
          blurb="One encrypted inference end to end. Real code, runs as-is."
        />
        <pre className="overflow-x-auto rounded-xl border border-bdr-soft bg-[#0b0b14] p-4 font-mono text-[12px] leading-relaxed text-content-default">
          <code>{QUICKSTART}</code>
        </pre>
      </Card>

      {/* ── SCAFFOLDERS ──────────────────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Zap}
          title="One command, you're integrated"
          blurb="Brand-new project? Use the create scaffolder. Existing project? Use add. It auto-detects Next.js, Hono, and Node."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-content-primary">Brand-new project</span>
              <Badge tone="success" className="ml-auto">about 30 sec</Badge>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-xs leading-relaxed text-content-default">
              <code>npm create lightnode-app my-app</code>
            </pre>
            <p className="mt-3 text-xs leading-relaxed text-content-soft">
              Three templates (Node CLI, Next.js app, Hono server). Same shape as{" "}
              <code className="font-mono">create-next-app</code>.
            </p>
          </Card>
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-content-primary">Existing project</span>
              <Badge tone="brand" className="ml-auto">in place</Badge>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-xs leading-relaxed text-content-default">
              <code>npx lightnode add inference</code>
            </pre>
            <p className="mt-3 text-xs leading-relaxed text-content-soft">
              Five add commands total (catalog below). Detects your framework, writes the right files, never overwrites
              without <code className="font-mono">--force</code>.
            </p>
          </Card>
        </div>
      </div>

      {/* ── API TIERS (paid inference) ───────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Layers}
          title="Three API tiers for paid inference"
          blurb="Pick the highest one that fits. Lower tiers exist for control, not for prestige."
        />
        <div className="grid gap-3 md:grid-cols-3">
          {INFERENCE_TIERS.map((tier) => (
            <Card key={tier.name} className="flex flex-col p-5">
              <code className="mb-1 break-all font-mono text-sm font-semibold text-content-primary">{tier.name}</code>
              <span className="mb-3 text-xs font-medium text-primary">{tier.line}</span>
              <p className="mb-3 flex-1 text-xs leading-relaxed text-content-soft">{tier.body}</p>
              <div className="rounded-lg border border-bdr-soft bg-surface-base-faint p-2.5">
                <span className="text-[10px] uppercase tracking-wide text-content-soft">Fits</span>
                <p className="mt-0.5 text-xs text-content-default">{tier.fit}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* ── SERVER-PAYS vs USER-PAYS ─────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Wallet2}
          title="Whose wallet pays for each call?"
          blurb="The architectural choice that catches builders by surprise. Both patterns use the same SDK."
        />
        <div className="grid gap-3 md:grid-cols-2">
          {PAY_PATTERNS.map((p) => (
            <Card key={p.name} className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <p.icon className="size-5 text-primary" />
                <span className="text-sm font-semibold text-content-primary">{p.name}</span>
              </div>
              <span className="mb-2 block text-xs font-medium text-primary">{p.line}</span>
              <p className="mb-3 text-xs leading-relaxed text-content-soft">{p.desc}</p>
              <div className="mb-2 rounded-lg border border-bdr-soft bg-surface-base-faint p-2.5">
                <span className="text-[10px] uppercase tracking-wide text-content-soft">Fits</span>
                <ul className="mt-1 space-y-0.5 text-xs text-content-default">
                  {p.fits.map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
              </div>
              <p className="text-[11px] text-content-soft">
                <span className="font-medium text-content-default">Examples:</span> {p.examples}
              </p>
            </Card>
          ))}
        </div>
      </div>

      {/* ── READ-ONLY CLIENT ─────────────────────────────────────────── */}
      <Card className="mb-12 p-6">
        <SectionHeader
          icon={Database}
          title="Read-only client (free, no key required)"
          blurb="All the chain + indexer data. Use for dashboards, leaderboards, eligibility checks, gating. No fees, no wallet."
        />
        <pre className="mb-5 overflow-x-auto rounded-xl border border-bdr-soft bg-[#0b0b14] p-4 font-mono text-[12px] leading-relaxed text-content-default">
          <code>{READONLY_SNIPPET}</code>
        </pre>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-bdr-soft text-content-soft">
                <th className="py-2 pr-3 font-medium">Method</th>
                <th className="py-2 pr-3 font-medium">Returns</th>
                <th className="py-2 font-medium">What it gives you</th>
              </tr>
            </thead>
            <tbody>
              {READONLY_METHODS.map((m) => (
                <tr key={m.sig} className="border-b border-bdr-soft/60 align-top last:border-0">
                  <td className="py-2 pr-3">
                    <code className="break-all font-mono text-content-default">{m.sig}</code>
                  </td>
                  <td className="py-2 pr-3">
                    <code className="break-all font-mono text-content-soft">{m.returns}</code>
                  </td>
                  <td className="py-2 leading-relaxed text-content-soft">{m.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[11px] text-content-soft">
          Also exported: <code className="font-mono">modelStatsCsv</code>, <code className="font-mono">workerStatsCsv</code>, and{" "}
          <code className="font-mono">workerJobsCsv</code> for CSV exports. Plus the raw aggregators (
          <code className="font-mono">aggregateModelStats</code>, <code className="font-mono">aggregateWorkerStats</code>,{" "}
          <code className="font-mono">networkAnalytics</code>) if you want to build your own.
        </p>
      </Card>

      {/* ── LIVE DEMO PANEL ──────────────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Activity}
          title="Try it live (no install, no key)"
          blurb="Real mainnet data, refreshed about once a minute. Each card shows the SDK call that produced it - copy and run."
        />
        {live.error ? (
          <Card className="p-5">
            <p className="text-xs text-content-soft">
              Couldn&apos;t reach the indexer right now. The SDK calls work regardless - try them locally.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <LiveDemoCard
              icon={Globe}
              title="Network at a glance"
              desc="One call that summarizes the entire mainnet: workers, jobs completed, total earnings, model count."
              snippet={`const ln = new LightNode("mainnet");
const stats = await ln.getNetworkStats();`}
            >
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-content-soft">workers (active / total)</span>
                <span className="text-right font-mono text-content-default">{fmt.format(live.network.active)} / {fmt.format(live.network.workers)}</span>
                <span className="text-content-soft">jobs completed</span>
                <span className="text-right font-mono text-content-default">{fmt.format(live.network.jobsCompleted)}</span>
                <span className="text-content-soft">total earnings</span>
                <span className="text-right font-mono text-content-default">{live.network.earningsLcai.toFixed(2)} LCAI</span>
                <span className="text-content-soft">registered models</span>
                <span className="text-right font-mono text-content-default">{fmt.format(live.network.modelCount)}</span>
              </div>
            </LiveDemoCard>

            <LiveDemoCard
              icon={Database}
              title="Top workers by reliability"
              desc="Per-worker completion + p50 latency over the last 500 jobs. Use it to score worker selection in your dApp."
              snippet={`const workers = await ln.getWorkerStats(500, 5);`}
            >
              {live.topWorkers.length === 0 ? (
                <p className="text-xs text-content-soft">(no workers in the sample)</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-content-soft">
                    <tr>
                      <th className="pb-1 text-left font-medium">worker</th>
                      <th className="pb-1 text-right font-medium">jobs</th>
                      <th className="pb-1 text-right font-medium">complete</th>
                      <th className="pb-1 text-right font-medium">p50</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.topWorkers.map((w) => (
                      <tr key={w.address} className="border-t border-bdr-soft/40">
                        <td className="py-1 font-mono text-content-default">{shortAddr(w.address)}</td>
                        <td className="py-1 text-right font-mono text-content-soft">{w.jobs}</td>
                        <td className="py-1 text-right font-mono text-content-soft">{w.completionPct}%</td>
                        <td className="py-1 text-right font-mono text-content-soft">{w.p50s != null ? `${w.p50s}s` : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </LiveDemoCard>

            <LiveDemoCard
              icon={Boxes}
              title="Registered models"
              desc="Live model whitelist with on-chain fee + max output tokens. Drives a model picker in any builder UI."
              snippet={`const models = await ln.getModels();`}
            >
              {live.models.length === 0 ? (
                <p className="text-xs text-content-soft">(no models found)</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-content-soft">
                    <tr>
                      <th className="pb-1 text-left font-medium">model</th>
                      <th className="pb-1 text-right font-medium">fee</th>
                      <th className="pb-1 text-right font-medium">max out</th>
                      <th className="pb-1 text-right font-medium">live</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.models.map((m) => (
                      <tr key={m.name} className="border-t border-bdr-soft/40">
                        <td className="py-1 font-mono text-content-default">{m.name}</td>
                        <td className="py-1 text-right font-mono text-content-soft">{m.feeLcai.toFixed(3)}</td>
                        <td className="py-1 text-right font-mono text-content-soft">{fmt.format(m.maxTokens)}</td>
                        <td className="py-1 text-right">{m.live ? <Badge tone="success">yes</Badge> : <Badge tone="muted">off</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </LiveDemoCard>

            <LiveDemoCard
              icon={Gauge}
              title="Per-model performance"
              desc="Completion rate, p50 / p95 latency, incomplete count over the last 500 jobs. Builds the analytics tab of any dApp."
              snippet={`const stats = await ln.getModelStats(500);`}
            >
              {live.modelStats.length === 0 ? (
                <p className="text-xs text-content-soft">(no stats yet)</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-content-soft">
                    <tr>
                      <th className="pb-1 text-left font-medium">model</th>
                      <th className="pb-1 text-right font-medium">jobs</th>
                      <th className="pb-1 text-right font-medium">complete</th>
                      <th className="pb-1 text-right font-medium">p50 / p95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.modelStats.map((m) => (
                      <tr key={m.name} className="border-t border-bdr-soft/40">
                        <td className="py-1 font-mono text-content-default">{m.name}</td>
                        <td className="py-1 text-right font-mono text-content-soft">{m.total}</td>
                        <td className="py-1 text-right font-mono text-content-soft">{m.completionPct}%</td>
                        <td className="py-1 text-right font-mono text-content-soft">{m.p50s != null ? `${m.p50s}s` : "-"} / {m.p95s != null ? `${m.p95s}s` : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </LiveDemoCard>
          </div>
        )}
        <p className="mt-3 text-[11px] text-content-soft">
          Each panel is one SDK call. Paste the snippet into any Node, Next.js, or browser project and you get the same
          shape. Data refreshes about once a minute via ISR. Or run from your terminal: {""}
          <code className="font-mono text-content-default">lightnode network</code>,{" "}
          <code className="font-mono text-content-default">lightnode reliability</code>,{" "}
          <code className="font-mono text-content-default">lightnode models</code>,{" "}
          <code className="font-mono text-content-default">lightnode analytics</code>.
        </p>
      </div>

      {/* ── CLI CATALOG ──────────────────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={TerminalSquare}
          title="lightnode CLI"
          blurb="Bundled in lightnode-sdk. Run any of the read-only commands below right here in the browser. Five add scaffolders work from your project's terminal."
        />

        {/* INTERACTIVE: click a command on the left, hit Run, see real JSON. */}
        <div className="mb-3">
          <CliRunner />
        </div>

        {/* Static catalog of `add` scaffolders, since those write into a
            user project on disk and can't be run from the browser. */}
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              <span className="text-sm font-semibold text-content-primary">add (writes files in your project)</span>
            </div>
            <ul className="space-y-2 text-xs">
              {CLI_ADD.map((c) => (
                <li key={c.cmd}>
                  <code className="block break-all font-mono text-content-default">{c.cmd}</code>
                  <span className="text-content-soft">{c.desc}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-content-soft">
              All add commands accept <code className="font-mono">--template auto|nextjs-api|hono|node</code>,{" "}
              <code className="font-mono">--net testnet|mainnet</code>, and <code className="font-mono">--force</code>.
            </p>
          </Card>
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <Wallet2 className="size-4 text-primary" />
              <span className="text-sm font-semibold text-content-primary">Run inferences + manage wallets (need PRIVATE_KEY)</span>
            </div>
            <ul className="space-y-2 text-xs">
              <li>
                <code className="block break-all font-mono text-content-default">lightnode chat &lt;prompt&gt;</code>
                <span className="text-content-soft">One-shot encrypted inference. Streams answer to stdout, JSON receipt to stderr. Supports stdin too.</span>
              </li>
              <li>
                <code className="block break-all font-mono text-content-default">lightnode wallet new|address|balance</code>
                <span className="text-content-soft">Generate a key, read the address of your env key, check balance on mainnet/testnet.</span>
              </li>
              <li>
                <code className="block break-all font-mono text-content-default">lightnode worker preflight</code>
                <span className="text-content-soft">Submits ONE real test inference and prints a verdict. Useful as a CI gate.</span>
              </li>
              <li>
                <code className="block break-all font-mono text-content-default">lightnode worker watch &lt;addr&gt;</code>
                <span className="text-content-soft">Polls a worker, emits JSON line on state change (no key required).</span>
              </li>
              <li>
                <code className="block break-all font-mono text-content-default">lightnode bridge addresses</code>
                <span className="text-content-soft">Print the LCAI bridge route (Ethereum &lt;-&gt; LightChain).</span>
              </li>
              <li>
                <code className="block break-all font-mono text-content-default">lightnode dao addresses|config</code>
                <span className="text-content-soft">LCAI Governor addresses + live voting delay/period/threshold.</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>

      {/* ── TYPED ERRORS ─────────────────────────────────────────────── */}
      <Card className="mb-12 p-6">
        <SectionHeader
          icon={AlertOctagon}
          title="Typed errors and recovery"
          blurb="The SDK does not wrap everything in a generic catch. Four named errors so a builder can branch on them."
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-bdr-soft text-content-soft">
                <th className="py-2 pr-3 font-medium">Error</th>
                <th className="py-2 pr-3 font-medium">When it fires</th>
                <th className="py-2 font-medium">How to recover</th>
              </tr>
            </thead>
            <tbody>
              {TYPED_ERRORS.map((e) => (
                <tr key={e.name} className="border-b border-bdr-soft/60 align-top last:border-0">
                  <td className="py-2 pr-3">
                    <code className="font-mono text-content-default">{e.name}</code>
                  </td>
                  <td className="py-2 pr-3 leading-relaxed text-content-soft">{e.when}</td>
                  <td className="py-2 leading-relaxed text-content-soft">{e.recover}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-content-soft">
          Plus <code className="font-mono">isStalledWorker(e)</code> as a type guard so a TS narrowing branch lights up
          without an instanceof check.
        </p>
      </Card>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
      <Card className="mb-12 p-6">
        <SectionHeader
          icon={Workflow}
          title="How it works under the hood"
          blurb="Five stages. The SDK handles the protocol, your wallet signs the on-chain bits."
        />
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

      {/* ── NON-CUSTODIAL ───────────────────────────────────────────── */}
      <Card className="mb-12 p-6">
        <SectionHeader
          icon={Lock}
          title="Non-custodial by default"
          blurb="The SDK never holds your key. Here is exactly what touches what."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-4">
            <div className="mb-2 flex items-center gap-2">
              <KeyRound className="size-4 text-primary" />
              <span className="text-sm font-semibold text-content-primary">What the SDK sees</span>
            </div>
            <ul className="space-y-1.5 text-xs leading-relaxed text-content-soft">
              <li>· Your plaintext prompt (encrypted before it leaves the process).</li>
              <li>· Public viem client addresses, RPC URL, the gateway URL.</li>
              <li>· The session key (ephemeral, 32 bytes, never persisted).</li>
              <li>· The decrypted answer.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-4">
            <div className="mb-2 flex items-center gap-2">
              <ShieldCheck className="size-4 text-success" />
              <span className="text-sm font-semibold text-content-primary">What only your wallet sees</span>
            </div>
            <ul className="space-y-1.5 text-xs leading-relaxed text-content-soft">
              <li>· Your private key. The SDK never receives it.</li>
              <li>· The createSession + submitJob transactions, signed via viem.</li>
              <li>· The SIWE challenge signature.</li>
            </ul>
          </div>
        </div>
        <p className="mt-4 text-xs text-content-soft">
          End-to-end encryption: prompt is encrypted to the worker&apos;s ECDH pubkey before it leaves your process. The
          gateway, the relay, and any third party in the path see only ciphertext. The session key never goes on chain.
        </p>
      </Card>

      {/* ── NETWORK COMPARISON ───────────────────────────────────────── */}
      <Card className="mb-12 p-6">
        <SectionHeader
          icon={Globe}
          title="Testnet vs mainnet"
          blurb="Same protocol, different chain IDs and addresses. Build on testnet, ship on mainnet."
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-bdr-soft text-content-soft">
                <th className="py-2 pr-3 font-medium"></th>
                <th className="py-2 pr-3 font-medium">
                  <Badge tone="brand">testnet</Badge>
                </th>
                <th className="py-2 font-medium">
                  <Badge tone="success">mainnet</Badge>
                </th>
              </tr>
            </thead>
            <tbody>
              {NETWORK_TABLE.map((row) => (
                <tr key={row.row} className="border-b border-bdr-soft/60 align-top last:border-0">
                  <td className="py-2 pr-3 font-medium text-content-default">{row.row}</td>
                  <td className="py-2 pr-3 text-content-soft">{row.testnet}</td>
                  <td className="py-2 text-content-soft">{row.mainnet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── CONTRACTS ────────────────────────────────────────────────── */}
      <Card className="mb-12 p-6">
        <SectionHeader
          icon={Gauge}
          title="Contract addresses"
          blurb="The SDK exposes these via NETWORKS and ln.network.*. Useful for custom integrations beyond the SDK."
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-bdr-soft text-content-soft">
                <th className="py-2 pr-3 font-medium">Contract</th>
                <th className="py-2 pr-3 font-medium">Testnet (chain 8200)</th>
                <th className="py-2 pr-3 font-medium">Mainnet (chain 9200)</th>
                <th className="py-2 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {CONTRACT_TABLE.map((c) => (
                <tr key={c.name} className="border-b border-bdr-soft/60 align-top last:border-0">
                  <td className="py-2 pr-3 font-medium text-content-default">{c.name}</td>
                  <td className="py-2 pr-3">
                    <a
                      href={`https://testnet.lightscan.app/address/${c.testnet}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all font-mono text-primary hover:underline"
                    >
                      {c.testnet}
                    </a>
                  </td>
                  <td className="py-2 pr-3">
                    <a
                      href={`https://mainnet.lightscan.app/address/${c.mainnet}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all font-mono text-primary hover:underline"
                    >
                      {c.mainnet}
                    </a>
                  </td>
                  <td className="py-2 leading-relaxed text-content-soft">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-content-soft">
          <code className="font-mono text-content-default">ln.network.jobRegistry</code>,{" "}
          <code className="font-mono text-content-default">ln.network.aiConfig</code>,{" "}
          <code className="font-mono text-content-default">ln.network.workerRegistry</code> on a{" "}
          <code className="font-mono">LightNode</code> instance return the values above for the active network. Also{" "}
          <code className="font-mono">ln.network.rpc</code>, <code className="font-mono">ln.network.explorer</code>,{" "}
          <code className="font-mono">ln.network.chainId</code>.
        </p>
      </Card>

      {/* ── LIVE-VERIFIED ────────────────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Rocket}
          title="Live-verified end to end"
          blurb="The SDK is tested with real LCAI before each release. The on-chain transactions below ran the same code path you would call."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <TxRow net="mainnet" data={VERIFIED.mainnet} />
          <TxRow net="testnet" data={VERIFIED.testnet} />
        </div>
      </div>

      {/* ── FRAMEWORK EXAMPLES ───────────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Workflow}
          title="In your stack"
          blurb="Three drop-in shapes. Pick the one closest to your project."
        />
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
                    href={`https://github.com/${EXAMPLES_REPO}/tree/main/${ex.path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Github /> View source <ExternalLink />
                  </a>
                </Button>
                <Button asChild size="sm" className="w-full">
                  <a
                    href={`https://stackblitz.com/github/${EXAMPLES_REPO}/tree/main/${ex.path}`}
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

      {/* ── ECOSYSTEM SDKs ───────────────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Rocket}
          title="SDK ecosystem - all six shipped"
          blurb="LightChain's own docs list SDKs as 'soon'. lightnode-sdk fills the gap. Each card is a real module exported in 0.5.0."
        />
        <div className="grid gap-3 md:grid-cols-2">
          {ROADMAP.map((r) => (
            <Card key={r.title} className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-content-primary">{r.title}</span>
                <Badge tone="success" className="ml-auto">
                  {r.badge}
                </Badge>
              </div>
              <p className="text-xs leading-relaxed text-content-soft">{r.blurb}</p>
            </Card>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-content-soft">
          Independent, community-built. Not affiliated with LightChain. If you want a new surface filled, {" "}
          <a
            href="https://github.com/marinom2/lightnode/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            open an issue
          </a>
          .
        </p>
      </div>

      {/* ── CHANGELOG ────────────────────────────────────────────────── */}
      <Card className="mb-12 p-6">
        <SectionHeader
          icon={FileText}
          title="Recent SDK versions"
          blurb="The project ships regularly. Pinned dependency ranges in the examples pull the latest patch by default."
        />
        <ul className="space-y-2.5">
          {CHANGELOG.map((c) => (
            <li key={c.v} className="flex items-start gap-3 rounded-xl border border-bdr-soft bg-surface-base-faint px-4 py-3">
              <Badge tone="brand">{c.v}</Badge>
              <div className="flex-1">
                <span className="text-[11px] uppercase tracking-wide text-content-soft">{c.date}</span>
                <p className="mt-0.5 text-xs leading-relaxed text-content-default">{c.line}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* ── BROWSER + LCAI-IDE PROMO (existing) ──────────────────────── */}
      <Card className="mb-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconChip icon={PlayCircle} size="md" />
            <div>
              <h2 className="text-base font-semibold tracking-tight text-content-primary">Try it in your browser</h2>
              <p className="text-xs text-content-soft">
                Free testnet LCAI, no install. Connect a wallet and run one real inference end to end.
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
                LightChain&apos;s Remix-fork IDE loads the JobRegistry / AIConfig contracts, decodes tx payloads, and lets
                you write custom callers in Solidity. Useful if you are building a contract that talks to the protocol,
                not just an app that uses it.
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
