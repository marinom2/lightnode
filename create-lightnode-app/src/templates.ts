/**
 * Template strings written into the scaffolded project. Kept as plain literals
 * (no string interpolation off external sources) so the generated files are
 * easy to diff against the runnable examples in marinom2/lightnode-examples.
 */

export interface ProjectConfig {
  projectName: string;
  template: "node" | "nextjs-api" | "hono";
  network: "testnet" | "mainnet";
}

export interface GeneratedFile {
  path: string;
  contents: string;
}

const SDK_VERSION = "^0.4.3";
const VIEM_VERSION = "^2.21.0";
const WS_VERSION = "^8.18.0";
const HONO_VERSION = "^4.6.0";

const SHARED_GITIGNORE = `node_modules
dist
.env
.env.local
.next
.DS_Store
*.log
`;

const SHARED_ENV_EXAMPLE = (network: string) => `# Funded private key. Testnet works for free (faucet at https://lightfaucet.ai).
PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000

NETWORK=${network}
MODEL=llama3-8b
`;

// ---- Node CLI starter ------------------------------------------------------

const NODE_INDEX = `/**
 * End-to-end encrypted LightChain AI inference - one call, prints the answer.
 * Run:  npm start "your prompt here"
 */
import WS from "ws";
import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, parseEther, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  LightNode, prepareSession, submitPrompt, decryptResponse,
  estimateJobFee, consumerGatewayUrl, JOB_REGISTRY_CONSUMER_ABI,
  GatewayClient, type NetworkId,
} from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "testnet") as NetworkId;
const MODEL = process.env.MODEL ?? "llama3-8b";
const PROMPT = process.argv.slice(2).join(" ").trim() || "Reply with a one-sentence fun fact.";
const PRIVATE_KEY = process.env.PRIVATE_KEY as \`0x\${string}\` | undefined;
if (!PRIVATE_KEY?.startsWith("0x") || PRIVATE_KEY.length !== 66) {
  console.error("set PRIVATE_KEY in .env");
  process.exit(1);
}

const ln = new LightNode(NETWORK);
const cfg = ln.network;
const acct = privateKeyToAccount(PRIVATE_KEY);
const chain = { id: cfg.chainId, name: cfg.label, nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } };
const pub = createPublicClient({ transport: http(cfg.rpc), chain });
const wal = createWalletClient({ account: acct, transport: http(cfg.rpc), chain });
const abi = parseAbi(JOB_REGISTRY_CONSUMER_ABI);

const ch = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/challenge?address=\${acct.address}\`)).json() as { message?: string };
if (!ch.message) throw new Error("auth challenge failed");
const sig = await wal.signMessage({ message: ch.message });
const verify = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/verify\`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: ch.message, signature: sig }) })).json() as { token?: string };
if (!verify.token) throw new Error("auth verify failed");
const gateway = new GatewayClient({ network: NETWORK, bearer: verify.token });

const { sessionKey, createSessionArgs } = await prepareSession(gateway, MODEL);
const fee = await estimateJobFee(cfg, MODEL);
const createTx = await wal.writeContract({
  address: cfg.jobRegistry as \`0x\${string}\`, abi, functionName: "createSession",
  args: [createSessionArgs.paramsHash, createSessionArgs.worker, createSessionArgs.encWorkerKey, createSessionArgs.ephemeralPubKey, createSessionArgs.initState, createSessionArgs.expiry],
  gas: 1_000_000n,
});
const createReceipt = await pub.waitForTransactionReceipt({ hash: createTx });
const sessionCreated = parseAbiItem("event SessionCreated(uint256 indexed sessionId, address indexed user, bytes32 indexed paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey)");
const sessionLog = (await pub.getLogs({ address: cfg.jobRegistry as \`0x\${string}\`, event: sessionCreated, blockHash: createReceipt.blockHash })).find((l) => l.transactionHash === createTx);
if (!sessionLog?.args.sessionId) throw new Error("SessionCreated missing");
const sessionId = sessionLog.args.sessionId;

let relayToken: string | undefined;
for (let i = 0; i < 30 && !relayToken; i++) {
  const r = await gateway.getSessionToken(Number(sessionId));
  if ("token" in r && r.token) relayToken = r.token; else await new Promise((res) => setTimeout(res, 1000));
}
if (!relayToken) throw new Error("relay token never became ready");
const ws = new WS(\`wss://relay.\${NETWORK}.lightchain.ai/ws?token=\${encodeURIComponent(relayToken)}\`);
const chunks: string[] = [];
await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
ws.on("message", async (data: Buffer) => {
  let f: { type?: string; payload?: string };
  try { f = JSON.parse(data.toString("utf8")); } catch { return; }
  if (!f.payload) return;
  if (f.type === "chunk") { try { chunks.push(await decryptResponse(sessionKey, f.payload)); } catch {} }
  else if (f.type === "complete" && chunks.length === 0) { try { chunks.push(await decryptResponse(sessionKey, f.payload)); } catch {} }
});

const promptHash = await submitPrompt(gateway, sessionKey, PROMPT);
const submitTx = await wal.writeContract({
  address: cfg.jobRegistry as \`0x\${string}\`, abi, functionName: "submitJob",
  args: [sessionId, promptHash], value: parseEther(String(fee)), gas: 500_000n,
});
const submitReceipt = await pub.waitForTransactionReceipt({ hash: submitTx });
const jobSubmitted = parseAbiItem("event JobSubmitted(uint256 indexed jobId, uint256 indexed sessionId, address worker)");
const jobLog = (await pub.getLogs({ address: cfg.jobRegistry as \`0x\${string}\`, event: jobSubmitted, blockHash: submitReceipt.blockHash })).find((l) => l.transactionHash === submitTx);
const jobId = jobLog?.args.jobId;
if (!jobId) throw new Error("JobSubmitted missing");

const jobCompleted = parseAbiItem("event JobCompleted(uint256 indexed jobId, address indexed worker, bytes32 responseHash, bytes32 ciphertextHash)");
const deadline = Date.now() + 90_000;
let completed: Log | null = null;
while (!completed && Date.now() < deadline) {
  await new Promise((res) => setTimeout(res, 3000));
  const logs = await pub.getLogs({ address: cfg.jobRegistry as \`0x\${string}\`, event: jobCompleted, args: { jobId }, fromBlock: submitReceipt.blockNumber });
  if (logs.length) completed = logs[0] as Log;
}
if (!completed) { console.error("worker stalled - protocol refunds after dispute window; re-run"); process.exit(1); }
await new Promise((res) => setTimeout(res, 4000));
ws.close();

console.log("\\n=== ANSWER ===\\n" + chunks.join("") + "\\n");
console.log("createSession:", createTx);
console.log("submitJob:    ", submitTx);
console.log("jobCompleted: ", completed.transactionHash);
process.exit(0);
`;

const NODE_PACKAGE_JSON = (cfg: ProjectConfig) => `{
  "name": "${cfg.projectName}",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "tsx index.ts"
  },
  "dependencies": {
    "lightnode-sdk": "${SDK_VERSION}",
    "viem": "${VIEM_VERSION}",
    "ws": "${WS_VERSION}"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  },
  "engines": { "node": ">=18" }
}
`;

const NODE_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["./*.ts"]
}
`;

const NODE_README = (cfg: ProjectConfig) => `# ${cfg.projectName}

End-to-end encrypted LightChain AI inference using \`lightnode-sdk\`.
Generated by \`create-lightnode-app\`.

## Run it

\`\`\`bash
npm install
cp .env.example .env
# put a funded ${cfg.network} private key into .env

npm start "What is the colour of the sky?"
\`\`\`

Cost: ~0.022 LCAI per call (mainnet) / free on testnet (faucet at <https://lightfaucet.ai>).

## Next

- Live in-browser playground: <https://lightnode.app/playground>
- Builder docs + SDK reference: <https://lightnode.app/build>
- Source: <https://www.npmjs.com/package/lightnode-sdk>
`;

// ---- Next.js API route starter --------------------------------------------

const NEXTJS_ROUTE = `// app/api/inference/route.ts
import { NextResponse } from "next/server";
import WS from "ws";
import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, parseEther, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  LightNode, prepareSession, submitPrompt, decryptResponse,
  estimateJobFee, consumerGatewayUrl, JOB_REGISTRY_CONSUMER_ABI,
  GatewayClient, type NetworkId,
} from "lightnode-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NETWORK = (process.env.NETWORK ?? "testnet") as NetworkId;
const MODEL = process.env.MODEL ?? "llama3-8b";

export async function POST(req: Request) {
  if (!process.env.PRIVATE_KEY?.startsWith("0x")) {
    return NextResponse.json({ error: "PRIVATE_KEY not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { prompt?: string };
  const prompt = body.prompt?.trim();
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  const ln = new LightNode(NETWORK);
  const cfg = ln.network;
  const acct = privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`);
  const chain = { id: cfg.chainId, name: cfg.label, nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } };
  const pub = createPublicClient({ transport: http(cfg.rpc), chain });
  const wal = createWalletClient({ account: acct, transport: http(cfg.rpc), chain });
  const abi = parseAbi(JOB_REGISTRY_CONSUMER_ABI);

  const ch = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/challenge?address=\${acct.address}\`)).json() as { message?: string };
  if (!ch.message) return NextResponse.json({ error: "auth challenge failed" }, { status: 502 });
  const sig = await wal.signMessage({ message: ch.message });
  const verify = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/verify\`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: ch.message, signature: sig }),
  })).json() as { token?: string };
  if (!verify.token) return NextResponse.json({ error: "auth verify failed" }, { status: 502 });

  const gateway = new GatewayClient({ network: NETWORK, bearer: verify.token });
  const { sessionKey, createSessionArgs } = await prepareSession(gateway, MODEL);
  const fee = await estimateJobFee(cfg, MODEL);
  const createTx = await wal.writeContract({
    address: cfg.jobRegistry as \`0x\${string}\`, abi, functionName: "createSession",
    args: [createSessionArgs.paramsHash, createSessionArgs.worker, createSessionArgs.encWorkerKey, createSessionArgs.ephemeralPubKey, createSessionArgs.initState, createSessionArgs.expiry],
    gas: 1_000_000n,
  });
  const createReceipt = await pub.waitForTransactionReceipt({ hash: createTx });
  const sessionCreated = parseAbiItem("event SessionCreated(uint256 indexed sessionId, address indexed user, bytes32 indexed paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey)");
  const sessionLog = (await pub.getLogs({ address: cfg.jobRegistry as \`0x\${string}\`, event: sessionCreated, blockHash: createReceipt.blockHash })).find((l) => l.transactionHash === createTx);
  const sessionId = sessionLog?.args.sessionId;
  if (!sessionId) return NextResponse.json({ error: "SessionCreated missing" }, { status: 500 });

  let relayToken: string | undefined;
  for (let i = 0; i < 30 && !relayToken; i++) {
    const r = await gateway.getSessionToken(Number(sessionId));
    if ("token" in r && r.token) relayToken = r.token; else await new Promise((res) => setTimeout(res, 1000));
  }
  if (!relayToken) return NextResponse.json({ error: "relay token never became ready" }, { status: 504 });
  const ws = new WS(\`wss://relay.\${NETWORK}.lightchain.ai/ws?token=\${encodeURIComponent(relayToken)}\`);
  const chunks: string[] = [];
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
  ws.on("message", async (data: Buffer) => {
    let f: { type?: string; payload?: string };
    try { f = JSON.parse(data.toString("utf8")); } catch { return; }
    if (!f.payload) return;
    if (f.type === "chunk") { try { chunks.push(await decryptResponse(sessionKey, f.payload)); } catch {} }
    else if (f.type === "complete" && chunks.length === 0) { try { chunks.push(await decryptResponse(sessionKey, f.payload)); } catch {} }
  });

  const promptHash = await submitPrompt(gateway, sessionKey, prompt);
  const submitTx = await wal.writeContract({
    address: cfg.jobRegistry as \`0x\${string}\`, abi, functionName: "submitJob",
    args: [sessionId, promptHash], value: parseEther(String(fee)), gas: 500_000n,
  });
  const submitReceipt = await pub.waitForTransactionReceipt({ hash: submitTx });
  const jobSubmitted = parseAbiItem("event JobSubmitted(uint256 indexed jobId, uint256 indexed sessionId, address worker)");
  const jobLog = (await pub.getLogs({ address: cfg.jobRegistry as \`0x\${string}\`, event: jobSubmitted, blockHash: submitReceipt.blockHash })).find((l) => l.transactionHash === submitTx);
  const jobId = jobLog?.args.jobId;
  if (!jobId) return NextResponse.json({ error: "JobSubmitted missing" }, { status: 500 });

  const jobCompleted = parseAbiItem("event JobCompleted(uint256 indexed jobId, address indexed worker, bytes32 responseHash, bytes32 ciphertextHash)");
  const deadline = Date.now() + 90_000;
  let completed: Log | null = null;
  while (!completed && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 3000));
    const logs = await pub.getLogs({ address: cfg.jobRegistry as \`0x\${string}\`, event: jobCompleted, args: { jobId }, fromBlock: submitReceipt.blockNumber });
    if (logs.length) completed = logs[0] as Log;
  }
  await new Promise((res) => setTimeout(res, 4000));
  ws.close();
  if (!completed) return NextResponse.json({ error: "worker stalled", txs: { createSession: createTx, submitJob: submitTx } }, { status: 504 });

  return NextResponse.json({
    answer: chunks.join(""),
    txs: { createSession: createTx, submitJob: submitTx, jobCompleted: completed.transactionHash },
    sessionId: sessionId.toString(),
    jobId: jobId.toString(),
    worker: createSessionArgs.worker,
  });
}
`;

const NEXTJS_PACKAGE_JSON = (cfg: ProjectConfig) => `{
  "name": "${cfg.projectName}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "lightnode-sdk": "${SDK_VERSION}",
    "viem": "${VIEM_VERSION}",
    "ws": "${WS_VERSION}"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/ws": "^8.5.0",
    "typescript": "^5.6.0"
  }
}
`;

const NEXTJS_LAYOUT = `export const metadata = { title: "${"$"}{projectName}", description: "LightChain AI inference dApp" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
`;

const NEXTJS_PAGE = `"use client";
import { useState } from "react";

export default function Home() {
  const [prompt, setPrompt] = useState("Reply with a one-sentence fun fact about the ocean.");
  const [answer, setAnswer] = useState("");
  const [running, setRunning] = useState(false);
  return (
    <main style={{ maxWidth: 700, margin: "60px auto", padding: 20, fontFamily: "system-ui" }}>
      <h1>LightChain AI inference</h1>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} style={{ width: "100%", padding: 10, fontSize: 14 }} />
      <button
        disabled={running}
        onClick={async () => {
          setRunning(true);
          setAnswer("");
          try {
            const r = await fetch("/api/inference", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) }).then((r) => r.json());
            setAnswer(r.answer ?? JSON.stringify(r, null, 2));
          } catch (e) {
            setAnswer(\`error: \${(e as Error).message}\`);
          } finally {
            setRunning(false);
          }
        }}
        style={{ marginTop: 12, padding: "10px 20px", fontSize: 14 }}
      >
        {running ? "Running..." : "Run inference"}
      </button>
      {answer && <pre style={{ marginTop: 20, padding: 16, background: "#eee", whiteSpace: "pre-wrap" }}>{answer}</pre>}
    </main>
  );
}
`;

const NEXTJS_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

const NEXTJS_NEXT_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
`;

const NEXTJS_README = (cfg: ProjectConfig) => `# ${cfg.projectName}

Next.js dApp with one-click LightChain AI inference. Generated by \`create-lightnode-app\`.

## Run it

\`\`\`bash
npm install
cp .env.example .env
# put a funded ${cfg.network} private key into .env

npm run dev
# open http://localhost:3000
\`\`\`

Hit the Run inference button. The browser POSTs to \`/api/inference\` which runs
the end-to-end encrypted flow server-side (your wallet stays on the server).

## File map

| File | What |
| --- | --- |
| \`app/page.tsx\` | The UI - textarea + button. |
| \`app/api/inference/route.ts\` | The end-to-end flow. POST { prompt } -> { answer, txs }. |
| \`.env.example\` | Set PRIVATE_KEY here. |

## Next

- Live in-browser playground: <https://lightnode.app/playground>
- Builder docs: <https://lightnode.app/build>
- SDK reference: <https://www.npmjs.com/package/lightnode-sdk>
`;

// ---- Hono server starter --------------------------------------------------

const HONO_SERVER = `import { Hono } from "hono";
import { serve } from "@hono/node-server";
import WS from "ws";
import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, parseEther, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  LightNode, prepareSession, submitPrompt, decryptResponse,
  estimateJobFee, consumerGatewayUrl, JOB_REGISTRY_CONSUMER_ABI,
  GatewayClient, type NetworkId,
} from "lightnode-sdk";

const app = new Hono();
const NETWORK = (process.env.NETWORK ?? "testnet") as NetworkId;
const MODEL = process.env.MODEL ?? "llama3-8b";

app.post("/inference", async (c) => {
  if (!process.env.PRIVATE_KEY?.startsWith("0x")) return c.json({ error: "PRIVATE_KEY not set" }, 500);
  const body = await c.req.json().catch(() => ({} as { prompt?: string }));
  const prompt = body.prompt?.trim();
  if (!prompt) return c.json({ error: "prompt is required" }, 400);

  const ln = new LightNode(NETWORK);
  const cfg = ln.network;
  const acct = privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`);
  const chain = { id: cfg.chainId, name: cfg.label, nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } };
  const pub = createPublicClient({ transport: http(cfg.rpc), chain });
  const wal = createWalletClient({ account: acct, transport: http(cfg.rpc), chain });
  const abi = parseAbi(JOB_REGISTRY_CONSUMER_ABI);

  const ch = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/challenge?address=\${acct.address}\`)).json() as { message?: string };
  if (!ch.message) return c.json({ error: "auth challenge failed" }, 502);
  const sig = await wal.signMessage({ message: ch.message });
  const verify = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/verify\`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: ch.message, signature: sig }) })).json() as { token?: string };
  if (!verify.token) return c.json({ error: "auth verify failed" }, 502);
  const gateway = new GatewayClient({ network: NETWORK, bearer: verify.token });

  const { sessionKey, createSessionArgs } = await prepareSession(gateway, MODEL);
  const fee = await estimateJobFee(cfg, MODEL);
  const createTx = await wal.writeContract({
    address: cfg.jobRegistry as \`0x\${string}\`, abi, functionName: "createSession",
    args: [createSessionArgs.paramsHash, createSessionArgs.worker, createSessionArgs.encWorkerKey, createSessionArgs.ephemeralPubKey, createSessionArgs.initState, createSessionArgs.expiry],
    gas: 1_000_000n,
  });
  const createReceipt = await pub.waitForTransactionReceipt({ hash: createTx });
  const sessionCreated = parseAbiItem("event SessionCreated(uint256 indexed sessionId, address indexed user, bytes32 indexed paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey)");
  const sessionLog = (await pub.getLogs({ address: cfg.jobRegistry as \`0x\${string}\`, event: sessionCreated, blockHash: createReceipt.blockHash })).find((l) => l.transactionHash === createTx);
  const sessionId = sessionLog?.args.sessionId;
  if (!sessionId) return c.json({ error: "SessionCreated missing" }, 500);

  let relayToken: string | undefined;
  for (let i = 0; i < 30 && !relayToken; i++) { const r = await gateway.getSessionToken(Number(sessionId)); if ("token" in r && r.token) relayToken = r.token; else await new Promise((res) => setTimeout(res, 1000)); }
  if (!relayToken) return c.json({ error: "relay token never became ready" }, 504);
  const ws = new WS(\`wss://relay.\${NETWORK}.lightchain.ai/ws?token=\${encodeURIComponent(relayToken)}\`);
  const chunks: string[] = [];
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
  ws.on("message", async (data: Buffer) => {
    let f: { type?: string; payload?: string };
    try { f = JSON.parse(data.toString("utf8")); } catch { return; }
    if (!f.payload) return;
    if (f.type === "chunk") { try { chunks.push(await decryptResponse(sessionKey, f.payload)); } catch {} }
    else if (f.type === "complete" && chunks.length === 0) { try { chunks.push(await decryptResponse(sessionKey, f.payload)); } catch {} }
  });

  const promptHash = await submitPrompt(gateway, sessionKey, prompt);
  const submitTx = await wal.writeContract({
    address: cfg.jobRegistry as \`0x\${string}\`, abi, functionName: "submitJob",
    args: [sessionId, promptHash], value: parseEther(String(fee)), gas: 500_000n,
  });
  const submitReceipt = await pub.waitForTransactionReceipt({ hash: submitTx });
  const jobSubmitted = parseAbiItem("event JobSubmitted(uint256 indexed jobId, uint256 indexed sessionId, address worker)");
  const jobLog = (await pub.getLogs({ address: cfg.jobRegistry as \`0x\${string}\`, event: jobSubmitted, blockHash: submitReceipt.blockHash })).find((l) => l.transactionHash === submitTx);
  const jobId = jobLog?.args.jobId;
  if (!jobId) return c.json({ error: "JobSubmitted missing" }, 500);

  const jobCompleted = parseAbiItem("event JobCompleted(uint256 indexed jobId, address indexed worker, bytes32 responseHash, bytes32 ciphertextHash)");
  const deadline = Date.now() + 90_000;
  let completed: Log | null = null;
  while (!completed && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 3000));
    const logs = await pub.getLogs({ address: cfg.jobRegistry as \`0x\${string}\`, event: jobCompleted, args: { jobId }, fromBlock: submitReceipt.blockNumber });
    if (logs.length) completed = logs[0] as Log;
  }
  await new Promise((res) => setTimeout(res, 4000));
  ws.close();
  if (!completed) return c.json({ error: "worker stalled", txs: { createSession: createTx, submitJob: submitTx } }, 504);
  return c.json({ answer: chunks.join(""), txs: { createSession: createTx, submitJob: submitTx, jobCompleted: completed.transactionHash }, sessionId: sessionId.toString(), jobId: jobId.toString(), worker: createSessionArgs.worker });
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(\`▶ inference server on http://localhost:\${port}/inference\`);
`;

const HONO_PACKAGE_JSON = (cfg: ProjectConfig) => `{
  "name": "${cfg.projectName}",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "tsx server.ts"
  },
  "dependencies": {
    "hono": "${HONO_VERSION}",
    "@hono/node-server": "^1.13.0",
    "lightnode-sdk": "${SDK_VERSION}",
    "viem": "${VIEM_VERSION}",
    "ws": "${WS_VERSION}"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  },
  "engines": { "node": ">=18" }
}
`;

const HONO_TSCONFIG = NODE_TSCONFIG;

const HONO_README = (cfg: ProjectConfig) => `# ${cfg.projectName}

Tiny Hono server exposing \`/inference\` for end-to-end encrypted LightChain AI calls.
Generated by \`create-lightnode-app\`.

## Run it

\`\`\`bash
npm install
cp .env.example .env
# put a funded ${cfg.network} private key into .env

npm start
# server on http://localhost:3000/inference
\`\`\`

Call it:

\`\`\`bash
curl -XPOST http://localhost:3000/inference \\\\
  -H 'content-type: application/json' \\\\
  -d '{"prompt":"hello"}'
\`\`\`
`;

// ---- Composer --------------------------------------------------------------

export function filesFor(cfg: ProjectConfig): GeneratedFile[] {
  const shared: GeneratedFile[] = [
    { path: ".gitignore", contents: SHARED_GITIGNORE },
    { path: ".env.example", contents: SHARED_ENV_EXAMPLE(cfg.network) },
  ];
  if (cfg.template === "node") {
    return [
      ...shared,
      { path: "package.json", contents: NODE_PACKAGE_JSON(cfg) },
      { path: "tsconfig.json", contents: NODE_TSCONFIG },
      { path: "index.ts", contents: NODE_INDEX },
      { path: "README.md", contents: NODE_README(cfg) },
    ];
  }
  if (cfg.template === "hono") {
    return [
      ...shared,
      { path: "package.json", contents: HONO_PACKAGE_JSON(cfg) },
      { path: "tsconfig.json", contents: HONO_TSCONFIG },
      { path: "server.ts", contents: HONO_SERVER },
      { path: "README.md", contents: HONO_README(cfg) },
    ];
  }
  // nextjs-api
  return [
    ...shared,
    { path: "package.json", contents: NEXTJS_PACKAGE_JSON(cfg) },
    { path: "tsconfig.json", contents: NEXTJS_TSCONFIG },
    { path: "next.config.mjs", contents: NEXTJS_NEXT_CONFIG },
    { path: "app/layout.tsx", contents: NEXTJS_LAYOUT.replace("${projectName}", cfg.projectName) },
    { path: "app/page.tsx", contents: NEXTJS_PAGE },
    { path: "app/api/inference/route.ts", contents: NEXTJS_ROUTE },
    { path: "README.md", contents: NEXTJS_README(cfg) },
  ];
}

// Exported for the `lightnode add inference` command in lightnode-sdk's CLI:
// just the inference-shaped file for an EXISTING project of the given template.
export function addFilesFor(template: ProjectConfig["template"], network: ProjectConfig["network"]): GeneratedFile[] {
  if (template === "nextjs-api") {
    return [
      { path: "app/api/inference/route.ts", contents: NEXTJS_ROUTE },
      { path: ".env.example", contents: SHARED_ENV_EXAMPLE(network) },
    ];
  }
  if (template === "hono") {
    return [
      { path: "server.ts", contents: HONO_SERVER },
      { path: ".env.example", contents: SHARED_ENV_EXAMPLE(network) },
    ];
  }
  return [
    { path: "lightchain-inference.ts", contents: NODE_INDEX },
    { path: ".env.example", contents: SHARED_ENV_EXAMPLE(network) },
  ];
}
