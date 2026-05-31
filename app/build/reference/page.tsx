import Link from "next/link";
import { Code2, Database, ExternalLink, FileText, Gauge, Github, Globe, KeyRound, Lock, ShieldCheck, Workflow } from "lucide-react";
import { NETWORKS } from "lightnode-sdk";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/build/section-header";
import { BuildTabs } from "@/components/build/build-tabs";

export const metadata = {
  title: "Reference - Build with LightChain AI",
  description:
    "Read-only LightNode methods, networks (testnet vs mainnet), official contract addresses, recent SDK versions, security model, framework examples, Python port, lcai-ide.",
};

const READONLY_METHODS = [
  { sig: "getWorker(address)", returns: "Worker | null", desc: "Full record for one worker (stake, status, earnings, models served)." },
  { sig: "getWorkers(first = 200)", returns: "Worker[]", desc: "Registered workers, busiest first." },
  { sig: "getWorkerJobs(address, first = 20)", returns: "Job[]", desc: "Recent jobs for one worker, newest first." },
  { sig: "getModels()", returns: "ModelInfo[]", desc: "Network's registered models: name, fee, max output tokens, whitelist flags." },
  { sig: "getNetworkStats()", returns: "NetworkStats", desc: "One-shot summary: totals, active count, jobs completed, earnings, model count." },
  { sig: "getModelStats(sample = 1000)", returns: "ModelStat[]", desc: "Per-model performance over the last N jobs: completion, p50/p95, incomplete, disputes, earnings." },
  { sig: "getNetworkAnalytics(sample = 1000)", returns: "NetworkAnalytics", desc: "Network-wide rollup across all models over the last N jobs." },
  { sig: "getWorkerStats(sample = 1000, limit = 25)", returns: "WorkerStat[]", desc: "Per-worker reliability over the last N jobs. Busiest first." },
  { sig: "isRegistered(address)", returns: "boolean | null", desc: "Authoritative on-chain registration. Beats the indexer on deregister + re-register cycles." },
  { sig: "getEarningsLcai(address)", returns: "number", desc: "Settled worker earnings in whole LCAI." },
  { sig: "modelId(tag)", returns: "0x${string}", desc: "keccak256 of a model tag. Its on-chain + indexer id." },
  { sig: "estimateFee(modelTag)", returns: "number (LCAI)", desc: "On-chain inference fee. What submitJob will charge." },
  { sig: "gateway({ bearer })", returns: "GatewayClient", desc: "Authenticated GatewayClient for this network." },
  { sig: "getJobStatus(jobId)", returns: "JobStatus | null", desc: "Job category (completed / stalled / disputed / ...) + refundable flag." },
] as const;

const READONLY_SNIPPET = `import { LightNode } from "lightnode-sdk";

const ln = new LightNode("mainnet");

const top = (await ln.getWorkerStats(1000, 5)).map((w) => ({
  worker: w.address,
  completionPct: w.completionRate * 100,
  p95ms: w.p95LatencyMs,
}));

console.table(top);`;

const NETWORK_TABLE = [
  { row: "Chain ID", testnet: "8200", mainnet: "9200" },
  { row: "RPC", testnet: "rpc.testnet.lightchain.ai", mainnet: "rpc.mainnet.lightchain.ai" },
  { row: "Explorer", testnet: "testnet.lightscan.app", mainnet: "mainnet.lightscan.app" },
  { row: "Faucet", testnet: "lightfaucet.ai (~2 LCAI / IP / day)", mainnet: "n/a (bridge from Ethereum)" },
  { row: "Worker min stake", testnet: "5,000 LCAI", mainnet: "50,000 LCAI" },
  { row: "Inference cost", testnet: "free (testnet LCAI)", mainnet: "about 0.022 LCAI per call" },
  { row: "Best for", testnet: "Builder testing, examples, CI", mainnet: "Real users, paid traffic, on-chain proof" },
] as const;

const CONTRACT_KEYS = [
  { key: "workerRegistry" as const, label: "WorkerRegistry", note: "Genesis predeploy. Worker stake + ECDH key + supported models." },
  { key: "feePool" as const, label: "FeePool", note: "Genesis predeploy. Where per-job fees accumulate before payout." },
  { key: "nativeVotes" as const, label: "NativeVotes", note: "Genesis predeploy. Voting weight backing LightChainGovernor (no wrapping)." },
  { key: "aiConfig" as const, label: "AIConfig (proxy)", note: "Model whitelist + per-job fee + max output tokens. The model registry." },
  { key: "jobRegistry" as const, label: "JobRegistry (proxy)", note: "createSession + submitJob + emits SessionCreated / JobSubmitted / JobCompleted." },
  { key: "treasury" as const, label: "Treasury (proxy)", note: "DAO-controlled treasury holding protocol funds." },
  { key: "governor" as const, label: "LightChainGovernor (proxy)", note: "On-chain DAO. Read + vote at dao.lightchain.ai. NativeVotes-backed." },
  { key: "timelock" as const, label: "TimelockController", note: "Holds queue/execute delay for the LightChainGovernor." },
];
const CONTRACT_TABLE = CONTRACT_KEYS.map((c) => ({
  name: c.label,
  testnet: (NETWORKS.testnet as unknown as Record<string, string | undefined>)[c.key] ?? "",
  mainnet: (NETWORKS.mainnet as unknown as Record<string, string | undefined>)[c.key] ?? "",
  note: c.note,
}));

const FRAMEWORK_EXAMPLES = [
  {
    name: "Node CLI / script",
    blurb: "Standalone Node + tsx. ~30 lines using runInferenceWithKey.",
    path: "quickstart-inference",
  },
  {
    name: "Next.js API route",
    blurb: "Drop-in app/api/inference/route.ts. POST a prompt, get JSON back.",
    path: "nextjs-api-route",
  },
  {
    name: "Hono server",
    blurb: "Tiny standalone microservice. Deploys to Bun, Cloudflare Workers, Railway, Fly, any Node host.",
    path: "hono-server",
  },
] as const;

const EXAMPLES_REPO = "marinom2/lightnode-examples";

const CHANGELOG = [
  { v: "0.6.0", date: "May 2026", line: "runInferenceBatch (parallel inference with capped concurrency + per-slot errors). Agent class (ReAct-style tool calling, works on llama3-8b). AbortSignal support across runInference / runInferenceWithKey for cancellable UI flows." },
  { v: "0.5.1", date: "May 2026", line: "DAO covers both governors (Ethereum LCAIGovernor + LightChain LightChainGovernor with NativeVotes). All contract addresses now derived from NETWORKS. dao config CLI gets a friendlier RPC fallback." },
  { v: "0.5.0", date: "May 2026", line: "Full SDK ecosystem release: Bridge SDK, DAO SDK, on-chain Model Registry reader, multi-turn Conversation, worker preflight + watch, job status reader." },
  { v: "0.4.9", date: "May 2026", line: "lightnode chat + lightnode wallet CLI commands. runInferenceStream (AsyncIterable<string>). Auto-resolve `ws` in Node so no WebSocket import needed." },
  { v: "0.4.8", date: "May 2026", line: "Crypto switched from Web Crypto to noble (P-256 + AES-GCM). Works in StackBlitz / Bolt WebContainer." },
  { v: "0.4.5", date: "May 2026", line: "lightnode.app/api/gw CORS proxy. SDK auto-routes via the proxy in browser-like contexts." },
  { v: "0.4.4", date: "May 2026", line: "JobCompleted grace fix: don't drop a delivered answer when the on-chain event is slow." },
  { v: "0.4.3", date: "May 2026", line: "runInferenceWithKey: the real 5-line API. SDK builds viem + SIWE for you." },
  { v: "0.4.0", date: "May 2026", line: "runInference orchestrator + four typed errors." },
] as const;

const LCAI_IDE_URL = "https://github.com/lightchain-protocol/lcai-ide";

export default function BuildReferencePage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <BuildTabs />

      <div className="mb-8">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-content-primary sm:text-4xl">
          Reference
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-content-soft">
          Methods, networks, contract addresses, changelog, security model, ports.
        </p>
      </div>

      {/* ── READ-ONLY CLIENT ─────────────────────────────────────────── */}
      <Card className="mb-12 p-6">
        <SectionHeader
          icon={Database}
          title="Read-only LightNode methods"
          blurb="Free, no key. Dashboards, leaderboards, eligibility checks, gating."
        />
        <pre className="mb-5 overflow-x-auto rounded-xl border border-bdr-soft code-surface p-4 font-mono text-[12px] leading-relaxed text-content-default">
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
      </Card>

      {/* ── NETWORKS ─────────────────────────────────────────────────── */}
      <Card className="mb-12 p-6">
        <SectionHeader
          icon={Globe}
          title="Testnet vs mainnet"
          blurb="Same protocol, different chain IDs and addresses."
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
          blurb="Sourced from NETWORKS in lightnode-sdk. Edit the SDK, this page picks it up."
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
                    {c.testnet ? (
                      <a
                        href={`https://testnet.lightscan.app/address/${c.testnet}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all font-mono text-primary hover:underline"
                      >
                        {c.testnet}
                      </a>
                    ) : (
                      <span className="text-content-soft">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {c.mainnet ? (
                      <a
                        href={`https://mainnet.lightscan.app/address/${c.mainnet}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all font-mono text-primary hover:underline"
                      >
                        {c.mainnet}
                      </a>
                    ) : (
                      <span className="text-content-soft">—</span>
                    )}
                  </td>
                  <td className="py-2 leading-relaxed text-content-soft">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── NON-CUSTODIAL ────────────────────────────────────────────── */}
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
              {[
                "Your plaintext prompt (encrypted before it leaves the process).",
                "Public viem client addresses, RPC URL, the gateway URL.",
                "The session key (ephemeral, 32 bytes, never persisted).",
                "The decrypted answer.",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-4">
            <div className="mb-2 flex items-center gap-2">
              <ShieldCheck className="size-4 text-success" />
              <span className="text-sm font-semibold text-content-primary">What only your wallet sees</span>
            </div>
            <ul className="space-y-1.5 text-xs leading-relaxed text-content-soft">
              {[
                "Your private key. The SDK never receives it.",
                "The createSession + submitJob transactions, signed via viem.",
                "The SIWE challenge signature.",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-success/60" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      {/* ── EXAMPLES ─────────────────────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Workflow}
          title="In your stack"
          blurb="Three drop-in shapes. Open in StackBlitz, no install."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {FRAMEWORK_EXAMPLES.map((ex) => (
            <Card key={ex.path} className="flex flex-col p-5">
              <span className="mb-2 text-sm font-semibold text-content-primary">{ex.name}</span>
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

      {/* ── CHANGELOG ────────────────────────────────────────────────── */}
      <Card className="mb-12 p-6">
        <SectionHeader
          icon={FileText}
          title="Recent SDK versions"
          blurb="The project ships regularly. Pinned examples track the latest patch by default."
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

      {/* ── PYTHON PORT ──────────────────────────────────────────────── */}
      <Card className="mb-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Code2 className="size-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold tracking-tight text-content-primary">Python port</h2>
              <p className="text-xs text-content-soft">
                <code className="font-mono">pip install lightnode-sdk</code> for the read-only client +{" "}
                <code className="font-mono">run_inference_with_key</code>. Byte-perfect crypto vs the TS SDK.
              </p>
            </div>
          </div>
          <Button asChild variant="outline">
            <a href="https://github.com/marinom2/lightnode-py" target="_blank" rel="noopener noreferrer">
              <Github /> lightnode-py <ExternalLink />
            </a>
          </Button>
        </div>
      </Card>

      {/* ── PLAYGROUND + LCAI-IDE ────────────────────────────────────── */}
      <Card className="mb-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="size-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold tracking-tight text-content-primary">
                Inspect the contracts in an IDE
              </h2>
              <p className="text-xs text-content-soft">
                LightChain&apos;s Remix-fork IDE loads JobRegistry / AIConfig, decodes tx payloads, lets you write
                Solidity callers.
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

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Workflow className="size-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold tracking-tight text-content-primary">In-browser playground</h2>
              <p className="text-xs text-content-soft">
                Connect a wallet, type a prompt, run one real encrypted inference. Source you can copy.
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
    </div>
  );
}
