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
import { NETWORKS } from "lightnode-sdk";
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
      "Top up a server wallet, let users pay in ETH, or move earnings back. Typed wrapper around the LightChain Hyperlane Warp Route - quote, approve, transfer LCAI both directions. Pair it with a Uniswap swap for a complete ETH-to-native-LCAI flow.",
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
    title: "Models on-chain (AIConfig)",
    blurb:
      "On LightChain mainnet the official model registry is AIConfig - whitelisted models, fees, and output limits. ln.getModels() / ln.estimateFee() read it directly. The custom lcai_listSupportedModels RPC method returns the live whitelist.",
    npm: "#read-only-lightnode-client-free-no-key",
    github: "https://github.com/marinom2/lightnode/blob/main/sdk/src/onchain.ts",
    snippet: `import { LightNode } from "lightnode-sdk";

const ln = new LightNode("mainnet");

// Read every whitelisted model + fee + max tokens straight from AIConfig:
const models = await ln.getModels();
for (const m of models) {
  console.log(m.name, m.fee, m.max_output_tokens);
}

// Or the on-chain fee for a single model:
const fee = await ln.estimateFee("llama3-8b");   // -> 0.02 LCAI
const id = ln.modelId("llama3-8b");              // keccak256(name)`,
    triable: true,
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
      <pre className="max-h-[280px] overflow-auto rounded-lg border border-bdr-soft code-surface p-3 font-mono text-[11px] leading-relaxed text-content-default">
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
  const renderQuote = (q: DirQuote, unit: "ETH" | "LCAI") => {
    if (!q.ok) {
      return <div className="text-[11px] leading-relaxed text-warning">Live quote unavailable: {q.error.slice(0, 60)}</div>;
    }
    const v = unit === "ETH" ? q.feeEth ?? 0 : q.feeLcai ?? 0;
    if (v === 0) {
      return (
        <>
          <div className="font-mono text-sm text-content-default">0 {unit}</div>
          <div className="text-[10px] text-content-soft">Pre-paid relayer (Hyperlane IGP); you only pay source-chain gas</div>
        </>
      );
    }
    return (
      <>
        <div className="font-mono text-sm text-content-default">{v.toFixed(6)} {unit}</div>
        <div className="text-[10px] text-content-soft">Hyperlane interchain gas payment</div>
      </>
    );
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-content-soft">Ethereum {"->"} LightChain</div>
          {renderQuote(ethToLc, "ETH")}
        </div>
        <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-content-soft">LightChain {"->"} Ethereum</div>
          {renderQuote(lcToEth, "LCAI")}
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
      {/* Purpose + USD/ETH-to-LCAI recipe */}
      <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-content-soft">Why builders use this</span>
        </div>
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-content-default">
          <li className="flex items-start gap-2">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
            <span>Top up your server-side LCAI wallet from Ethereum so it can pay for inference jobs.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
            <span>Let users pay in ETH (via Uniswap swap to LCAI ERC-20, then bridge) without holding LCAI first.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
            <span>Move earnings off LightChain into ETH/USDC by bridging LCAI back to Ethereum and swapping.</span>
          </li>
        </ul>
      </div>

      {/* ETH -> LCAI orchestration: swap then bridge */}
      <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-content-soft">
          Full recipe: ETH on Ethereum &rarr; native LCAI on LightChain
        </div>
        <ol className="mb-3 space-y-1.5 text-[11px] leading-relaxed text-content-default">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">1</span>
            <span>
              Swap ETH for LCAI ERC-20 on Uniswap (
              <a
                href="https://app.uniswap.org/swap?chain=ethereum&inputCurrency=ETH&outputCurrency=0x9cA8530CA349c966Fe9ef903Df17a75B8A778927"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                deep link
              </a>
              ).
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">2</span>
            <span>
              <code className="font-mono text-content-default">bridge.approve()</code> the HypERC20Collateral (one-time, MaxUint256).
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">3</span>
            <span>
              <code className="font-mono text-content-default">bridge.transfer({"{ from: 'ethereum', to: 'lightchain-mainnet', amount, recipient }"})</code>. Hyperlane relays in ~30 to 60 minutes.
            </span>
          </li>
        </ol>
        <CopyButtonRow code={`// 1. Swap ETH -> LCAI ERC-20 on Uniswap (do this in the user's wallet)
// 2. Approve + transferRemote on this side
import { Bridge, BRIDGE_ROUTE } from "lightnode-sdk";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY!);
const ethPub = createPublicClient({ transport: http(BRIDGE_ROUTE.ethereum.rpc) });
const ethWal = createWalletClient({ account, transport: http(BRIDGE_ROUTE.ethereum.rpc) });

const bridge = new Bridge(ethPub, ethWal);
const fee = await bridge.quoteFee("ethereum", "lightchain-mainnet");  // 0 ETH (pre-paid IGP)
await bridge.approve();                                               // one-time approval
await bridge.transfer({
  from: "ethereum",
  to: "lightchain-mainnet",
  amount: parseEther("100"),
  recipient: account.address,
  fee,
});
// Hyperlane relay delivers native LCAI on chain 9200 within ~30-60 min.`} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button asChild size="sm" variant="outline" className="w-full">
          <a
            href="https://app.uniswap.org/swap?chain=ethereum&inputCurrency=ETH&outputCurrency=0x9cA8530CA349c966Fe9ef903Df17a75B8A778927"
            target="_blank"
            rel="noopener noreferrer"
          >
            Uniswap (ETH to LCAI) <ExternalLink />
          </a>
        </Button>
        <Button asChild size="sm" className="w-full">
          <a href="https://bridge.lightchain.ai" target="_blank" rel="noopener noreferrer">
            Open the bridge UI <ExternalLink />
          </a>
        </Button>
      </div>
    </div>
  );
}

function CopyButtonRow({ code }: { code: string }) {
  return <CodeBox code={code} />;
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

type DaoChainKey = "ethereum" | "lightchain";

function DaoLive() {
  const [chain, setChain] = useState<DaoChainKey>("ethereum");
  const [data, setData] = useState<DaoListResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    setErr(null);
    setOpenId(null);
    fetch(`/api/dao-proposals?chain=${chain}`, { cache: "no-store" })
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
  }, [chain]);
  const chainToggle = (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-content-soft">Governor on</span>
      <div className="inline-flex rounded-md border border-bdr-soft bg-surface-base-faint p-0.5">
        {(["ethereum", "lightchain"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setChain(k)}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
              chain === k ? "bg-card text-content-primary shadow" : "text-content-soft hover:text-content-primary",
            )}
          >
            {k === "ethereum" ? "Ethereum" : "LightChain"}
          </button>
        ))}
      </div>
    </div>
  );

  const intro = (
    <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3 text-[11px] leading-relaxed text-content-default">
      {chain === "ethereum" ? (
        <>
          <p className="mb-1">
            <span className="font-medium text-content-primary">LCAIGovernor</span> on Ethereum mainnet. Token holders
            wrap LCAI ERC-20 into <code className="font-mono">LCAI-Ballots</code> (IVotes) at{" "}
            <a href="https://ballots.lightchain.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              ballots.lightchain.ai
            </a>{" "}
            to vote / propose. Proposal threshold: <span className="font-medium">140,000 LCAI</span> wrapped. 24h
            voting delay, ~14d voting period.
          </p>
        </>
      ) : (
        <>
          <p className="mb-1">
            <span className="font-medium text-content-primary">LightChainGovernor</span> on LightChain mainnet (chain
            9200). Uses the <code className="font-mono">NativeVotes</code> precompile so native LCAI itself acts as the
            voting token, no wrapping needed. Live at{" "}
            <a href="https://dao.lightchain.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              dao.lightchain.ai
            </a>.
          </p>
        </>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {chainToggle}
        {intro}
        <p className="flex items-center gap-2 text-xs text-content-soft">
          <Loader2 className="size-3.5 animate-spin" /> Reading governor on {chain === "ethereum" ? "Ethereum" : "LightChain mainnet"}…
        </p>
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className="space-y-3">
        {chainToggle}
        {intro}
        <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-content-default">
          Couldn&apos;t reach the Governor right now. {err ?? ""}
        </p>
      </div>
    );
  }
  if (data.proposals.length === 0) {
    return (
      <div className="space-y-3">
        {chainToggle}
        {intro}
        <p className="rounded-md border border-bdr-soft bg-surface-base-faint px-3 py-2 text-xs text-content-soft">
          No proposals indexed in the recent window. Governor at{" "}
          <a href={`${data.addresses.explorer}/address/${data.addresses.governor}`} className="font-mono text-primary hover:underline" target="_blank" rel="noopener noreferrer">
            {data.addresses.governor.slice(0, 10)}…{data.addresses.governor.slice(-6)}
          </a>
          .
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {chainToggle}
      {intro}
      <p className="text-[11px] text-content-soft">Click a row to expand.</p>
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
                For {lcai(p.votesFor)} | Against {lcai(p.votesAgainst)}
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

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface ChatDemoResponse {
  answer?: string;
  jobId?: string;
  worker?: string;
  remaining?: number;
  error?: string;
  runLocally?: boolean;
  howTo?: string;
}

function ChatSample() {
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [howTo, setHowTo] = useState<string | null>(null);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setErr(null);
    setHowTo(null);
    const next: ChatTurn = { role: "user", content: text };
    const newHistory = [...history, next];
    setHistory(newHistory);
    setDraft("");
    try {
      const res = await fetch("/api/chat-demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      // Vercel Hobby tier caps functions at 10s and returns an HTML error
      // body (not JSON) when the inference exceeds that. Parse defensively
      // so the widget tells the user something useful instead of crashing
      // on JSON.parse.
      const raw = await res.text();
      let json: ChatDemoResponse = {};
      try {
        json = JSON.parse(raw) as ChatDemoResponse;
      } catch {
        const looksLikeTimeout = /FUNCTION_INVOCATION_TIMEOUT/i.test(raw);
        setErr(
          looksLikeTimeout
            ? "The worker took longer than this demo allows (10s server budget). Try again - the next inference usually lands in 5-8s. For unlimited tries, open the playground or run the example locally."
            : `Demo failed (${res.status}). Try again, or run the example locally.`,
        );
        setHistory(history);
        return;
      }
      if (!res.ok || !json.answer) {
        setErr(json.error ?? `Demo failed (${res.status})`);
        if (json.howTo) setHowTo(json.howTo);
        setHistory(history);
        return;
      }
      setHistory((h) => [...h, { role: "assistant", content: json.answer ?? "" }]);
    } catch (e) {
      setErr((e as Error).message ?? "request failed");
      setHistory(history);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-content-soft">
        Type a message. The server fires one real encrypted testnet inference per turn (free LCAI from the faucet),
        rate-limited to 3 per hour per IP so the demo stays available. For your own keys + mainnet, use the runnable
        example.
      </p>

      {history.length > 0 ? (
        <div className="max-h-[260px] space-y-2 overflow-y-auto rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
          {history.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed",
                  m.role === "user" ? "bg-primary/15 text-content-primary" : "bg-card text-content-default",
                )}
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending ? (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-card px-3 py-2">
                <Loader2 className="size-3.5 animate-spin text-content-soft" />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Try: Reply with a one-sentence fun fact."
          className="flex-1 resize-none rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 text-xs text-content-primary outline-none transition-colors focus:border-primary/60"
        />
        <Button size="sm" onClick={() => void send()} disabled={!draft.trim() || sending}>
          {sending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
          Send
        </Button>
      </div>

      {err ? (
        <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-content-default">
          {err}
        </p>
      ) : null}
      {howTo ? <CodeBox code={howTo} /> : null}

      {history.length > 0 ? (
        <button
          type="button"
          onClick={() => setHistory([])}
          className="text-[11px] text-content-soft hover:text-content-primary"
        >
          Clear conversation
        </button>
      ) : null}
    </div>
  );
}

interface JobStatusResp {
  id?: string;
  raw?: string;
  category?: string;
  worker?: string | null;
  model?: string | null;
  submittedAt?: number | null;
  completedAt?: number | null;
  workerShareLcai?: number;
  refundable?: boolean;
  jobId?: string;
  status?: string;
  error?: string;
}

function DisputeSample() {
  type Net = "mainnet" | "testnet";
  const [net, setNet] = useState<Net>("mainnet");
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JobStatusResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function lookup() {
    if (!jobId.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/sdk-demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "job", net, arg: jobId.trim() }),
      });
      const json = (await res.json()) as JobStatusResp;
      if (!res.ok) setErr(json.error ?? `Lookup failed (${res.status})`);
      else setResult(json);
    } catch (e) {
      setErr((e as Error).message ?? "request failed");
    } finally {
      setBusy(false);
    }
  }

  const cat = result?.category ?? result?.status ?? "";
  const catTone =
    cat === "completed" ? "text-success" :
    cat === "stalled" || cat === "disputed" ? "text-warning" :
    cat === "in-flight" || cat === "submitted" ? "text-primary" :
    "text-content-soft";

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-content-soft">
        Paste a real job id from{" "}
        <a href="https://mainnet.lightscan.app" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          lightscan
        </a>{" "}
        to see <code className="font-mono text-content-default">ln.getJobStatus(jobId)</code>&apos;s classification.
        The job-id is the numeric id from a JobSubmitted event (or a job&apos;s detail page).
      </p>

      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-content-soft">network</span>
        <div className="inline-flex rounded-md border border-bdr-soft bg-surface-base-faint p-0.5">
          {(["mainnet", "testnet"] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNet(n)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                net === n ? "bg-card text-content-primary shadow" : "text-content-soft hover:text-content-primary",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <input
          type="text"
          value={jobId}
          onChange={(e) => setJobId(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void lookup();
            }
          }}
          placeholder="job id (e.g. 1234)"
          className="flex-1 rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-xs text-content-primary outline-none transition-colors focus:border-primary/60"
        />
        <Button size="sm" onClick={() => void lookup()} disabled={!jobId.trim() || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}
          Look up
        </Button>
      </div>

      {err ? (
        <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-content-default">{err}</p>
      ) : null}

      {result ? (
        <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
          {result.category ? (
            <>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-content-soft">job</span>
                <code className="font-mono text-[11px] text-content-default">#{result.id}</code>
                <span className={cn("ml-auto text-[11px] font-medium uppercase tracking-wide", catTone)}>
                  {result.category}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <dt className="text-content-soft">raw state</dt>
                <dd className="text-right font-mono text-content-default">{result.raw ?? "-"}</dd>
                <dt className="text-content-soft">refundable</dt>
                <dd className={cn("text-right font-mono font-semibold", result.refundable ? "text-warning" : "text-content-soft")}>
                  {result.refundable ? "true" : "false"}
                </dd>
                <dt className="text-content-soft">worker</dt>
                <dd className="text-right font-mono text-content-default">
                  {result.worker ? `${result.worker.slice(0, 8)}…${result.worker.slice(-6)}` : "-"}
                </dd>
                <dt className="text-content-soft">model</dt>
                <dd className="text-right font-mono text-content-default">
                  {result.model ? `${result.model.slice(0, 10)}…` : "-"}
                </dd>
                <dt className="text-content-soft">worker share</dt>
                <dd className="text-right font-mono text-content-default">
                  {(result.workerShareLcai ?? 0).toFixed(4)} LCAI
                </dd>
                <dt className="text-content-soft">submitted at</dt>
                <dd className="text-right font-mono text-content-default">
                  {result.submittedAt ? new Date(result.submittedAt * 1000).toISOString().slice(0, 16).replace("T", " ") : "-"}
                </dd>
                <dt className="text-content-soft">completed at</dt>
                <dd className="text-right font-mono text-content-default">
                  {result.completedAt ? new Date(result.completedAt * 1000).toISOString().slice(0, 16).replace("T", " ") : "-"}
                </dd>
              </dl>
            </>
          ) : (
            <p className="text-[11px] text-content-soft">
              Job <code className="font-mono">#{result.jobId}</code> not indexed yet (state:{" "}
              <code className="font-mono">{result.status}</code>).
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ModelsExplainer() {
  type Net = "mainnet" | "testnet";
  interface ModelRow {
    name: string;
    fee?: string;
    max_output_tokens?: number;
    is_whitelisted?: boolean;
    is_enabled?: boolean;
  }
  const [net, setNet] = useState<Net>("mainnet");
  const [rows, setRows] = useState<ModelRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRows(null);
    setErr(null);
    fetch("/api/sdk-demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "models", net }),
    })
      .then((r) => r.json())
      .then((j: ModelRow[] | { error?: string }) => {
        if (!alive) return;
        if (Array.isArray(j)) setRows(j);
        else setErr((j as { error?: string }).error ?? "fetch failed");
      })
      .catch((e) => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [net]);

  const lcai = (wei?: string) => {
    if (!wei) return "-";
    try {
      return (Number(BigInt(wei)) / 1e18).toFixed(3) + " LCAI";
    } catch {
      return "-";
    }
  };

  return (
    <div className="space-y-3 text-[11px] leading-relaxed text-content-default">
      <p className="text-content-soft">
        The official LightChain model registry is the{" "}
        <code className="font-mono text-content-default">AIConfig</code> contract. The read-only{" "}
        <code className="font-mono text-content-default">LightNode</code> client wraps it -{" "}
        <code className="font-mono text-content-default">ln.getModels()</code> is what built the table below right
        now:
      </p>

      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-content-soft">network</span>
        <div className="inline-flex rounded-md border border-bdr-soft bg-surface-base-faint p-0.5">
          {(["mainnet", "testnet"] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNet(n)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                net === n ? "bg-card text-content-primary shadow" : "text-content-soft hover:text-content-primary",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-content-soft">
          <span className="size-1.5 animate-pulse rounded-full bg-success" />
          Whitelisted on {net} via ln.getModels()
        </div>
        {loading ? (
          <p className="flex items-center gap-2 text-[11px] text-content-soft">
            <Loader2 className="size-3.5 animate-spin" /> Reading AIConfig…
          </p>
        ) : err ? (
          <p className="rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 text-[11px] text-content-default">
            {err}
          </p>
        ) : !rows || rows.length === 0 ? (
          <p className="text-[11px] text-content-soft">No models registered.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="text-content-soft">
              <tr>
                <th className="pb-1 text-left font-medium">Model</th>
                <th className="pb-1 text-right font-medium">Fee per job</th>
                <th className="pb-1 text-right font-medium">Max output</th>
                <th className="pb-1 text-right font-medium">Live</th>
              </tr>
            </thead>
            <tbody className="font-mono text-content-default">
              {rows.map((m) => (
                <tr key={m.name} className="border-t border-bdr-soft/40">
                  <td className="py-1">{m.name}</td>
                  <td className="py-1 text-right">{lcai(m.fee)}</td>
                  <td className="py-1 text-right">{m.max_output_tokens?.toLocaleString() ?? "-"}</td>
                  <td className="py-1 text-right">
                    {m.is_whitelisted && m.is_enabled ? (
                      <span className="text-success">yes</span>
                    ) : (
                      <span className="text-content-soft">off</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-content-soft">
          AIConfig (model registry) addresses
        </div>
        <ul className="space-y-1.5">
          {(["mainnet", "testnet"] as const).map((n) => {
            const cfg = NETWORKS[n];
            const addr = cfg.aiConfig;
            return (
              <li key={n} className="flex items-start gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                <span>
                  <span className="text-content-soft">{cfg.label} (chain {cfg.chainId}):</span>{" "}
                  <a
                    href={`${cfg.explorer}/address/${addr}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline"
                  >
                    {addr.slice(0, 10)}…{addr.slice(-6)}
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[10px] text-content-soft">
          For the live whitelist, you can also call the chain&apos;s custom{" "}
          <code className="font-mono">lcai_listSupportedModels</code> RPC method directly.
        </p>
      </div>

      <p className="text-content-soft">
        Try it now: use the &quot;Run a CLI command&quot; widget above, pick{" "}
        <code className="font-mono text-content-default">lightnode models</code>, hit Run.
      </p>
    </div>
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
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-success" title="Shipped in lightnode-sdk@0.6.x">
                  <span className="size-1.5 rounded-full bg-success" /> in 0.6.x
                </span>
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
