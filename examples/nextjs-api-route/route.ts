/**
 * Next.js App Router API route that runs one encrypted LightChain AI inference
 * per request. POST a {"prompt": "..."} JSON body, get the decrypted answer +
 * the three on-chain tx hashes back as JSON.
 *
 * Place this file at: app/api/inference/route.ts
 * Set PRIVATE_KEY (funded wallet) + NETWORK ("testnet" | "mainnet") in your
 * environment. The wallet is server-side; it never reaches the browser.
 *
 * Usage from the client:
 *   const r = await fetch("/api/inference", {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json" },
 *     body: JSON.stringify({ prompt: "your prompt" }),
 *   }).then((r) => r.json());
 *   console.log(r.answer, r.txs);
 *
 * Deps: lightnode-sdk, viem, ws (server-side only).
 */

import { NextResponse } from "next/server";
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

export const runtime = "nodejs"; // ws + viem need Node, not Edge
export const dynamic = "force-dynamic";
export const maxDuration = 120; // allow up to 2 min for the slowest worker

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
  const acct = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const chain = { id: cfg.chainId, name: cfg.label, nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } };
  const pub = createPublicClient({ transport: http(cfg.rpc), chain });
  const wal = createWalletClient({ account: acct, transport: http(cfg.rpc), chain });
  const abi = parseAbi(JOB_REGISTRY_CONSUMER_ABI);

  // SIWE -> JWT
  const ch = await (await fetch(`${consumerGatewayUrl(NETWORK)}/api/auth/challenge?address=${acct.address}`)).json() as { message?: string };
  if (!ch?.message) return NextResponse.json({ error: "auth challenge failed" }, { status: 502 });
  const signature = await wal.signMessage({ message: ch.message });
  const verify = await (await fetch(`${consumerGatewayUrl(NETWORK)}/api/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: ch.message, signature }),
  })).json() as { token?: string };
  if (!verify?.token) return NextResponse.json({ error: "auth verify failed" }, { status: 502 });

  // prepareSession -> createSession on-chain
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
  if (!sessionId) return NextResponse.json({ error: "SessionCreated not in receipt" }, { status: 500 });

  // Open relay BEFORE submitJob
  let relayToken: string | undefined;
  for (let i = 0; i < 30 && !relayToken; i++) {
    const r = await gateway.getSessionToken(Number(sessionId));
    if ("token" in r && r.token) relayToken = r.token;
    else await new Promise((res) => setTimeout(res, 1000));
  }
  if (!relayToken) return NextResponse.json({ error: "relay token never became ready" }, { status: 504 });
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

  // Encrypt prompt + submitJob
  const promptHash = await submitPrompt(gateway, sessionKey, prompt);
  const submitTx = await wal.writeContract({
    address: cfg.jobRegistry as `0x${string}`, abi, functionName: "submitJob",
    args: [sessionId, promptHash], value: parseEther(String(fee)), gas: 500_000n,
  });
  const submitReceipt = await pub.waitForTransactionReceipt({ hash: submitTx });
  const jobSubmitted = parseAbiItem("event JobSubmitted(uint256 indexed jobId, uint256 indexed sessionId, address worker)");
  const jobLog = (await pub.getLogs({ address: cfg.jobRegistry as `0x${string}`, event: jobSubmitted, blockHash: submitReceipt.blockHash })).find((l) => l.transactionHash === submitTx);
  const jobId = jobLog?.args.jobId;
  if (!jobId) return NextResponse.json({ error: "JobSubmitted not in receipt" }, { status: 500 });

  // Await JobCompleted (90s cap)
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
    return NextResponse.json(
      { error: "worker stalled; protocol will refund the fee after the dispute window", txs: { createSession: createTx, submitJob: submitTx } },
      { status: 504 },
    );
  }

  return NextResponse.json({
    answer: chunks.join(""),
    txs: {
      createSession: createTx,
      submitJob: submitTx,
      jobCompleted: completed.transactionHash,
    },
    sessionId: sessionId.toString(),
    jobId: jobId.toString(),
    worker: createSessionArgs.worker,
  });
}
