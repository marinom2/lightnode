/**
 * End-to-end encrypted LightChain AI inference using lightnode-sdk.
 *
 *   npm install
 *   cp .env.example .env   # put a funded testnet (or mainnet) private key in .env
 *   npm start              # prints the decrypted answer
 *
 * Flow (matches the live /playground at lightnode.app):
 *   1. SIWE handshake against the consumer gateway -> JWT
 *   2. prepareSession (worker assignment + ECDH-P256 session-key wrap)
 *   3. createSession on-chain (no LCAI value, just gas)
 *   4. Open the relay WebSocket BEFORE submitJob
 *   5. AES-GCM-encrypt the prompt and upload to /api/blobs
 *   6. submitJob on-chain, paying the per-call fee in LCAI
 *   7. Decrypt the streamed response with the session key as chunks arrive
 *   8. Wait for the on-chain JobCompleted commit, then print the answer
 *
 * The SDK is non-custodial: the private key never leaves this process.
 */

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

const NETWORK = (process.env.NETWORK ?? "testnet") as NetworkId;
const MODEL = process.env.MODEL ?? "llama3-8b";
const PROMPT = process.argv.slice(2).join(" ").trim() || "Reply with a one-sentence fun fact about the ocean.";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
if (!PRIVATE_KEY?.startsWith("0x") || PRIVATE_KEY.length !== 66) {
  console.error("set PRIVATE_KEY (0x-prefixed funded wallet) in .env");
  process.exit(1);
}

const ln = new LightNode(NETWORK);
const cfg = ln.network;
const acct = privateKeyToAccount(PRIVATE_KEY);
const chain = {
  id: cfg.chainId,
  name: cfg.label,
  nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
};
const pub = createPublicClient({ transport: http(cfg.rpc), chain });
const wal = createWalletClient({ account: acct, transport: http(cfg.rpc), chain });
const abi = parseAbi(JOB_REGISTRY_CONSUMER_ABI);

const balance = await pub.getBalance({ address: acct.address });
console.log(`▶ network=${NETWORK} chainId=${cfg.chainId} wallet=${acct.address}`);
console.log(`▶ balance=${Number(balance) / 1e18} LCAI`);
if (balance < parseEther("0.05")) {
  console.error("top up your wallet (need ~0.05 LCAI for fee + gas)");
  process.exit(1);
}

// 1. SIWE handshake -> JWT for the consumer gateway.
const challengeRes = await fetch(`${consumerGatewayUrl(NETWORK)}/api/auth/challenge?address=${acct.address}`).then((r) =>
  r.json() as Promise<{ message?: string }>,
);
if (!challengeRes?.message) throw new Error("auth challenge returned no message");
const signature = await wal.signMessage({ message: challengeRes.message });
const verify = await (
  await fetch(`${consumerGatewayUrl(NETWORK)}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: challengeRes.message, signature }),
  })
).json() as { token?: string };
if (!verify?.token) throw new Error("auth/verify returned no token");
console.log("✓ authenticated");

// 2. Prepare session via the SDK (worker selection + key wrap + dispatcher sig).
const gateway = new GatewayClient({ network: NETWORK, bearer: verify.token });
const { sessionKey, createSessionArgs } = await prepareSession(gateway, MODEL);
const fee = await estimateJobFee(cfg, MODEL);
console.log(`✓ prepared. worker=${createSessionArgs.worker} fee=${fee} LCAI`);

// 3. createSession on-chain (value 0; the fee is paid later on submitJob).
const createTx = await wal.writeContract({
  address: cfg.jobRegistry as `0x${string}`,
  abi,
  functionName: "createSession",
  args: [
    createSessionArgs.paramsHash,
    createSessionArgs.worker,
    createSessionArgs.encWorkerKey,
    createSessionArgs.ephemeralPubKey,
    createSessionArgs.initState,
    createSessionArgs.expiry,
  ],
  gas: 1_000_000n,
});
console.log(`✓ createSession tx=${createTx}`);
const createReceipt = await pub.waitForTransactionReceipt({ hash: createTx });
const sessionCreated = parseAbiItem(
  "event SessionCreated(uint256 indexed sessionId, address indexed user, bytes32 indexed paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey)",
);
const sessionLogs = await pub.getLogs({ address: cfg.jobRegistry as `0x${string}`, event: sessionCreated, blockHash: createReceipt.blockHash });
const sessionLog = sessionLogs.find((l) => l.transactionHash === createTx);
if (!sessionLog?.args.sessionId) throw new Error("SessionCreated not in receipt");
const sessionId = sessionLog.args.sessionId;
console.log(`✓ sessionId=${sessionId}`);

// 4. Open the relay WebSocket BEFORE submitJob (frames are live + unbuffered).
let relayToken: string | undefined;
for (let i = 0; i < 30 && !relayToken; i++) {
  const r = await gateway.getSessionToken(Number(sessionId));
  if ("token" in r && r.token) relayToken = r.token;
  else await new Promise((res) => setTimeout(res, 1000));
}
if (!relayToken) throw new Error("relay token never became ready");
const ws = new WS(`wss://relay.${NETWORK}.lightchain.ai/ws?token=${encodeURIComponent(relayToken)}`);
const chunks: string[] = [];
await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
console.log("✓ relay WebSocket open");
ws.on("message", async (data: Buffer) => {
  let frame: { type?: string; payload?: string };
  try { frame = JSON.parse(data.toString("utf8")); } catch { return; }
  if (frame.type === "chunk" && frame.payload) {
    try { chunks.push(await decryptResponse(sessionKey, frame.payload)); } catch { /* control frame */ }
  }
});

// 5. Encrypt + upload prompt -> get the EIP-4844 blob hash.
const promptHash = await submitPrompt(gateway, sessionKey, PROMPT);

// 6. submitJob on-chain (pays the fee).
const submitTx = await wal.writeContract({
  address: cfg.jobRegistry as `0x${string}`,
  abi,
  functionName: "submitJob",
  args: [sessionId, promptHash],
  value: parseEther(String(fee)),
  gas: 500_000n,
});
console.log(`✓ submitJob tx=${submitTx}`);
const submitReceipt = await pub.waitForTransactionReceipt({ hash: submitTx });
const jobSubmitted = parseAbiItem("event JobSubmitted(uint256 indexed jobId, uint256 indexed sessionId, address worker)");
const jobLog = (await pub.getLogs({ address: cfg.jobRegistry as `0x${string}`, event: jobSubmitted, blockHash: submitReceipt.blockHash })).find(
  (l) => l.transactionHash === submitTx,
);
const jobId = jobLog?.args.jobId;
if (!jobId) throw new Error("JobSubmitted not in receipt");
console.log(`✓ jobId=${jobId}`);

// 7. Wait for JobCompleted (90s cap; the protocol times out stalled workers off this hot path).
const jobCompleted = parseAbiItem(
  "event JobCompleted(uint256 indexed jobId, address indexed worker, bytes32 responseHash, bytes32 ciphertextHash)",
);
const waitDeadline = Date.now() + 90_000;
let completed: Log | null = null;
while (!completed && Date.now() < waitDeadline) {
  await new Promise((res) => setTimeout(res, 3000));
  const logs = await pub.getLogs({
    address: cfg.jobRegistry as `0x${string}`,
    event: jobCompleted,
    args: { jobId },
    fromBlock: submitReceipt.blockNumber,
  });
  if (logs.length) completed = logs[0] as Log;
}
if (!completed) {
  console.error("worker stalled - the protocol will refund the fee after the dispute window; re-run to try a different worker");
  process.exit(1);
}
await new Promise((res) => setTimeout(res, 4000)); // grace for the last relay frame
ws.close();

console.log("\n=== ANSWER ===\n" + chunks.join("") + "\n");
console.log(`createSession: ${createTx}`);
console.log(`submitJob:     ${submitTx}`);
console.log(`jobCompleted:  ${completed.transactionHash}`);
console.log(`sessionId=${sessionId} jobId=${jobId}`);
process.exit(0);
