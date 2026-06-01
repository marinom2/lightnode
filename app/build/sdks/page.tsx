import Link from "next/link";
import { AlertOctagon, ArrowRight, Bot, Layers, Layers3, Server, Sparkles, User2, Wallet2 } from "lucide-react";
import { SectionHeader } from "@/components/build/section-header";
import { MODULES } from "@/lib/sdk-modules-data";

export const metadata = {
  title: "SDK modules - Build with LightChain AI",
  description:
    "Try every lightnode-sdk module inline: Bridge, DAO, multi-turn chat, worker preflight, dispute / refund queries, on-chain Models. Plus the three inference API tiers and server-vs-user-pays patterns.",
};

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

export default function BuildSdksPage() {
  return (
    <div className="relative mx-auto max-w-5xl px-5 py-10">
      {/* Pink-to-lavender aurora behind the hero - same treatment as
          the lightchain.ai marketing page. Lives inside the page so it
          only washes the top viewport, not the rest of the content. */}
      <div className="aurora-hero" aria-hidden />
      {/* Hero with isometric SDK illustration as the visual CTA. */}
      <div className="relative mb-16 grid items-center gap-10 lg:grid-cols-[1fr_minmax(0,420px)]">
        <div>
          <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-content-soft">lightnode-sdk 0.6.x</p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-content-primary sm:text-5xl lg:text-6xl">
            Eight modules. One install.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-content-soft sm:text-lg">
            Open any module for a focused page with live data, runnable snippets, and one-click sandboxes.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
            <a
              href="https://www.npmjs.com/package/lightnode-sdk"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 font-semibold text-white shadow-[0_0_18px_-4px_rgba(112,100,233,0.7)] transition-all hover:shadow-[0_0_24px_-2px_rgba(221,0,172,0.55)]"
              style={{ background: "linear-gradient(94deg, #7064E9 0%, #9333ea 60%, #dd00ac 100%)" }}
            >
              npm install lightnode-sdk
            </a>
            <a
              href="https://github.com/marinom2/lightnode/blob/main/sdk/README.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-content-soft underline-offset-4 transition-colors hover:text-content-primary hover:underline"
            >
              Read the SDK README
            </a>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          {/* Soft radial halo behind the illustration so it floats. */}
          <div className="pointer-events-none absolute inset-0 -z-10 scale-110 rounded-full bg-[radial-gradient(closest-side,rgba(112,100,233,0.18),transparent)] blur-2xl" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/sdk/sdk-hero.svg"
            alt="LightNode SDK illustration"
            className="h-auto w-full"
            loading="eager"
          />
        </div>
      </div>

      {/* ── SDK MODULES (LINK CARDS) ────────────────────────────────── */}
      <div className="mb-16">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <Link
              key={m.id}
              href={`/build/sdks/${m.id}`}
              aria-label={`Open ${m.title}`}
              className="group relative flex flex-col rounded-xl border border-bdr-soft bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-bdr-light hover:bg-surface-base-subtle"
            >
              <div className="mb-4 grid size-10 place-items-center rounded-lg bg-surface-base-faint">
                <m.icon className="size-5 text-primary" />
              </div>
              <h3 className="mb-1.5 text-base font-semibold tracking-tight text-content-primary">{m.title}</h3>
              <p className="mb-6 line-clamp-3 flex-1 text-sm leading-relaxed text-content-soft">{m.blurb}</p>
              <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                Open
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── 0.6.0 NEW: BATCH + AGENT ─────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Sparkles}
          title="New in 0.6.0: Batch runner + Agent loop"
          blurb="Two higher-level abstractions on top of runInferenceWithKey. Same proof chain, same encrypted session - just less boilerplate for common patterns."
        />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col rounded-xl border border-bdr-soft bg-card p-6">
            <div className="mb-2 flex items-center gap-2">
              <Layers3 className="size-5 text-primary" />
              <span className="text-sm font-semibold text-content-primary">runInferenceBatch</span>
              <span className="ml-auto inline-flex items-center rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">0.6.0</span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-content-soft">
              Fan out many prompts as parallel encrypted inferences with a capped concurrency. Stable result order, per-slot
              errors so one stalled worker does not kill the batch. Optional <code className="font-mono">onSlotComplete</code> for
              live progress UI, optional <code className="font-mono">AbortSignal</code> to cancel queued work.
            </p>
            <pre className="overflow-x-auto rounded-md code-surface p-3 font-mono text-[11px] leading-relaxed text-content-default">
{`import { runInferenceBatch } from "lightnode-sdk";

const results = await runInferenceBatch({
  network: "testnet",
  privateKey: process.env.PRIVATE_KEY!,
  model: "llama3-8b",
  system: "Reply in one short sentence.",
  concurrency: 4,
  prompts: [
    "fact about the ocean",
    "fact about the moon",
    "fact about coffee",
  ],
  onSlotComplete: ({ index, result, error }) => {
    console.log(\`#\${index}\`, error?.message ?? result?.answer);
  },
});`}
            </pre>
            <p className="mt-2 text-[11px] text-content-soft">
              <span className="font-medium text-content-default">Fits:</span> batch evals, content scoring, RAG re-ranking,
              parallel rewrites.
            </p>
          </div>
          <div className="flex flex-col rounded-xl border border-bdr-soft bg-card p-6">
            <div className="mb-2 flex items-center gap-2">
              <Bot className="size-5 text-primary" />
              <span className="text-sm font-semibold text-content-primary">Agent (tool calling)</span>
              <span className="ml-auto inline-flex items-center rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">0.6.0</span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-content-soft">
              ReAct-style loop: model thinks, picks a tool, runs it, observes the result, iterates. Uses simple string markers
              (<code className="font-mono">&lt;tool&gt;</code> / <code className="font-mono">&lt;answer&gt;</code>) so it
              works on small open models like llama3-8b without native function-calling support.
            </p>
            <pre className="overflow-x-auto rounded-md code-surface p-3 font-mono text-[11px] leading-relaxed text-content-default">
{`import { Agent } from "lightnode-sdk";

const agent = new Agent({
  network: "testnet",
  privateKey: process.env.PRIVATE_KEY!,
  model: "llama3-8b",
  system: "You are a careful research assistant.",
  tools: [{
    name: "add",
    description: "Add two integers, return the sum.",
    args: { a: "int", b: "int" },
    handler: ({ a, b }) => Number(a) + Number(b),
  }],
  maxIterations: 4,
});

const { answer, steps } = await agent.run("17 + 25?");`}
            </pre>
            <p className="mt-2 text-[11px] text-content-soft">
              <span className="font-medium text-content-default">Fits:</span> autonomous tasks, search + summarize, lookup
              chains, multi-step reasoning with deterministic side-effects.
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-content-soft">
          Plus <code className="font-mono">AbortSignal</code> support added to <code className="font-mono">runInferenceWithKey</code>{" "}
          for cancellable UI flows (in-flight on-chain txs still settle; the SDK just stops awaiting).
        </p>
      </div>

      {/* ── API TIERS ────────────────────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Layers}
          title="Three API tiers for paid inference"
          blurb="Pick the highest one that fits. Lower tiers exist for control, not for prestige."
        />
        <div className="grid gap-3 md:grid-cols-3">
          {INFERENCE_TIERS.map((tier) => (
            <div key={tier.name} className="flex flex-col rounded-xl border border-bdr-soft bg-card p-6">
              <code className="mb-1 break-all font-mono text-sm font-semibold text-content-primary">{tier.name}</code>
              <span className="mb-3 text-xs font-medium text-primary">{tier.line}</span>
              <p className="mb-3 flex-1 text-xs leading-relaxed text-content-soft">{tier.body}</p>
              <div className="rounded-lg border border-bdr-soft bg-surface-base-faint p-2.5">
                <span className="text-[10px] uppercase tracking-wide text-content-soft">Fits</span>
                <p className="mt-0.5 text-xs text-content-default">{tier.fit}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SERVER VS USER ───────────────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Wallet2}
          title="Whose wallet pays for each call?"
          blurb="The architectural choice that catches builders by surprise. Both patterns use the same SDK."
        />
        <div className="grid gap-3 md:grid-cols-2">
          {PAY_PATTERNS.map((p) => (
            <div key={p.name} className="rounded-xl border border-bdr-soft bg-card p-6">
              <div className="mb-2 flex items-center gap-2">
                <p.icon className="size-5 text-primary" />
                <span className="text-sm font-semibold text-content-primary">{p.name}</span>
              </div>
              <span className="mb-2 block text-xs font-medium text-primary">{p.line}</span>
              <p className="mb-3 text-xs leading-relaxed text-content-soft">{p.desc}</p>
              <div className="mb-2 rounded-lg border border-bdr-soft bg-surface-base-faint p-2.5">
                <span className="text-[10px] uppercase tracking-wide text-content-soft">Fits</span>
                <ul className="mt-1 space-y-1 text-xs text-content-default">
                  {p.fits.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-[11px] text-content-soft">
                <span className="font-medium text-content-default">Examples:</span> {p.examples}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── TYPED ERRORS ─────────────────────────────────────────────── */}
      <div className="mb-6 rounded-xl border border-bdr-soft bg-card p-6 sm:p-8">
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
      </div>
    </div>
  );
}
