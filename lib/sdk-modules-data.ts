/**
 * Server-safe data for the six SDK modules surfaced on /build/sdks and on
 * the dedicated /build/sdks/<id> sub-pages. Lives in /lib (no "use client")
 * so server components can import MODULES at static-generation time.
 *
 * The interactive widgets that render this data live in
 * components/sdk-modules.tsx (which IS "use client"). That file re-exports
 * MODULES / ModuleDef / ModuleId from here so existing callers keep working.
 */
import { Boxes, Coins, Database, PlayCircle, ShieldCheck, Workflow } from "lucide-react";

export type ModuleId = "bridge" | "dao" | "chat" | "preflight" | "models" | "dispute";

export interface ModuleDef {
  id: ModuleId;
  icon: typeof Boxes;
  title: string;
  blurb: string;
  npm: string; // anchor on the npm README
  github: string;
  example?: string;
  snippet: string;
  triable: boolean;
  /**
   * Complete, self-contained version of the snippet that runs in a Node
   * sandbox (StackBlitz) without the visitor having to wire viem clients
   * or fill in placeholders. Falls back to `snippet` when omitted.
   */
  sandboxBody?: string;
  /** Sandbox needs PRIVATE_KEY in .env to do anything useful. */
  sandboxNeedsKey?: boolean;
  /**
   * Optional hero illustration shown on this module's /build/sdks/<id> sub-
   * page. Loaded with next/image at large size on desktop, stacked below
   * the copy on mobile. Path is relative to /public.
   */
  heroImage?: string;
}

export const MODULES: ModuleDef[] = [
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
    heroImage: "/images/sdk/bridge-hero.webp",
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
    sandboxBody: `import { DAO } from "lightnode-sdk";
import { createPublicClient, createWalletClient, http } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const transport = http("https://ethereum-rpc.publicnode.com");
const publicClient = createPublicClient({ chain: mainnet, transport });

// Voting requires PRIVATE_KEY in .env. Reading proposals works without it.
const KEY = process.env.PRIVATE_KEY as \`0x\${string}\` | undefined;
const walletClient = KEY
  ? createWalletClient({ account: privateKeyToAccount(KEY), chain: mainnet, transport })
  : undefined;

const dao = new DAO(publicClient, "ethereum", walletClient);

// List recent proposals on LCAIGovernor (Ethereum mainnet):
const proposals = await dao.proposals();
for (const p of proposals.slice(0, 5)) {
  console.log(p.id.toString(), p.stateLabel, p.title.slice(0, 60));
}

// To vote (needs PRIVATE_KEY + LCAI Ballots delegated to your address):
// import { VoteSupport } from "lightnode-sdk";
// await dao.castVote(proposals[0].id, VoteSupport.For, "support this");`,
    sandboxNeedsKey: false,
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
    sandboxBody: `import { Conversation } from "lightnode-sdk";

const chat = new Conversation({
  network: "testnet",
  privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
  system: "You are a concise assistant. Reply in one short sentence.",
  maxHistoryTurns: 20,
});

console.log("\\nTurn 1:");
const r1 = await chat.send("Who wrote The Great Gatsby?");
console.log("answer :", r1.answer);
console.log("worker :", r1.worker, "  job:", r1.jobId.toString());

console.log("\\nTurn 2 (history-aware):");
const r2 = await chat.send("In what year?");
console.log("answer :", r2.answer);

console.log("\\nFull transcript :");
console.log(JSON.stringify(chat.messages(), null, 2));`,
    sandboxNeedsKey: true,
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
    sandboxBody: `import { workerPreflight, LightNode } from "lightnode-sdk";

// One real testnet inference. PRIVATE_KEY in .env must be funded
// (the testnet faucet at https://lightfaucet.ai gives free LCAI).
const verdict = await workerPreflight({
  network: "testnet",
  privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
  model: "llama3-8b",
  deadlineMs: 60_000,
});
console.log("verdict       :", verdict.verdict);
console.log("worker        :", verdict.worker ?? "(none assigned)");
console.log("job id        :", verdict.jobId?.toString() ?? "(no job)");
console.log("submit -> done:", verdict.elapsedMs, "ms");

// Read top mainnet workers (no key required for the read side):
const ln = new LightNode("mainnet");
const top = await ln.getWorkerStats(500, 5);
console.log("\\nTop 5 mainnet workers (last 500 jobs):");
for (const w of top) console.log(w.address, "  jobs:", w.jobsCompleted, "  p50:", w.p50ProcessingSecs, "s");`,
    sandboxNeedsKey: true,
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
    sandboxBody: `import { LightNode } from "lightnode-sdk";

const ln = new LightNode("mainnet");

// Walk a small range and classify each job. No PRIVATE_KEY needed; this
// is a pure read against the subgraph + chain.
const FIRST = 1n, LAST = 10n;
for (let id = FIRST; id <= LAST; id++) {
  const s = await ln.getJobStatus(id);
  if (!s) {
    console.log(id.toString().padStart(4), "  not found (yet)");
    continue;
  }
  console.log(
    id.toString().padStart(4),
    s.category.padEnd(10),
    "refundable=" + s.refundable,
    "  worker=" + (s.worker?.slice(0, 8) ?? "(none)") + "...",
  );
}`,
    sandboxNeedsKey: false,
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
    sandboxBody: `import { LightNode } from "lightnode-sdk";

const ln = new LightNode("mainnet");

console.log("All whitelisted models on mainnet AIConfig:\\n");
const models = await ln.getModels();
for (const m of models) {
  console.log(
    m.name.padEnd(20),
    "fee=" + m.fee.padStart(10),
    "max_out=" + m.max_output_tokens.toString().padStart(6),
    "whitelisted=" + m.is_whitelisted,
  );
}

// On-chain fee for one model + its computed id:
const tag = "llama3-8b";
const feeLcai = await ln.estimateFee(tag);
const id = ln.modelId(tag);
console.log("\\nestimateFee('" + tag + "') = " + feeLcai + " LCAI");
console.log("modelId('" + tag + "')     = " + id);`,
    sandboxNeedsKey: false,
    triable: true,
  },
];
