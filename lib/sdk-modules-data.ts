/**
 * Server-safe data for the SDK modules surfaced on /build/sdks and on
 * the dedicated /build/sdks/<id> sub-pages. Lives in /lib (no "use client")
 * so server components can import MODULES at static-generation time.
 *
 * The interactive widgets that render this data live in
 * components/sdk-modules.tsx (which IS "use client"). That file re-exports
 * MODULES / ModuleDef / ModuleId from here so existing callers keep working.
 */
import { Boxes, Coins, Database, ShieldCheck, Wrench, Workflow } from "lucide-react";

export type ModuleId =
  | "bridge"
  | "dao"
  | "chat"
  | "inference"
  | "operator";

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
   * page. Large on desktop, stacked below copy on mobile. Path is relative
   * to /public.
   */
  heroImage?: string;
  /**
   * Short, punchy hero line for the sub-page. One sentence that captures
   * what the module does at the highest level. Falls back to the first
   * sentence of `blurb` when omitted.
   */
  tagline?: string;
  /**
   * Supporting paragraph under the tagline on the sub-page. One or two
   * short sentences that give the next layer of context without diving
   * into protocol jargon. Falls back to the rest of `blurb` when omitted.
   */
  subtitle?: string;
  /**
   * Substring of `title` that should render in the brand magenta-to-purple
   * gradient on the sub-page hero. The rest of the title stays in body
   * color. Mirrors the 'Lightchain DAO' treatment where one word carries
   * the brand mark.
   */
  titleAccent?: string;
  /**
   * Small caps eyebrow shown just under the big hero title (kicker style).
   * One short phrase, ideally two words. Falls back to 'lightnode-sdk'.
   */
  kicker?: string;
  /**
   * Optional primary CTA for the hero. Anchor links inside the page
   * (eg #try-it) jump to the widget; external links open in a new tab.
   */
  cta?: { label: string; href: string };
  /**
   * Optional 'Add this to your project' scaffolds surfaced below the widget.
   * Each entry is one of the two architectures:
   *   - server: dev's PRIVATE_KEY pays per call. SaaS chatbot / internal tool
   *     pattern. Writes a route + a Dockerfile + the hosting guide.
   *   - browser: each visitor's wallet pays per call. Web3 dApp pattern. Writes
   *     a React component only - no backend, no .env.
   * Modules without a meaningful scaffolder (bridge / dao / operator are not
   * 'drop into your project' shapes) leave this undefined.
   */
  scaffolds?: ScaffoldDef[];
}

/**
 * One 'Add this to your project' card. Renders as a copy-the-command CTA.
 */
export interface ScaffoldDef {
  /** Stable id. */
  id: string;
  /** 'server' = dev pays; 'browser' = user pays. Drives the icon + accent. */
  kind: "server" | "browser";
  /** Short, punchy title (3-5 words). */
  title: string;
  /** One-line description for the card body. */
  blurb: string;
  /** The exact command the visitor copies. */
  command: string;
  /** Optional one-line prerequisite shown above the command (e.g. that the
   *  browser/web3 scaffolds must be run inside a Next.js app). */
  prereq?: string;
  /** Bullet list of what the scaffold drops into the project. */
  includes: string[];
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
    heroImage: "/images/sdk/bridge-hero.svg",
    tagline: "Move LCAI between chains. From your code.",
    subtitle:
      "Bridge from Ethereum to LightChain - and back - in three lines. No separate UI, no detour through a hosted page.",
    titleAccent: "SDK",
    kicker: "Developer SDK",
    cta: { label: "Try the Bridge", href: "#try-it" },
    triable: true,
  },
  {
    id: "dao",
    icon: ShieldCheck,
    title: "DAO SDK",
    blurb:
      "Read + vote on LCAI Governor proposals on Ethereum. Real OZ Governor v5 wrapper. Cast votes, propose, queue, execute.",
    heroImage: "/images/sdk/dao-hero.svg",
    tagline: "Govern LCAI from your app.",
    subtitle:
      "Read proposals, cast votes, queue and execute - directly from your Next.js or Node code. A typed wrapper around OZ Governor v5.",
    titleAccent: "SDK",
    kicker: "LCAI Governor",
    cta: { label: "View proposals", href: "#try-it" },
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
const rows = await dao.recentProposals({ lookbackBlocks: 300_000, limit: 5 });
for (const p of rows) {
  console.log(p.id.toString(), p.stateLabel.padEnd(10), p.title);
}

// Live voting config (delay / period / threshold):
const cfg = await dao.config();
console.log("\\nVoting delay :", cfg.votingDelayBlocks.toString(), "blocks");
console.log("Voting period:", cfg.votingPeriodBlocks.toString(), "blocks (~", Math.round(cfg.votingPeriodSecs / 86400), "days)");

// Predict the proposal id for a *new* proposal BEFORE submitting it.
// Useful for two-step UIs that want to surface the id ahead of time.
const sample = await dao.hashProposal({
  targets: ["0x0000000000000000000000000000000000000000"],
  values: [0n],
  calldatas: ["0x"],
  description: "Sample proposal",
});
console.log("\\nPredicted proposal id for the sample:", sample.toString());

// Looking up voting weight requires the IVotes wrapper (LCAIBallots).
// Replace the address with your own to see your wrapped balance + delegate.
const WHO = "0x0000000000000000000000000000000000000001" as const;
const [balance, delegateTo] = await Promise.all([
  dao.getBallotsBalance(WHO).catch(() => 0n),
  dao.getDelegate(WHO).catch(() => "0x0000000000000000000000000000000000000000" as const),
]);
console.log("\\nBallots balance for", WHO, "=", balance.toString());
console.log("delegated to            =", delegateTo);

// To vote (needs PRIVATE_KEY + a delegated Ballots balance):
//   import { VoteSupport } from "lightnode-sdk";
//   await dao.delegate(yourAddress);            // self-delegate first
//   await dao.castVote(rows[0].id, VoteSupport.For, "support this");`,
    sandboxNeedsKey: false,
    triable: true,
  },
  {
    id: "chat",
    icon: Workflow,
    title: "Chat SDK",
    blurb:
      "Drop a real chatbot into your project. new Conversation({ network, privateKey }).send('hi') keeps history client-side and runs one encrypted inference per turn. Optional system prompt, maxHistoryTurns cap, and tool calls via the Agent helper for ReAct-style loops.",
    titleAccent: "SDK",
    kicker: "Chatbot, agent, tools",
    tagline: "Add a chatbot to your project.",
    subtitle:
      "Conversation handles history, system prompts, and one encrypted inference per turn. Add the Agent helper for tool-calling (ReAct) loops. Drop into Node, Next.js, or React with a single import.",
    heroImage: "/images/sdk/chat-hero.svg",
    cta: { label: "Try the chat", href: "#try-it" },
    npm: "#five-line-hello-world",
    github: "https://github.com/marinom2/lightnode/blob/main/sdk/src/chat.ts",
    example: "https://github.com/marinom2/lightnode-examples/tree/main/multi-turn-chat",
    snippet: `import { Conversation } from "lightnode-sdk";

const chat = new Conversation({
  network: "mainnet",          // testnet dispatcher currently broken upstream
  privateKey: process.env.PRIVATE_KEY,
  system: "You are a concise assistant.",
  maxHistoryTurns: 20,
});

await chat.send("Who wrote The Great Gatsby?");
await chat.send("In what year?");      // sees prior turn
chat.messages();                       // full transcript`,
    sandboxBody: `import { Conversation } from "lightnode-sdk";

// Targets mainnet because the testnet dispatcher is currently returning
// 409 selection_mismatch on every prepareSession call (reproduced upstream;
// not a client bug). Mainnet fee for llama3-8b is 0.02 LCAI per turn.
const chat = new Conversation({
  network: "mainnet",
  privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
  model: "llama3-8b",
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
    scaffolds: [
      {
        id: "chat",
        kind: "server",
        title: "Server-paid chat",
        blurb: "Your funded wallet pays for every visitor's turn. Users never touch a wallet. SaaS chatbot pattern.",
        command: "npx lightnode-sdk@latest add chat",
        prereq: "Needs a funded wallet (PRIVATE_KEY in .env). Detects Next.js / Hono / Node.",
        includes: [
          "app/chat/page.tsx (streaming UI)",
          "app/api/inference/route.ts (streaming route)",
          "Dockerfile + docker-compose.yml",
          "LIGHTNODE-HOSTING.md",
          ".env.example for PRIVATE_KEY",
        ],
      },
      {
        id: "chat-web3",
        kind: "browser",
        title: "User-paid chat",
        blurb: "Each visitor signs from their own wallet. No backend, no PRIVATE_KEY, no per-call cost for you. Web3 dApp pattern.",
        command: "npx lightnode-sdk@latest add chat-web3",
        prereq: "Run in an empty folder or an existing Next.js app - it scaffolds, wires, and installs as needed.",
        includes: [
          "app/chat-web3/page.tsx with a wired Connect button",
          "wagmi config + providers + layout wired for you",
          "Each turn: one SIWE sign-in + createSession + submitJob on-chain",
          "Scaffolds Next.js + installs deps when missing",
          "No backend, no .env, scales infinitely",
        ],
      },
    ],
  },
  {
    id: "inference",
    icon: Boxes,
    title: "Inference SDK",
    blurb:
      "Send a prompt to LightChain AI (AIVM) and get an answer back plus an on-chain submitJob + jobCompleted tx that anyone can verify. The exact pattern LightChallenge uses to AI-judge whether a challenge is complete. Same import covers one-shot inference, parallel fan-out, CI preflight, and an on-chain read of the model registry.",
    titleAccent: "Inference",
    kicker: "AIVM + verifiable answers",
    tagline: "Verifiable AI in your project.",
    subtitle:
      "Each call returns the answer plus on-chain proof. Drop in for judging, scoring, classification, generation, evaluators - anything where you want a verifiable answer. Single-shot, batched fan-out, or CI preflight from one import.",
    heroImage: "/images/sdk/sdk-hero.svg",
    cta: { label: "Try a live inference", href: "#try-it" },
    npm: "#inference",
    github: "https://github.com/marinom2/lightnode/blob/main/sdk/src/inference.ts",
    example: "https://github.com/marinom2/lightnode-examples/tree/main/inference",
    snippet: `import { runInferenceWithKey } from "lightnode-sdk";

// One inference. Returns the answer + tx hashes you can put on a receipt.
const { answer, worker, txs } = await runInferenceWithKey({
  network: "mainnet",
  privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
  model: "llama3-8b",
  prompt: "Reply STRICT JSON: { passed: boolean, confidence: number }",
});

console.log(answer);             // model output
console.log(worker, txs.submitJob, txs.jobCompleted);  // on-chain proof`,
    sandboxBody: `import { runInferenceWithKey, LightNode } from "lightnode-sdk";

const ln = new LightNode("mainnet");

// The 'judge' pattern used by LightChallenge to grade a submission.
// Same shape works for NFT trait extraction, meme-coin sentiment,
// content moderation, automated grading - anything where you want a
// verifiable answer with on-chain proof.
const { answer, worker, txs, jobId } = await runInferenceWithKey({
  network: "mainnet",
  privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
  model: "llama3-8b",
  system: "You are a careful judge. Reply with STRICT JSON only.",
  prompt: \`Did the user complete the challenge "Run a mile under 8 minutes"?

Evidence: { distance_km: 1.61, time_minutes: 7.4 }

Reply: { "passed": boolean, "confidence": 0-1, "reason": string }\`,
});

console.log("\\nanswer       :", answer);
console.log("job id       :", jobId.toString());
console.log("worker       :", worker);
console.log("submitJob tx :", ln.explorerTxUrl(txs.submitJob));
console.log("completed tx :", ln.explorerTxUrl(txs.jobCompleted));`,
    sandboxNeedsKey: true,
    triable: true,
    scaffolds: [
      {
        id: "inference",
        kind: "server",
        title: "Server-paid inference",
        blurb: "Your funded wallet pays per call. POST a prompt, get the answer + on-chain proof. Same shape for classify, generate, evaluate.",
        command: "npx lightnode-sdk@latest add inference",
        prereq: "Needs a funded wallet (PRIVATE_KEY in .env). Detects Next.js / Hono / Node.",
        includes: [
          "app/api/inference/route.ts",
          "Dockerfile + docker-compose.yml",
          "LIGHTNODE-HOSTING.md",
          ".env.example for PRIVATE_KEY",
        ],
      },
      {
        id: "inference-web3",
        kind: "browser",
        title: "User-paid inference",
        blurb: "Each visitor's wallet pays per call. One-shot inference UI with on-chain receipts. No backend.",
        command: "npx lightnode-sdk@latest add inference-web3",
        prereq: "Run in an empty folder or an existing Next.js app - it scaffolds, wires, and installs as needed.",
        includes: [
          "app/inference-web3/page.tsx with a wired Connect button",
          "wagmi config + providers + layout wired for you",
          "Worker / submitJob / jobCompleted links",
          "Scaffolds Next.js + installs deps when missing",
          "No backend, no .env",
        ],
      },
      {
        id: "judge",
        kind: "server",
        title: "Server-paid AI judge",
        blurb: "The LightChallenge pattern. Post criteria + evidence, get structured pass/fail/confidence + on-chain proof.",
        command: "npx lightnode-sdk@latest add judge",
        prereq: "Needs a funded wallet (PRIVATE_KEY in .env). Detects Next.js / Hono / Node.",
        includes: [
          "app/api/judge/route.ts (POST verdict)",
          "Defensive JSON parsing (model adds prose? still works)",
          "Dockerfile + hosting guide",
          ".env.example for PRIVATE_KEY",
        ],
      },
      {
        id: "judge-web3",
        kind: "browser",
        title: "User-paid AI judge",
        blurb: "Same judge pattern, the user pays for their own verdict. Fits challenge completion grading, NFT trait verification, content moderation.",
        command: "npx lightnode-sdk@latest add judge-web3",
        prereq: "Run in an empty folder or an existing Next.js app - it scaffolds, wires, and installs as needed.",
        includes: [
          "app/judge-web3/page.tsx with a wired Connect button",
          "wagmi config + providers + layout wired for you",
          "PASSED / FAILED badge + confidence + reason",
          "On-chain receipt every submission",
          "Scaffolds Next.js + installs deps when missing",
        ],
      },
    ],
  },
  {
    id: "operator",
    icon: Wrench,
    title: "Worker SDK",
    blurb:
      "Everything a worker needs from code: register and stake, settle and withdraw earnings, classify any job for refunds, and the stuck-job recovery (claimTimeout / clearStuck / unstickAndDeregister) that clears acknowledged-but-unfinished jobs blocking deregister. Plain RPC, no Docker, no worker image. decodeWorkerError turns unverified custom reverts into plain English.",
    titleAccent: "SDK",
    kicker: "Worker lifecycle",
    tagline: "Run a worker from code.",
    subtitle:
      "Register, stake, settle, withdraw, classify any job for refunds, and exit cleanly - even when stuck jobs block the door. Reads are key-less; writes sign with your worker key.",
    cta: { label: "See it work", href: "#try-it" },
    npm: "#worker-operator-new-in-070",
    github: "https://github.com/marinom2/lightnode/blob/main/sdk/src/worker-operator.ts",
    snippet: `import { WorkerOperator } from "lightnode-sdk";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const chain = { id: 8200, name: "LC Testnet",
  nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.lightchain.ai"] } } };
const publicClient = createPublicClient({ transport: http(chain.rpcUrls.default.http[0]), chain });
const walletClient = createWalletClient({ account: privateKeyToAccount("0x..."), transport: http(chain.rpcUrls.default.http[0]), chain });

const op = new WorkerOperator("testnet", { publicClient, walletClient });

await op.status();                            // registration, stake, claimable
await op.canDeregister(jobIds);               // what blocks the exit, no tx
await op.unstickAndDeregister(jobIds);        // clear stuck + settle + withdraw + deregister`,
    // Read-only sandbox: status + config + canDeregister against a live worker.
    // Deliberately does NOT call any write method - a public sandbox must never
    // broadcast a state-changing (and on mainnet slash-realizing) tx.
    sandboxBody: `import { WorkerOperator } from "lightnode-sdk";
import { createPublicClient, http } from "viem";

const chain = { id: 8200, name: "LC Testnet",
  nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.lightchain.ai"] } } };
const publicClient = createPublicClient({ transport: http(chain.rpcUrls.default.http[0]), chain });

// Read-only: a worker address is all you need (no key) for status + config.
const worker = "0xbe1cDe9b44A7f48de5e6076AE20f2356bbc28FC2"; // any registered testnet worker
const op = new WorkerOperator("testnet", { publicClient, workerAddress: worker });

const st = await op.status();
console.log("registered :", st.registered);
console.log("stake LCAI :", st.stakeLcai);
console.log("claimable  :", st.claimableLcai, "LCAI");

const cfg = await op.config();
console.log("\\nmin stake  :", cfg.minStakeLcai, "LCAI");
console.log("completion :", cfg.completionTimeoutSec, "s");
console.log("slash bps  :", JSON.stringify(cfg.slashBps));`,
    sandboxNeedsKey: false,
    triable: false,
  },
];
