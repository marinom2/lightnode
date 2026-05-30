/**
 * End-to-end encrypted LightChain AI inference, in ~40 lines, using the
 * lightnode-sdk's high-level `runInference()` helper. Streams the answer to
 * stdout as it arrives and auto-retries if a worker stalls.
 *
 *   npm install
 *   cp .env.example .env   # put a funded testnet (or mainnet) private key in .env
 *   npm start              # prints the decrypted answer + 3 tx hashes
 *
 * The lower-level helpers (prepareSession, submitPrompt, decryptResponse) are
 * still exported - this just shows the simplest possible path. Same flow,
 * same SDK, same code path that drives the live playground at
 * https://lightnode.app/playground.
 */
import WS from "ws";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  LightNode,
  GatewayClient,
  runInference,
  consumerGatewayUrl,
  isStalledWorker,
  type NetworkId,
} from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "testnet") as NetworkId;
const MODEL = process.env.MODEL ?? "llama3-8b";
const PROMPT = process.argv.slice(2).join(" ").trim() || "Reply with a one-sentence fun fact about the ocean.";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
if (!PRIVATE_KEY?.startsWith("0x") || PRIVATE_KEY.length !== 66) {
  console.error("set PRIVATE_KEY in .env");
  process.exit(1);
}

const ln = new LightNode(NETWORK);
const acct = privateKeyToAccount(PRIVATE_KEY);
const chain = {
  id: ln.network.chainId,
  name: ln.network.label,
  nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: [ln.network.rpc] } },
};
const publicClient = createPublicClient({ transport: http(ln.network.rpc), chain });
const wallet = createWalletClient({ account: acct, transport: http(ln.network.rpc), chain });

// One SIWE handshake: sign a message, get a JWT, build the gateway client.
const ch = await (await fetch(`${consumerGatewayUrl(NETWORK)}/api/auth/challenge?address=${acct.address}`)).json() as { message?: string };
if (!ch.message) throw new Error("auth challenge failed");
const sig = await wallet.signMessage({ message: ch.message });
const verify = await (await fetch(`${consumerGatewayUrl(NETWORK)}/api/auth/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: ch.message, signature: sig }),
})).json() as { token?: string };
if (!verify.token) throw new Error("auth verify failed");
const gateway = new GatewayClient({ network: NETWORK, bearer: verify.token });

const balance = await publicClient.getBalance({ address: acct.address });
console.log(`▶ ${NETWORK} ${acct.address} balance=${Number(balance) / 1e18} LCAI`);
if (balance < parseEther("0.05")) {
  console.error("top up (need ~0.05 LCAI for fee + gas)");
  process.exit(1);
}

try {
  process.stdout.write("\n");
  const result = await runInference({
    prompt: PROMPT,
    gateway,
    wallet,
    publicClient,
    network: ln.network,
    model: MODEL,
    WebSocket: WS,
    onChunk: (chunk) => process.stdout.write(chunk),
    maxRetries: 2,
  });
  process.stdout.write("\n\n");
  console.log(`createSession: ${result.txs.createSession}`);
  console.log(`submitJob:     ${result.txs.submitJob}`);
  console.log(`jobCompleted:  ${result.txs.jobCompleted}`);
  console.log(`sessionId=${result.sessionId} jobId=${result.jobId} worker=${result.worker} attempts=${result.attempts}`);
  if (result.stalled.length) console.log(`(${result.stalled.length} prior attempt(s) stalled; protocol refunds those fees automatically)`);
  process.exit(0);
} catch (e) {
  if (isStalledWorker(e)) console.error("3 workers in a row stalled; protocol refunds the fees, try again later");
  else console.error("inference failed:", (e as Error).message);
  process.exit(1);
}
