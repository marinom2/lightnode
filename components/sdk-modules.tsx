"use client";

/**
 * Interactive ecosystem cards on /build. Each card is a real, exported
 * SDK module - and now each card can be EXPANDED INLINE to see live data
 * (or a runnable demo) plus deep-links to the npm package, the GitHub
 * source file, and the matching example.
 *
 * The user kept asking "I can't click on them to start using them" - this
 * is the fix. One card per module, one Try button per card, each Try
 * surfaces a different live experience:
 *   - Bridge: live quote both directions + addresses table
 *   - DAO: live list of recent LCAIGovernor proposals + drill-down
 *   - Multi-turn chat: code snippet + example link
 *   - Worker preflight: sample verdict + run-locally CLI
 *   - Dispute / refund: re-uses the CLI runner (job command)
 *   - On-chain models: explainer + code snippet (no public deployment yet)
 *
 * Card-level links: npm (the published package surface), GitHub (the
 * specific source file the module lives in), Examples (the runnable
 * standalone example in lightnode-examples).
 */

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Boxes,
  Check,
  ChevronDown,
  Coins,
  Copy,
  Database,
  ExternalLink,
  Github,
  Loader2,
  PackageOpen,
  PlayCircle,
  ShieldCheck,
  Terminal,
  Workflow,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ModuleDef {
  id: ModuleId;
  icon: typeof Boxes;
  title: string;
  blurb: string;
  npm: string; // anchor on the npm README
  github: string;
  example?: string;
  snippet: string;
  triable: boolean;
}

type ModuleId = "bridge" | "dao" | "chat" | "preflight" | "models" | "dispute";

const MODULES: ModuleDef[] = [
  {
    id: "bridge",
    icon: Coins,
    title: "Bridge SDK",
    blurb:
      "Typed wrapper around the LightChain Hyperlane Warp Route. Quote, approve, transfer LCAI between Ethereum and LightChain mainnet (both directions).",
    npm: "#bridge-sdk-new-in-050",
    github: "https://github.com/marinom2/lightnode/blob/main/sdk/src/bridge.ts",
    example: "https://github.com/marinom2/lightnode-examples/tree/main/bridge-transfer",
    snippet: `import { Bridge, BRIDGE_ROUTE } from "lightnode-sdk";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";

const ethPub = createPublicClient({ transport: http(BRIDGE_ROUTE.ethereum.rpc) });
const bridge = new Bridge(ethPub, ethWal);

const fee = await bridge.quoteFee("ethereum", "lightchain-mainnet");
await bridge.approve();
await bridge.transfer({
  from: "ethereum",
  to: "lightchain-mainnet",
  amount: parseEther("100"),
  recipient: account.address,
  fee,
});`,
    triable: true,
  },
  {
    id: "dao",
    icon: ShieldCheck,
    title: "DAO SDK (LCAIGovernor)",
    blurb:
      "Read + vote on LCAI Governor proposals on Ethereum. Real OZ Governor v5 wrapper. Cast votes, propose, queue, execute.",
    npm: "#dao-sdk-new-in-050",
    github: "https://github.com/marinom2/lightnode/blob/main/sdk/src/dao.ts",
    example: "https://github.com/marinom2/lightnode-examples/tree/main/dao-vote",
    snippet: `import { DAO, VoteSupport } from "lightnode-sdk";

const dao = new DAO(publicClient, "ethereum", walletClient);
const p = await dao.proposal(12345n);
console.log(p.stateLabel, p.votes);

await dao.castVote(12345n, VoteSupport.For, "I support this");`,
    triable: true,
  },
  {
    id: "chat",
    icon: Workflow,
    title: "Multi-turn Conversation",
    blurb:
      "new Conversation({ network, privateKey }).send('hi') keeps history client-side and runs one encrypted inference per turn. Optional system prompt + maxHistoryTurns cap.",
    npm: "#five-line-hello-world",
    github: "https://github.com/marinom2/lightnode/blob/main/sdk/src/chat.ts",
    example: "https://github.com/marinom2/lightnode-examples/tree/main/multi-turn-chat",
    snippet: `import { Conversation } from "lightnode-sdk";

const chat = new Conversation({
  network: "testnet",
  privateKey: process.env.PRIVATE_KEY,
  system: "You are a concise assistant.",
  maxHistoryTurns: 20,
});

await chat.send("Who wrote The Great Gatsby?");
await chat.send("In what year?");      // sees prior turn
chat.messages();                       // full transcript`,
    triable: true,
  },
  {
    id: "preflight",
    icon: PlayCircle,
    title: "Worker preflight + watch",
    blurb:
      "workerPreflight submits ONE real test inference + returns verdict. workerWatch streams state-change events (registered, went-stale, jobs-completed) for any worker, no key required.",
    npm: "#worker-preflight--watch-new-in-050",
    github: "https://github.com/marinom2/lightnode/blob/main/sdk/src/worker.ts",
    example: "https://github.com/marinom2/lightnode-examples/tree/main/worker-preflight",
    snippet: `import { workerPreflight, workerWatch, LightNode } from "lightnode-sdk";

// One real test inference (CI gate)
const r = await workerPreflight({ network: "testnet", privateKey: "0x...", model: "llama3-8b" });
console.log(r.verdict);                // "ok" | "over-deadline" | "stalled" | "failed"

// Watch a worker - emits events on state change
const ln = new LightNode("mainnet");
for await (const event of workerWatch(ln, "0xWorker...", { intervalMs: 30_000 }).events) {
  console.log(event.kind, event.state);
}`,
    triable: true,
  },
  {
    id: "dispute",
    icon: Database,
    title: "Dispute / refund queries",
    blurb:
      "ln.getJobStatus(jobId) classifies a job (submitted / in-flight / completed / stalled / disputed / resolved) and exposes a refundable flag.",
    npm: "#read-only-lightnode-client-free-no-key",
    github: "https://github.com/marinom2/lightnode/blob/main/sdk/src/index.ts",
    snippet: `import { LightNode } from "lightnode-sdk";

const ln = new LightNode("mainnet");
const status = await ln.getJobStatus(1234n);
console.log(status.category, status.refundable);
// "stalled" | "disputed" -> refundable=true`,
    triable: true,
  },
  {
    id: "models",
    icon: Boxes,
    title: "On-chain Model Registry",
    blurb:
      "Typed reader for AIVMModelRegistry + BenchmarkRegistry. Full ABI plus a builder-friendly access tier (free / paywalled / ticket-gated). Bring your own deployed address; LightChain has not published one yet.",
    npm: "#on-chain-model-registry-reader-new-in-050",
    github: "https://github.com/marinom2/lightnode/blob/main/sdk/src/onchain-models.ts",
    example: "https://github.com/marinom2/lightnode-examples/tree/main/model-registry-read",
    snippet: `import { OnchainModelRegistry } from "lightnode-sdk";

const reader = new OnchainModelRegistry({
  publicClient,
  registry: "0xYourDeployment...",
});

const baseIds = await reader.getBaseModelIds();
const variant = await reader.getVariant(id);
const policy = await reader.getAccessPolicy(id);
// policy.tier === "free" | "paywalled" | "ticket-gated"`,
    triable: false,
  },
];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore
        }
      }}
      aria-label="Copy snippet"
      className="absolute right-2 top-2 rounded-md border border-bdr-soft bg-card/80 p-1.5 text-content-soft transition-colors hover:text-content-primary"
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function CodeBox({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="max-h-[280px] overflow-auto rounded-lg border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-[11px] leading-relaxed text-content-default">
        <code>{code}</code>
      </pre>
      <CopyButton value={code} />
    </div>
  );
}

function DocLinks({ m }: { m: ModuleDef }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <a
        href={`https://www.npmjs.com/package/lightnode-sdk${m.npm}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md border border-bdr-soft px-2 py-1 text-[11px] text-content-soft transition-colors hover:border-bdr-light hover:text-content-primary"
      >
        <PackageOpen className="size-3" /> npm <ExternalLink className="size-3" />
      </a>
      <a
        href={m.github}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md border border-bdr-soft px-2 py-1 text-[11px] text-content-soft transition-colors hover:border-bdr-light hover:text-content-primary"
      >
        <Github className="size-3" /> source <ExternalLink className="size-3" />
      </a>
      {m.example ? (
        <a
          href={m.example}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-bdr-soft px-2 py-1 text-[11px] text-content-soft transition-colors hover:border-bdr-light hover:text-content-primary"
        >
          <Terminal className="size-3" /> runnable example <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  );
}

// --- Bridge live widget ----------------------------------------------------

type DirQuote =
  | { ok: true; feeWei: string; feeEth?: number; feeLcai?: number }
  | { ok: false; error: string };

interface BridgeQuoteResp {
  ethereumToLightChain: DirQuote;
  lightChainToEthereum: DirQuote;
  route: {
    ethereum: { router: string; underlying: string | null; mailbox: string; explorer: string; chainId: number; label: string };
    "lightchain-mainnet": { router: string; underlying: string | null; mailbox: string; explorer: string; chainId: number; label: string };
  };
  fetchedAt?: number;
  error?: string;
}

function BridgeLive() {
  const [data, setData] = useState<BridgeQuoteResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/bridge-quote", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: BridgeQuoteResp) => {
        if (!alive) return;
        if (j.error) setErr(j.error);
        else setData(j);
      })
      .catch((e) => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-content-soft">
        <Loader2 className="size-3.5 animate-spin" /> Loading live bridge quote…
      </p>
    );
  }
  if (err || !data) {
    return (
      <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-content-default">
        Couldn&apos;t reach the bridge quote endpoint right now. {err ?? ""}
      </p>
    );
  }
  const ethToLc = data.ethereumToLightChain;
  const lcToEth = data.lightChainToEthereum;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-content-soft">Ethereum {"->"} LightChain</div>
          {ethToLc.ok ? (
            <>
              <div className="font-mono text-sm text-content-default">{(ethToLc.feeEth ?? 0).toFixed(6)} ETH</div>
              <div className="text-[10px] text-content-soft">Hyperlane gas payment</div>
            </>
          ) : (
            <div className="text-[11px] leading-relaxed text-warning">Live quote unavailable: {ethToLc.error.slice(0, 60)}</div>
          )}
        </div>
        <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-content-soft">LightChain {"->"} Ethereum</div>
          {lcToEth.ok ? (
            <>
              <div className="font-mono text-sm text-content-default">{(lcToEth.feeLcai ?? 0).toFixed(6)} LCAI</div>
              <div className="text-[10px] text-content-soft">Hyperlane gas payment</div>
            </>
          ) : (
            <div className="text-[11px] leading-relaxed text-warning">Live quote unavailable: {lcToEth.error.slice(0, 60)}</div>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-content-soft">Confirmed route addresses</div>
        <table className="w-full text-[11px]">
          <thead className="text-content-soft">
            <tr>
              <th className="pb-1 text-left font-medium">Side</th>
              <th className="pb-1 text-left font-medium">Router</th>
              <th className="pb-1 text-left font-medium">Underlying</th>
            </tr>
          </thead>
          <tbody className="font-mono text-content-default">
            <tr>
              <td className="pr-2 text-content-soft">Ethereum</td>
              <td>
                <a href={`${data.route.ethereum.explorer}/address/${data.route.ethereum.router}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {data.route.ethereum.router.slice(0, 8)}…{data.route.ethereum.router.slice(-6)}
                </a>
              </td>
              <td>
                {data.route.ethereum.underlying ? (
                  <a href={`${data.route.ethereum.explorer}/address/${data.route.ethereum.underlying}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {data.route.ethereum.underlying.slice(0, 8)}…{data.route.ethereum.underlying.slice(-6)}
                  </a>
                ) : (
                  "(native)"
                )}
              </td>
            </tr>
            <tr>
              <td className="pr-2 text-content-soft">LightChain</td>
              <td>
                <a href={`${data.route["lightchain-mainnet"].explorer}/address/${data.route["lightchain-mainnet"].router}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {data.route["lightchain-mainnet"].router.slice(0, 8)}…{data.route["lightchain-mainnet"].router.slice(-6)}
                </a>
              </td>
              <td className="text-content-soft">(native LCAI)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Button asChild size="sm" variant="outline" className="w-full">
        <a href="https://bridge.lightchain.ai" target="_blank" rel="noopener noreferrer">
          Open the bridge UI <ExternalLink />
        </a>
      </Button>
    </div>
  );
}

// --- DAO live widget -------------------------------------------------------

interface DaoProposal {
  id: string;
  title: string;
  descriptionPreview: string;
  proposer: string;
  state: number;
  stateLabel: string;
  votesFor: string;
  votesAgainst: string;
  votesAbstain: string;
}

interface DaoListResp {
  addresses: { governor: string; explorer: string };
  proposals: DaoProposal[];
  error?: string;
}

const STATE_TONE: Record<string, "brand" | "success" | "warning" | "muted"> = {
  active: "brand",
  succeeded: "success",
  queued: "success",
  executed: "success",
  pending: "warning",
  defeated: "muted",
  canceled: "muted",
  expired: "muted",
};

function lcai(wei: string): string {
  try {
    const n = Number(BigInt(wei)) / 1e18;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    if (n >= 1) return n.toFixed(0);
    return n.toFixed(2);
  } catch {
    return "0";
  }
}

function DaoLive() {
  const [data, setData] = useState<DaoListResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/dao-proposals", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: DaoListResp) => {
        if (!alive) return;
        if (j.error) setErr(j.error);
        else setData(j);
      })
      .catch((e) => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-content-soft">
        <Loader2 className="size-3.5 animate-spin" /> Reading LCAIGovernor on Ethereum…
      </p>
    );
  }
  if (err || !data) {
    return (
      <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-content-default">
        Couldn&apos;t reach the Governor right now. {err ?? ""}
      </p>
    );
  }
  if (data.proposals.length === 0) {
    return (
      <p className="rounded-md border border-bdr-soft bg-surface-base-faint px-3 py-2 text-xs text-content-soft">
        No proposals indexed in the last year. The LCAIGovernor is at{" "}
        <a href={`${data.addresses.explorer}/address/${data.addresses.governor}`} className="font-mono text-primary hover:underline" target="_blank" rel="noopener noreferrer">
          {data.addresses.governor.slice(0, 10)}…{data.addresses.governor.slice(-6)}
        </a>{" "}
        on Ethereum.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-content-soft">
        Live read of <code className="font-mono text-content-default">LCAIGovernor</code> on Ethereum. Click a row to expand.
      </p>
      {data.proposals.map((p) => {
        const isOpen = openId === p.id;
        return (
          <div key={p.id} className="rounded-xl border border-bdr-soft bg-surface-base-faint">
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : p.id)}
              className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-card/60"
            >
              <Badge tone={STATE_TONE[p.stateLabel] ?? "muted"}>{p.stateLabel}</Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-content-primary">{p.title}</div>
                <div className="font-mono text-[10px] text-content-soft">id {p.id.slice(0, 12)}…</div>
              </div>
              <div className="text-right font-mono text-[10px] text-content-soft">
                For {lcai(p.votesFor)} · Against {lcai(p.votesAgainst)}
              </div>
              <ChevronDown className={cn("size-4 text-content-soft transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen ? (
              <div className="space-y-2 border-t border-bdr-soft px-3 py-3 text-[11px]">
                <p className="leading-relaxed text-content-default">{p.descriptionPreview}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-content-soft">
                  <span>proposer <code className="font-mono text-content-default">{p.proposer.slice(0, 8)}…{p.proposer.slice(-4)}</code></span>
                  <span>For <code className="font-mono text-content-default">{lcai(p.votesFor)}</code></span>
                  <span>Against <code className="font-mono text-content-default">{lcai(p.votesAgainst)}</code></span>
                  <span>Abstain <code className="font-mono text-content-default">{lcai(p.votesAbstain)}</code></span>
                </div>
                <a href={`https://dao.lightchain.ai/proposal/${p.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Open in DAO UI <ExternalLink className="size-3" />
                </a>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// --- Preflight & generic widgets ------------------------------------------

function PreflightSample() {
  const sample = `{
  "verdict": "ok",
  "elapsedSec": 9.4,
  "worker": "0xabc...",
  "summary": "OK in 9.4s. Worker 0xabc... replied with 14 chars.",
  "txs": {
    "createSession": "0x...",
    "submitJob":     "0x...",
    "jobCompleted":  "0x..."
  }
}`;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-content-soft">
        Preflight runs against the live network with YOUR private key, so it can&apos;t fire from the browser. Sample
        output:
      </p>
      <CodeBox code={sample} />
      <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3 text-[11px] text-content-default">
        Run it locally:{" "}
        <code className="font-mono">PRIVATE_KEY=0x... npx lightnode worker preflight --net testnet</code>
      </div>
    </div>
  );
}

function ChatSample() {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-content-soft">
        Multi-turn chat costs ~0.022 LCAI per turn on mainnet (free on testnet) so it needs your wallet. The runnable
        example is one command away:
      </p>
      <CodeBox
        code={`git clone https://github.com/marinom2/lightnode-examples
cd lightnode-examples/multi-turn-chat
npm install
PRIVATE_KEY=0x... npm start`}
      />
    </div>
  );
}

function DisputeSample() {
  return (
    <p className="text-[11px] text-content-soft">
      Try it live up in the &quot;Run a CLI command&quot; widget above: pick{" "}
      <code className="font-mono text-content-default">lightnode job</code>, paste a job id, hit Run. You&apos;ll see
      the category (<code className="font-mono">completed</code> /{" "}
      <code className="font-mono">stalled</code> / <code className="font-mono">disputed</code>) and the{" "}
      <code className="font-mono">refundable</code> flag.
    </p>
  );
}

function ModelsExplainer() {
  return (
    <p className="text-[11px] text-content-soft">
      LightChain hasn&apos;t published a public mainnet/testnet deployment address for{" "}
      <code className="font-mono text-content-default">AIVMModelRegistry</code> yet. The SDK ships the full typed ABI;
      you supply the address. Once LightChain publishes one we&apos;ll bake it in. The source above has the wrapper +
      every method signature.
    </p>
  );
}

function Widget({ id }: { id: ModuleId }) {
  if (id === "bridge") return <BridgeLive />;
  if (id === "dao") return <DaoLive />;
  if (id === "preflight") return <PreflightSample />;
  if (id === "chat") return <ChatSample />;
  if (id === "dispute") return <DisputeSample />;
  return <ModelsExplainer />;
}

// --- The module grid -------------------------------------------------------

export function SDKModules() {
  const [openId, setOpenId] = useState<ModuleId | null>(null);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {MODULES.map((m) => {
        const isOpen = openId === m.id;
        return (
          <Card key={m.id} className="overflow-hidden">
            <div className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <m.icon className="size-4 text-primary" />
                <span className="text-sm font-semibold text-content-primary">{m.title}</span>
                <Badge tone="success" className="ml-auto">shipped</Badge>
              </div>
              <p className="text-xs leading-relaxed text-content-soft">{m.blurb}</p>
              <CodeBox code={m.snippet} />
              <DocLinks m={m} />
              <Button
                size="sm"
                variant={isOpen ? "outline" : "default"}
                className="mt-3 w-full"
                onClick={() => setOpenId(isOpen ? null : m.id)}
              >
                {m.triable ? (
                  isOpen ? (
                    <>
                      Hide <ChevronDown className="rotate-180" />
                    </>
                  ) : (
                    <>
                      Try it live <ArrowRight />
                    </>
                  )
                ) : isOpen ? (
                  <>
                    Hide details <ChevronDown className="rotate-180" />
                  </>
                ) : (
                  <>
                    See how to use it <ArrowRight />
                  </>
                )}
              </Button>
            </div>
            {isOpen ? (
              <div className="border-t border-bdr-soft bg-surface-base-subtle p-4">
                <Widget id={m.id} />
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
