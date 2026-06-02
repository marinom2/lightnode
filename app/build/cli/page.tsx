import { AlertOctagon, FileText, TerminalSquare, Wallet2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/build/section-header";
import { CliRunner } from "@/components/cli-runner";

export const metadata = {
  title: "CLI - Build with LightChain AI",
  description:
    "The lightnode CLI runs from any terminal. Nine read-only commands, ten add scaffolders (server-paid + user-paid web3), plus wallet, chat, worker preflight + watch, bridge, dao. Try the read-only commands inline here.",
};

// Server-paid (your funded wallet pays per call) and user-paid (web3: each
// visitor signs + pays from their own wallet). Same split the CLI's own
// `--help` uses, so the docs and the tool stay in lockstep.
const CLI_ADD = [
  { cmd: "lightnode add inference", desc: "Server-paid. Encrypted inference route or script. Next.js: app/api/inference/route.ts. Hono / Node: lightchain-inference.ts." },
  { cmd: "lightnode add chat", desc: "Server-paid. Chat UI with conversation history. Next.js: app/chat/page.tsx. Node: terminal REPL with rolling memory." },
  { cmd: "lightnode add judge", desc: "Server-paid. Pass/fail evaluator route - post criteria + evidence, get structured verdict + on-chain proof." },
  { cmd: "lightnode add agent", desc: "Server-paid. Scheduled / loop inference. Next.js: Vercel Cron route + vercel.json. Node: long-running setInterval daemon." },
  { cmd: "lightnode add analytics-dashboard", desc: "Read-only network + worker analytics page. No wallet, no fees. Next.js: SSR page; Node: CLI script." },
  { cmd: "lightnode add nft-mint-with-inference", desc: "AI-generated NFT metadata with on-chain provenance. Mint flow that anchors the answer to a content hash." },
  { cmd: "lightnode add inference-web3", desc: "User-paid. One-shot inference UI, wallet-signed. Scaffolds Next.js, bundles wagmi + Connect button, and installs deps - one command. No backend, no .env." },
  { cmd: "lightnode add chat-web3", desc: "User-paid. Chat UI, wallet-signed (mainnet + testnet aware). Scaffolds Next.js, bundles wagmi + Connect button, wires the layout, installs deps - one command. Each turn is one SIWE sig + one tx." },
  { cmd: "lightnode add judge-web3", desc: "User-paid. Evaluator UI, wallet-signed. Scaffolds Next.js, bundles wagmi + Connect button, and installs deps - one command. Criteria + evidence in, PASSED/FAILED + on-chain receipt out." },
  { cmd: "lightnode add wagmi-setup", desc: "Wallet wiring on its own: lib/wagmi + app/providers + a connect button, and it wraps your layout with <Providers>. Bundled automatically by the web3 scaffolders. Add --no-install / --no-scaffold to opt out." },
] as const;

export default function BuildCliPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-8">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-content-primary sm:text-4xl">
          lightnode CLI
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-content-soft">
          Bundled in lightnode-sdk. Read-only commands run inline below; the rest run from your terminal. Ten add
          scaffolders patch an existing project - six server-paid, plus the user-paid web3 trio and wagmi-setup.
        </p>
      </div>

      {/* How to actually invoke the CLI in a real terminal. */}
      <Card className="mb-3 border-warning/30 bg-warning/5 p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-warning">
          <AlertOctagon className="size-3" /> How to run these in your terminal
        </div>
        <p className="text-[11px] leading-relaxed text-content-default">
          The npm package is <code className="font-mono text-content-default">lightnode-sdk</code> but the bundled
          binary is named <code className="font-mono text-content-default">lightnode</code>, which clashes with another
          package on npm. Three reliable invocations:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md code-surface p-2 font-mono text-[10px] leading-relaxed text-content-default">
{`# One-shot (explicit package):
npx --package=lightnode-sdk -- lightnode wallet new

# Install in your project, then npx finds it:
npm install lightnode-sdk
npx lightnode wallet new

# Global install for everyday use:
npm install -g lightnode-sdk
lightnode wallet new`}
        </pre>
      </Card>

      {/* Interactive CLI runner */}
      <div className="mb-12">
        <SectionHeader
          icon={TerminalSquare}
          title="Try a command (no install)"
          blurb="Pick a read-only command on the left, hit Run, see real JSON. Same output the CLI would print."
        />
        <CliRunner />
      </div>

      {/* Static catalogs */}
      <div className="mb-12 grid gap-3 md:grid-cols-2">
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
            <code className="font-mono">--net testnet|mainnet</code>, and{" "}
            <code className="font-mono">--force</code>.
          </p>
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Wallet2 className="size-4 text-primary" />
            <span className="text-sm font-semibold text-content-primary">Inferences + wallet (need PRIVATE_KEY)</span>
          </div>
          <ul className="space-y-2 text-xs">
            <li>
              <code className="block break-all font-mono text-content-default">lightnode chat &lt;prompt&gt;</code>
              <span className="text-content-soft">One-shot encrypted inference. Streams answer to stdout, JSON receipt to stderr. Supports stdin too.</span>
            </li>
            <li>
              <code className="block break-all font-mono text-content-default">lightnode batch &lt;prompts.json&gt;</code>
              <span className="text-content-soft">Parallel inference. Reads JSON array or {"{prompts, system?, model?}"}; one JSON line per result to stdout. Supports <code className="font-mono">-</code> for stdin and <code className="font-mono">--concurrency 4</code>. <span className="text-primary">(0.6.x)</span></span>
            </li>
            <li>
              <code className="block break-all font-mono text-content-default">lightnode agent &lt;task&gt;</code>
              <span className="text-content-soft">ReAct-style agent with built-in <code className="font-mono">add</code> + <code className="font-mono">now</code> tools. Streams the step trace to stderr, final answer to stdout. Cap with <code className="font-mono">--max-iter 4</code>. <span className="text-primary">(0.6.x)</span></span>
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
              <code className="block break-all font-mono text-content-default">lightnode worker status|can-deregister|settle|clearstuck|withdraw|deregister</code>
              <span className="text-content-soft">The worker-operator lifecycle from the terminal. <code className="font-mono">status</code> and <code className="font-mono">can-deregister</code> are read-only; the rest sign with your key. <code className="font-mono">clearstuck</code> times out acked, past-deadline jobs that block the exit (mainnet realizes a slash, so it needs <code className="font-mono">--yes</code>). <span className="text-primary">(0.7.x)</span></span>
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
  );
}
