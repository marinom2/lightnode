/**
 * Minimal Hono server exposing /inference -> one encrypted LightChain AI call
 * per request. Same flow as the Next.js variant; deploys anywhere Hono runs
 * with a Node runtime (Bun, Deno+npm:, Node directly).
 *
 *   npm install hono lightnode-sdk viem ws
 *   PRIVATE_KEY=0x... NETWORK=testnet tsx server.ts
 *   curl -XPOST localhost:3000/inference -d '{"prompt":"hello"}' -H 'content-type: application/json'
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import WS from "ws";
import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, parseEther, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  LightNode,
  prepareSession,
  submitPrompt,
  decryptResponse,
  estimateJobFee,
  consumerGatewayUrl,
  JOB_REGISTRY_CONSUMER_ABI,
  GatewayClient,
  type NetworkId,
} from "lightnode-sdk";

const app = new Hono();

const NETWORK = (process.env.NETWORK ?? "testnet") as NetworkId;
const MODEL = process.env.MODEL ?? "llama3-8b";

app.post("/inference", async (c) => {
  if (!process.env.PRIVATE_KEY?.startsWith("0x")) {
    return c.json({ error: "PRIVATE_KEY not set" }, 500);
  }
  const body = await c.req.json().catch(() => ({} as { prompt?: string }));
  const prompt = body.prompt?.trim();
  if (!prompt) return c.json({ error: "prompt is required" }, 400);

  const ln = new LightNode(NETWORK);
  const cfg = ln.network;
  const acct = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const chain = { id: cfg.chainId, name: cfg.label, nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } };
  const pub = createPublicClient({ transport: http(cfg.rpc), chain });
  const wal = createWalletClient({ account: acct, transport: http(cfg.rpc), chain });
  const abi = parseAbi(JOB_REGISTRY_CONSUMER_ABI);

  // SIWE -> JWT
  const ch = await (await fetch(`${consumerGatewayUrl(NETWORK)}/api/auth/challenge?address=${acct.address}`)).json() as { message?: string };
  if (!ch?.message) return c.json({ error: "auth challenge failed" }, 502);
  const signature = await wal.signMessage({ message: ch.message });
  const verify = await (await fetch(`${consumerGatewayUrl(NETWORK)}/api/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: ch.message, signature }),
  })).json() as { token?: string };
  if (!verify?.token) return c.json({ error: "auth verify failed" }, 502);

  const gateway = new GatewayClient({ network: NETWORK, bearer: verify.token });
  const { sessionKey, createSessionArgs } = await prepareSession(gateway, MODEL);
  const fee = await estimateJobFee(cfg, MODEL);
  const createTx = await wal.writeContract({
    address: cfg.jobRegistry as `0x${string}`, abi, functionName: "createSession",
    args: [createSessionArgs.paramsHash, createSessionArgs.worker, createSessionArgs.encWorkerKey,
           createSessionArgs.ephemeralPubKey, createSessionArgs.initState, createSessionArgs.expiry],
    gas: 1_000_000n,
  });
  const createReceipt = await pub.waitForTransactionReceipt({ hash: createTx });
  const sessionCreated = parseAbiItem("event SessionCreated(uint256 indexed sessionId, address indexed user, bytes32 indexed paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey)");
  const sessionLog = (await pub.getLogs({ address: cfg.jobRegistry as `0x${string}`, event: sessionCreated, blockHash: createReceipt.blockHash })).find((l) => l.transactionHash === createTx);
  const sessionId = sessionLog?.args.sessionId;
  if (!sessionId) return c.json({ error: "SessionCreated not in receipt" }, 500);

  let relayToken: string | undefined;
  for (let i = 0; i < 30 && !relayToken; i++) {
    const r = await gateway.getSessionToken(Number(sessionId));
    if ("token" in r && r.token) relayToken = r.token;
    else await new Promise((res) => setTimeout(res, 1000));
  }
  if (!relayToken) return c.json({ error: "relay token never became ready" }, 504);
  const ws = new WS(`wss://relay.${NETWORK}.lightchain.ai/ws?token=${encodeURIComponent(relayToken)}`);
  const chunks: string[] = [];
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
  ws.on("message", async (data: Buffer) => {
    let frame: { type?: string; payload?: string };
    try { frame = JSON.parse(data.toString("utf8")); } catch { return; }
    if (!frame?.payload) return;
    if (frame.type === "chunk") {
      try { chunks.push(await decryptResponse(sessionKey, frame.payload)); } catch { /* control */ }
    } else if (frame.type === "complete" && chunks.length === 0) {
      try { chunks.push(await decryptResponse(sessionKey, frame.payload)); } catch { /* ignore */ }
    }
  });

  const promptHash = await submitPrompt(gateway, sessionKey, prompt);
  const submitTx = await wal.writeContract({
    address: cfg.jobRegistry as `0x${string}`, abi, functionName: "submitJob",
    args: [sessionId, promptHash], value: parseEther(String(fee)), gas: 500_000n,
  });
  const submitReceipt = await pub.waitForTransactionReceipt({ hash: submitTx });
  const jobSubmitted = parseAbiItem("event JobSubmitted(uint256 indexed jobId, uint256 indexed sessionId, address worker)");
  const jobLog = (await pub.getLogs({ address: cfg.jobRegistry as `0x${string}`, event: jobSubmitted, blockHash: submitReceipt.blockHash })).find((l) => l.transactionHash === submitTx);
  const jobId = jobLog?.args.jobId;
  if (!jobId) return c.json({ error: "JobSubmitted not in receipt" }, 500);

  const jobCompleted = parseAbiItem("event JobCompleted(uint256 indexed jobId, address indexed worker, bytes32 responseHash, bytes32 ciphertextHash)");
  const deadline = Date.now() + 90_000;
  let completed: Log | null = null;
  while (!completed && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 3000));
    const logs = await pub.getLogs({ address: cfg.jobRegistry as `0x${string}`, event: jobCompleted, args: { jobId }, fromBlock: submitReceipt.blockNumber });
    if (logs.length) completed = logs[0] as Log;
  }
  await new Promise((res) => setTimeout(res, 4000));
  ws.close();

  if (!completed) {
    return c.json({ error: "worker stalled", txs: { createSession: createTx, submitJob: submitTx } }, 504);
  }
  return c.json({
    answer: chunks.join(""),
    txs: { createSession: createTx, submitJob: submitTx, jobCompleted: completed.transactionHash },
    sessionId: sessionId.toString(),
    jobId: jobId.toString(),
    worker: createSessionArgs.worker,
  });
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`▶ Hono inference server listening on http://localhost:${port}/inference`);
