/**
 * End-to-end encrypted LightChain AI inference, in ~30 lines, using
 * `runInferenceWithKey()` - the SDK's key-in / answer-out shortcut.
 *
 *   npm install
 *   npm start               # auto-generates a testnet key the first run,
 *                           # prints the address + faucet link, then exits.
 *                           # fund the address, run again, and the prompt fires.
 *
 * The same flow + same proof chain (createSession, submitJob, jobCompleted)
 * that drives the live playground at https://lightnode.app/playground.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import WS from "ws";
import { createPublicClient, http, parseEther } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { runInferenceWithKey, isStalledWorker, LightNode, type NetworkId } from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "testnet") as NetworkId;
const MODEL = process.env.MODEL ?? "llama3-8b";
const PROMPT = process.argv.slice(2).join(" ").trim() || "Reply with a one-sentence fun fact about the ocean.";

// Auto-load .env (no dotenv dep). `npm start` in StackBlitz / Codespaces
// doesn't source .env via the shell, so without this PRIVATE_KEY would always
// read as undefined.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// If no key is set, generate ONE fresh key, write it to .env, print the
// funding instructions, exit. Next `npm start` reuses it. This turns the cold
// StackBlitz / Codespaces path from "errors out, no idea what to do" into
// "tells you exactly which address to fund + where the faucet is."
let PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const looksValid = PRIVATE_KEY?.startsWith("0x") && PRIVATE_KEY.length === 66 && !/^0x0+$/i.test(PRIVATE_KEY);
if (!looksValid) {
  const fresh = generatePrivateKey();
  const addr = privateKeyToAccount(fresh).address;
  const lines = existsSync(".env") ? readFileSync(".env", "utf8").split("\n") : [];
  const filtered = lines.filter((l) => !/^\s*PRIVATE_KEY\s*=/.test(l));
  filtered.push(`PRIVATE_KEY=${fresh}`);
  writeFileSync(".env", filtered.join("\n").replace(/\n+$/, "") + "\n");
  console.log("");
  console.log("  No PRIVATE_KEY was set, so a fresh testnet key was generated and");
  console.log("  written to .env. To run this example you need to fund it once:");
  console.log("");
  console.log(`    Address: ${addr}`);
  console.log("    Faucet:  https://lightfaucet.ai   (paste the address, get free testnet LCAI)");
  console.log("");
  console.log("  Then run `npm start` again. The .env file is gitignored - the key");
  console.log("  stays local to this workspace. (To use your own key instead, edit .env.)");
  console.log("");
  process.exit(0);
}

// Quick balance check so the error is helpful instead of "createSession reverted".
const ln = new LightNode(NETWORK);
const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const pub = createPublicClient({ transport: http(ln.network.rpc) });
const balance = await pub.getBalance({ address: account.address });
console.log(`▶ ${NETWORK} ${account.address} balance=${Number(balance) / 1e18} LCAI`);
if (balance < parseEther("0.05")) {
  console.error("");
  console.error(`  Wallet ${account.address} has too little LCAI to run one job (need ~0.05).`);
  if (NETWORK === "testnet") console.error(`  Get free testnet LCAI: https://lightfaucet.ai`);
  else console.error(`  Top up the address on mainnet (chain ${ln.network.chainId}).`);
  console.error("");
  process.exit(1);
}

// ============================================================================
// THE ACTUAL CALL. This is everything; the rest of the file is just the
// "make StackBlitz / Codespaces / fresh-clone friendly" plumbing above.
// ============================================================================
try {
  process.stdout.write("\n");
  const { answer, txs, worker, sessionId, jobId, attempts, stalled } = await runInferenceWithKey({
    network: NETWORK,
    privateKey: PRIVATE_KEY as `0x${string}`,
    prompt: PROMPT,
    model: MODEL,
    WebSocket: WS, // omit this whole line in the browser
    onChunk: (chunk) => process.stdout.write(chunk),
  });
  process.stdout.write("\n\n");
  console.log(`answer:        ${answer.length} chars`);
  console.log(`createSession: ${txs.createSession}`);
  console.log(`submitJob:     ${txs.submitJob}`);
  console.log(`jobCompleted:  ${txs.jobCompleted ?? "(pending on-chain; answer above is session-key authentic)"}`);
  console.log(`sessionId=${sessionId} jobId=${jobId} worker=${worker} attempts=${attempts}`);
  if (stalled.length) console.log(`(${stalled.length} prior attempt(s) stalled; protocol refunds those fees automatically)`);
  process.exit(0);
} catch (e) {
  if (isStalledWorker(e)) console.error("3 workers in a row stalled; protocol refunds the fees, try again later");
  else console.error("inference failed:", (e as Error).message);
  process.exit(1);
}
