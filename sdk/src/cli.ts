#!/usr/bin/env node
import { LightNode, modelStatsCsv, workerStatsCsv, workerJobsCsv, runInferenceWithKey, runInferenceBatch, Agent, isStalledWorker, workerPreflight, workerWatch, WorkerOperator, isWorkerOpError, BRIDGE_ROUTE, DAO, DAO_ADDRESSES, SDK_VERSION, type NetworkId, type AgentTool } from "./index.js";
import { addInference, addInferenceWeb3, addJudgeWeb3, addAnalyticsDashboard, addNftMint, addChat, addChatWeb3, addAgent, addBatch, addBridge, addJudge, addWagmiSetup, addWorkerOperator, patchLayoutWithProviders, wireFreshScaffold, type LayoutPatch, type ScaffoldWiring } from "./add.js";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const positionals = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const cmd = positionals[0];
const net = (flag("--net") as NetworkId) || "mainnet";
const csv = process.argv.includes("--csv");
// --json makes the table-style read commands emit machine-readable JSON instead,
// so they compose with jq and scripts. (Commands that are already JSON ignore it.)
const wantJson = process.argv.includes("--json");
const printJson = (data: unknown) => console.log(JSON.stringify(data, null, 2));

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}
const lcai = (wei?: string) => (wei ? Number(BigInt(wei)) / 1e18 : 0);
const rate = (r: number | null) => (r == null ? "-" : `${Math.round(r * 100)}%`);

// `add` targets that are always a Next.js client page. In a bare folder these
// get a real Next.js app scaffolded first so the generated page can render.
const NEXT_PAGE_TARGETS = new Set(["chat-web3", "inference-web3", "judge-web3", "wagmi-setup"]);

function printWritten(files: { path: string; skipped?: boolean; reason?: string }[]): void {
  for (const f of files) {
    if (f.skipped) console.log(`  ⤴ ${f.path} (skipped - ${f.reason})`);
    else console.log(`  ✓ ${f.path}`);
  }
}

/**
 * Scaffold a Next.js app into cwd via create-next-app. Returns true on success.
 *
 * We scaffold into a fixed-name subfolder and move the files up rather than
 * passing ".", because create-next-app derives the project name from the
 * target and rejects names npm won't allow (capital letters, leading dots,
 * etc.) - which would make this fail in any folder like "MyApp". The subfolder
 * name is one we control, so that validation always passes.
 */
function scaffoldNextApp(cwd: string, target: string): boolean {
  console.log(`\nNo Next.js app here yet - scaffolding one with create-next-app...\n`);
  const stageName = "lightnode-next-app-stage";
  const args = [
    "--yes", "create-next-app@latest", stageName,
    "--ts", "--app", "--no-src-dir", "--eslint", "--tailwind",
    "--use-npm", "--no-turbopack", "--import-alias", "@/*",
    // Don't dump create-next-app's AGENTS.md (the nextjs-agent-rules block)
    // into the user's project. Supported by current create-next-app, which is
    // what `@latest` resolves to here.
    "--no-agents-md",
  ];
  const r = spawnSync("npx", args, { cwd, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\ncreate-next-app did not complete (exit ${r.status ?? "?"}).`);
    console.error(`If this folder already had files, scaffold manually then re-run:`);
    console.error(`  npx create-next-app@latest .  &&  npx lightnode-sdk@latest add ${target}`);
    return false;
  }
  return relocateScaffold(join(cwd, stageName), cwd, target);
}

/** Move every entry from the staged scaffold dir up into cwd, then remove it. */
function relocateScaffold(from: string, cwd: string, target: string): boolean {
  try {
    for (const entry of readdirSync(from)) {
      const dest = join(cwd, entry);
      if (existsSync(dest)) continue; // never clobber files the user already had
      renameSync(join(from, entry), dest);
    }
    rmSync(from, { recursive: true, force: true });
    return true;
  } catch (e) {
    console.error(`\nScaffolded into ${from} but could not move it up (${(e as Error).message}).`);
    console.error(`Move its contents into this folder, then re-run: npx lightnode-sdk@latest add ${target}`);
    return false;
  }
}

/** Run an `npm install ...` line in cwd. The line is an internal constant
 *  (never user input), so running it through a shell is safe here. */
function installDeps(installLine: string, cwd: string): boolean {
  console.log(`\nInstalling dependencies: ${installLine}\n`);
  const r = spawnSync(installLine, { cwd, stdio: "inherit", shell: true });
  if (r.status === 0) return true;
  console.error(`\nDependency install failed (exit ${r.status ?? "?"}). Run it yourself:\n  ${installLine}`);
  return false;
}

const HELP = `lightnode <command> [--net mainnet|testnet] [--json] [--help]

  --json on any read command (network, models, jobs, job, analytics,
         reliability, worker doctor/liveness/profitability) emits JSON.
  --help after any command prints just that command's usage.


Run one inference (needs PRIVATE_KEY in env):
  chat <prompt>            stream one encrypted inference answer to stdout
                           ([--model llama3-8b] [--key 0x...])
  batch <prompts.json>     run N prompts in parallel, JSON line per result
                           ([--model] [--concurrency 4])
  agent <task>             ReAct-style agent with built-in add + now tools
                           ([--model] [--max-iter 4])

Wallet helpers:
  wallet new               generate a fresh testnet key, print it
  wallet address           print the address of PRIVATE_KEY
  wallet balance [--net]   print LCAI balance for PRIVATE_KEY's address

Read-only network commands (no key):
  network                  network summary (workers, jobs, models, earnings)
  models                   registered models + per-job fee
  worker <addr>            a worker: on-chain registration + recent jobs
  worker watch <addr>      poll worker status, print event on change
                           ([--interval 30] [--stale 90])
  jobs <addr> [--csv]      one worker's job history (table or CSV)
  job <jobId>              one job's status (category, refundable, worker, timings)
  registered <addr>        true | false | null (read from chain events)
  fee [model]              on-chain inference fee (default llama3-8b)
  analytics [--csv]        per-model performance (completion, p50/p95, incomplete)
  reliability [--csv]      per-worker reliability, busiest first

Worker operator (needs PRIVATE_KEY in env; signs as the worker key):
  worker preflight         run one real test inference, print verdict + timings
                           ([--key 0x...] [--model llama3-8b] [--deadline 60])
  worker status [addr]     registration, stake, claimable, live protocol config
  worker doctor [addr]     action center: gas, claimable, stuck, settle, to-do (JSON)
  worker liveness <addr>   stuck-job + slash-risk + activity diagnostic (JSON)
  worker profitability [addr]  fee/gas/net per job + projected daily ([--model])
  worker models <addr>     models served, reconciled vs chain (servingNow truth)
  worker can-deregister    check what blocks the exit (in-flight jobs), no spend
  worker settle            release completed jobs past their window + withdraw
  worker clearstuck        claimTimeout acked, past-deadline jobs (unblocks exit)
                           (mainnet realizes a per-job slash; needs --yes)
  worker withdraw          pull the earned balance into the worker wallet
  worker deregister        clear stuck + settle + withdraw + deregister (mainnet: --yes)

Ecosystem (read-only):
  bridge addresses         print bridge route (Ethereum <-> LightChain) addresses
  dao addresses            print LCAI Governor + Timelock + Treasury addresses
  dao config               print voting delay / period / threshold (live read)

Scaffold templates into the current project (run inside a Next.js app):
  Server-paid (you host a backend; your funded wallet pays per call):
    add inference                 end-to-end encrypted inference route/script
    add chat                      chat-style UI with conversation history
    add judge                     pass/fail evaluator route (criteria + evidence)
    add agent                     scheduled/loop inference (cron-style)
    add analytics-dashboard       read-only network + worker analytics page
    add nft-mint-with-inference   AI-generated NFT metadata (provenance on-chain)
  User-paid (no backend; each visitor signs + pays from their own wallet):
    add inference-web3            one-shot inference UI, wallet-signed
    add chat-web3                 chat UI, wallet-signed (mainnet + testnet aware)
    add judge-web3                evaluator UI, wallet-signed
    add wagmi-setup               wallet wiring: lib/wagmi + providers + connect button
  Worker operator (Docker-free ops console, run with npx tsx):
    add worker-operator           worker-ops.ts: status/settle/clearstuck/withdraw/deregister/profitability
                                  (all add commands: [--template auto|nextjs-api|hono|node] [--net testnet|mainnet] [--force])

To scaffold a new project instead, run: npm create lightnode-app my-app

Diagnostics:
  version                  print this CLI's version (also: --version, -v)
                           (a missing 'add' target usually means an old install -
                            update with: npm install -g lightnode-sdk@latest)`;

/** The HELP lines relevant to one command (so `lightnode <cmd> --help` is focused),
 *  derived from the single HELP source so it can't drift. Falls back to full HELP. */
function commandHelp(c: string): string {
  const lines = HELP.split("\n").filter((l) => {
    const t = l.trim();
    return t === c || t.startsWith(c + " ") || t.startsWith(c + "\t") || t.startsWith("add " + c + " ");
  });
  return lines.length ? `lightnode ${c}:\n${lines.join("\n")}` : HELP;
}

function pickKey(): `0x${string}` {
  const k = flag("--key") ?? process.env.PRIVATE_KEY;
  if (!k || !k.startsWith("0x") || k.length !== 66) {
    die("set PRIVATE_KEY=0x... in your env, or pass --key 0x...   (need a funded EVM key)");
  }
  return k as `0x${string}`;
}

const viemChain = (n: LightNode) => ({
  id: n.network.chainId,
  name: n.network.label,
  nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: [n.network.rpc] } },
});

/** A read-only WorkerOperator for the given worker address (no key). */
function readOperator(n: LightNode, address: string): WorkerOperator {
  const chain = viemChain(n);
  const publicClient = createPublicClient({ transport: http(n.network.rpc), chain });
  return new WorkerOperator(n.network, { publicClient, workerAddress: address as `0x${string}` });
}

/** A write-capable WorkerOperator signed by PRIVATE_KEY / --key. The viem clients
 *  satisfy the SDK's structural Minimal* types directly - the Minimal* interfaces
 *  use method shorthand (bivariant parameters), so no boundary cast is needed. */
function writeOperator(n: LightNode): WorkerOperator {
  const chain = viemChain(n);
  const account = privateKeyToAccount(pickKey());
  const publicClient = createPublicClient({ transport: http(n.network.rpc), chain });
  const walletClient = createWalletClient({ account, transport: http(n.network.rpc), chain });
  return new WorkerOperator(n.network, { publicClient, walletClient });
}

/** The worker's job IDs from the indexer, used to drive on-chain settle/clear. */
async function workerJobIds(n: LightNode, address: string): Promise<number[]> {
  const jobs = await n.getWorkerJobs(address, 100);
  return jobs.map((j) => Number(j.id)).filter((x) => Number.isFinite(x));
}

async function main() {
  // Answer `version` / `--version` / `-v` before anything else so a user who
  // suspects they're on a stale binary can confirm it without a network call
  // or a funded key. This is the first thing to check when an `add` target
  // "doesn't exist" - an old global install is the common cause.
  if (cmd === "version" || process.argv.includes("--version") || process.argv.includes("-v")) {
    console.log(SDK_VERSION);
    return;
  }
  // `lightnode <cmd> --help` prints just that command's usage; bare `--help` (or no
  // command) prints the full reference.
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(cmd ? commandHelp(cmd) : HELP);
    return;
  }
  const ln = new LightNode(net);
  switch (cmd) {
    case "chat": {
      // One-shot encrypted inference straight from the CLI. Pipe the prompt as
      // positional args (or read from stdin if there are none) so this composes
      // with shell scripts: `cat doc.md | lightnode chat` works.
      const inlinePrompt = positionals.slice(1).join(" ").trim();
      const prompt =
        inlinePrompt ||
        (await new Promise<string>((resolve) => {
          let buf = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (d) => (buf += d));
          process.stdin.on("end", () => resolve(buf.trim()));
        }));
      if (!prompt) die("usage: lightnode chat <prompt>   (or pipe the prompt to stdin)");
      const model = flag("--model") ?? "llama3-8b";
      const privateKey = pickKey();
      try {
        const { answer, txs, worker, jobId } = await runInferenceWithKey({
          network: net,
          privateKey,
          prompt,
          model,
          onChunk: (chunk) => process.stdout.write(chunk),
        });
        process.stdout.write("\n");
        // Tiny one-liner trailer so the receipt is reachable without burying
        // the answer. JSON is grep-friendly for shell pipelines.
        const explorer = ln.network.explorer;
        process.stderr.write(
          JSON.stringify({
            chars: answer.length,
            worker,
            jobId: jobId.toString(),
            createSession: `${explorer}/tx/${txs.createSession}`,
            submitJob: `${explorer}/tx/${txs.submitJob}`,
            jobCompleted: txs.jobCompleted ? `${explorer}/tx/${txs.jobCompleted}` : null,
          }) + "\n",
        );
      } catch (e) {
        if (isStalledWorker(e)) die("3 workers stalled in a row. Protocol refunds the fees; try again later.");
        die("inference failed: " + (e as Error).message);
      }
      break;
    }
    case "wallet": {
      const sub = positionals[1];
      if (sub === "new") {
        // Fresh testnet-shaped key. Plain stdout output so it's copy-pasteable
        // out of a script: `lightnode wallet new --quiet | head -1` works.
        const pk = generatePrivateKey();
        const addr = privateKeyToAccount(pk).address;
        console.log(`PRIVATE_KEY=${pk}`);
        console.error(`# address: ${addr}`);
        console.error(`# fund at https://lightfaucet.ai before running paid commands`);
      } else if (sub === "address") {
        const pk = pickKey();
        console.log(privateKeyToAccount(pk).address);
      } else if (sub === "balance") {
        const pk = pickKey();
        const addr = privateKeyToAccount(pk).address;
        const pub = createPublicClient({ transport: http(ln.network.rpc) });
        const bal = await pub.getBalance({ address: addr });
        const lcaiVal = Number(bal) / 1e18;
        console.log(`${lcaiVal} LCAI`);
        if (bal < parseEther("0.05")) {
          console.error(`# under 0.05 LCAI - too low to run one inference`);
          if (net === "testnet") console.error(`# get free testnet LCAI: https://lightfaucet.ai`);
        }
      } else {
        die("usage: lightnode wallet <new|address|balance> [--net testnet|mainnet]");
      }
      break;
    }
    case "network": {
      console.log(JSON.stringify(await ln.getNetworkAnalytics(), null, 2));
      break;
    }
    case "models": {
      const models = await ln.getModels();
      if (wantJson) {
        printJson(models);
        break;
      }
      for (const m of models) {
        console.log(`${m.name}\t${lcai(m.fee)} LCAI\t${m.max_output_tokens} tok\t${m.is_whitelisted && m.is_enabled ? "live" : "off"}`);
      }
      break;
    }
    case "worker": {
      // Two sub-shapes: `lightnode worker <addr>` (one-shot status) and
      // `lightnode worker watch <addr>` (long-running event stream) and
      // `lightnode worker preflight` (submit a test inference).
      const sub = positionals[1];
      if (sub === "watch") {
        const addr = positionals[2] ?? die("usage: lightnode worker watch <address> [--interval 30] [--stale 90]");
        const intervalSec = Number(flag("--interval") ?? "30");
        const staleSecs = Number(flag("--stale") ?? "90");
        const handle = workerWatch(ln, addr, { intervalMs: intervalSec * 1000, staleSecs });
        process.on("SIGINT", () => {
          handle.stop();
          process.exit(0);
        });
        for await (const event of handle.events) {
          console.log(JSON.stringify(event));
        }
        break;
      }
      if (sub === "preflight") {
        const privateKey = pickKey();
        const model = flag("--model") ?? "llama3-8b";
        const deadlineMs = Number(flag("--deadline") ?? "60") * 1000;
        console.error(`> preflight against ${net} (model=${model}, deadline=${deadlineMs / 1000}s)...`);
        const r = await workerPreflight({ network: net, privateKey, model, deadlineMs });
        const explorer = ln.network.explorer;
        console.log(
          JSON.stringify(
            {
              verdict: r.verdict,
              elapsedSec: Math.round(r.elapsedMs / 100) / 10,
              worker: r.worker,
              summary: r.summary,
              txs: {
                createSession: r.txs.createSession ? `${explorer}/tx/${r.txs.createSession}` : null,
                submitJob: r.txs.submitJob ? `${explorer}/tx/${r.txs.submitJob}` : null,
                jobCompleted: r.txs.jobCompleted ? `${explorer}/tx/${r.txs.jobCompleted}` : null,
              },
              error: r.error,
            },
            null,
            2,
          ),
        );
        if (r.verdict === "failed" || r.verdict === "stalled") process.exit(1);
        break;
      }
      // Operator subcommands (the write/ops side). status is read-only; the rest
      // sign with PRIVATE_KEY / --key and act on the worker that key controls.
      if (sub === "status") {
        const addr = positionals[2] ?? (flag("--key") || process.env.PRIVATE_KEY ? privateKeyToAccount(pickKey()).address : die("usage: lightnode worker status <address>   (or set PRIVATE_KEY)"));
        const op = readOperator(ln, addr);
        const [st, cfg] = await Promise.all([op.status(), op.config()]);
        console.log(JSON.stringify({ ...st, stakeWei: st.stakeWei.toString(), minStakeWei: st.minStakeWei.toString(), claimableWei: st.claimableWei.toString(), config: { minStakeLcai: cfg.minStakeLcai, completionTimeoutSec: cfg.completionTimeoutSec, slashBps: cfg.slashBps } }, null, 2));
        break;
      }
      // Read-only diagnostics (no key): the action center, liveness, profitability -
      // the same rollups the desktop dashboard shows, for scripting/monitoring.
      if (sub === "doctor" || sub === "actions") {
        const addr = positionals[2] ?? (flag("--key") || process.env.PRIVATE_KEY ? privateKeyToAccount(pickKey()).address : die("usage: lightnode worker doctor <address>   (or set PRIVATE_KEY)"));
        printJson(await ln.getWorkerActions(addr));
        break;
      }
      if (sub === "liveness") {
        const addr = positionals[2] ?? die("usage: lightnode worker liveness <address> [--net testnet]");
        printJson(await ln.getWorkerLiveness(addr));
        break;
      }
      if (sub === "profitability") {
        const addr = positionals[2] ?? (flag("--key") || process.env.PRIVATE_KEY ? privateKeyToAccount(pickKey()).address : die("usage: lightnode worker profitability <address> [--model llama3-8b]"));
        const served = await ln.getServedModels(addr);
        const modelTag = flag("--model") ?? served.find((s) => s.onchainEligible)?.name ?? served[0]?.name ?? "llama3-8b";
        const op = readOperator(ln, addr);
        printJson({ model: modelTag, ...(await op.profitability({ modelTag })) });
        break;
      }
      if (sub === "can-deregister") {
        const op = writeOperator(ln);
        const ids = await workerJobIds(ln, privateKeyToAccount(pickKey()).address);
        const r = await op.canDeregister(ids);
        console.log(
          JSON.stringify(
            {
              ok: r.ok,
              reason: r.reason,
              releasableNow: r.releasableNow.map(String),
              releasePending: r.releasePending.map(String),
              slashableToClear: r.slashableToClear.map((j) => ({ jobId: j.jobId.toString(), state: j.state, slashBps: j.slashBps })),
              estimatedSlashLcai: Math.round(r.estimatedSlashLcai),
              blockedBy: r.blockedBy.map(String),
            },
            null,
            2,
          ),
        );
        break;
      }
      if (sub === "settle") {
        const op = writeOperator(ln);
        const addr = privateKeyToAccount(pickKey()).address;
        const ids = await workerJobIds(ln, addr);
        console.error(`> releasing completed jobs on ${net}...`);
        const rel = await op.releaseAll(ids);
        let withdrawTx: string | undefined;
        if ((await op.status()).claimableWei > 0n) withdrawTx = await op.withdraw();
        console.log(JSON.stringify({ settled: rel.done.map((r) => ({ jobId: r.jobId.toString(), tx: r.tx })), skipped: rel.skipped.map((s) => ({ jobId: s.jobId.toString(), reason: s.reason })), withdrawTx: withdrawTx ?? null }, null, 2));
        break;
      }
      if (sub === "clearstuck") {
        const op = writeOperator(ln);
        const addr = privateKeyToAccount(pickKey()).address;
        const ids = await workerJobIds(ln, addr);
        if (net === "mainnet" && !process.argv.includes("--yes")) {
          const r = await op.canDeregister(ids);
          die(
            `clearstuck finalizes ${r.slashableToClear.length} stuck job(s) as TimedOut, realizing ~${Math.round(r.estimatedSlashLcai)} LCAI of slashing on mainnet (completion-timeout 5%/acked job, ack-timeout 2%/never-acked job). There is no no-slash path for these on-chain. Re-run with --yes to confirm.`,
          );
        }
        console.error(`> clearing stuck (acknowledged, past-deadline) jobs on ${net}...`);
        const r = await op.clearStuck(ids);
        console.log(JSON.stringify({ cleared: r.done.map((c) => ({ jobId: c.jobId.toString(), tx: c.tx })), skipped: r.skipped.map((s) => ({ jobId: s.jobId.toString(), reason: s.reason })) }, null, 2));
        break;
      }
      if (sub === "withdraw") {
        const op = writeOperator(ln);
        const before = (await op.status()).claimableLcai;
        if (before <= 0) {
          console.log(JSON.stringify({ withdrawn: 0, note: "no claimable balance in the JobRegistry" }, null, 2));
          break;
        }
        const tx = await op.withdraw();
        console.log(JSON.stringify({ withdrawnLcai: before, tx }, null, 2));
        break;
      }
      if (sub === "deregister") {
        const op = writeOperator(ln);
        const addr = privateKeyToAccount(pickKey()).address;
        const ids = await workerJobIds(ln, addr);
        const acceptSlash = process.argv.includes("--accept-slash");
        if (net === "mainnet" && !process.argv.includes("--yes")) {
          die("deregister on mainnet releases completed jobs for free, but stuck in-flight jobs can ONLY be cleared with a slash. Run 'worker can-deregister' to see the exact cost, then re-run with --yes (add --accept-slash to also authorize clearing stuck jobs).");
        }
        try {
          const r = await op.unstickAndDeregister(ids, { acceptSlash });
          if (r.blocked) {
            console.log(
              JSON.stringify(
                {
                  deregistered: false,
                  released: r.released.map((c) => c.jobId.toString()),
                  cleared: r.cleared.map((c) => c.jobId.toString()),
                  withdrawTx: r.withdrawTx ?? null,
                  blockedReason: r.blocked.reason,
                  slashableToClear: r.blocked.slashableToClear.map((j) => j.jobId.toString()),
                  estimatedSlashLcai: Math.round(r.blocked.estimatedSlashLcai),
                  hint:
                    r.blocked.slashableToClear.length && !acceptSlash
                      ? "Re-run with --accept-slash to clear the stuck jobs (realizes the slash above), or ask LightChain to clear them without slash."
                      : "Completed jobs are still in their dispute window; re-run after it elapses to finish deregistering.",
                },
                null,
                2,
              ),
            );
            break;
          }
          console.log(
            JSON.stringify(
              {
                deregistered: true,
                released: r.released.map((c) => c.jobId.toString()),
                cleared: r.cleared.map((c) => c.jobId.toString()),
                withdrawTx: r.withdrawTx ?? null,
                deregisterTx: r.deregisterTx,
              },
              null,
              2,
            ),
          );
        } catch (e) {
          if (isWorkerOpError(e)) die(`deregister failed: ${e.message}`);
          throw e;
        }
        break;
      }
      if (sub === "models") {
        // The models a worker serves, reconciled against the chain (read-only,
        // no key). onchainEligible is the truth; indexedActive is the subgraph's
        // (which goes stale after a deregister/re-register).
        const addr = positionals[2] ?? die("usage: lightnode worker models <address> [--net testnet]");
        const served = await ln.getServedModels(addr);
        console.log(
          JSON.stringify(
            served.map((m) => ({
              model: m.name ?? m.modelId,
              servingNow: m.onchainEligible, // true | false | null (chain unavailable)
              indexedActive: m.indexedActive,
              feeLcai: m.feeWei ? Number(BigInt(m.feeWei)) / 1e18 : null,
              maxOutputTokens: m.maxOutputTokens ?? null,
            })),
            null,
            2,
          ),
        );
        break;
      }
      // Default: one-shot worker summary by address. Registration is read straight
      // from the chain (isRegistered); served models are reconciled against the
      // chain via getServedModels (onchainEligible), so a stale index row can't
      // misreport what the worker actually serves.
      const addr = sub ?? die("usage: lightnode worker <address|watch|preflight|status|doctor|liveness|profitability|models|can-deregister|settle|clearstuck|withdraw|deregister> [...]");
      const [w, registered, jobs, served] = await Promise.all([
        ln.getWorker(addr),
        ln.isRegistered(addr),
        ln.getWorkerJobs(addr, 5),
        ln.getServedModels(addr).catch(() => []),
      ]);
      console.log(
        JSON.stringify(
          {
            onchainRegistered: registered,
            servingModels: served.filter((m) => m.onchainEligible === true).map((m) => m.name ?? m.modelId),
            worker: w,
            recentJobs: jobs.map((j) => ({ id: j.id, state: j.state })),
          },
          null,
          2,
        ),
      );
      break;
    }
    case "job": {
      const id = positionals[1] ?? die("usage: lightnode job <jobId> [--net testnet]");
      const status = await ln.getJobStatus(id);
      if (!status) {
        console.log(JSON.stringify({ jobId: id, status: "not-indexed" }, null, 2));
        break;
      }
      console.log(JSON.stringify(status, null, 2));
      break;
    }
    case "jobs": {
      const addr = positionals[1] ?? die("usage: lightnode jobs <address> [--csv] [--net testnet]");
      const jobs = await ln.getWorkerJobs(addr, 100);
      if (wantJson) {
        printJson(jobs);
        break;
      }
      if (csv) {
        console.log(workerJobsCsv(jobs));
      } else {
        for (const j of jobs) {
          const proc = j.ack_at && j.completed_at && j.completed_at >= j.ack_at ? `${j.completed_at - j.ack_at}s` : "-";
          console.log(`#${j.id}\t${j.state}\t${proc}\t${lcai(j.worker_share)} LCAI`);
        }
      }
      break;
    }
    case "registered": {
      const addr = positionals[1] ?? die("usage: lightnode registered <address>");
      console.log(String(await ln.isRegistered(addr)));
      break;
    }
    case "fee": {
      const model = positionals[1] ?? "llama3-8b";
      console.log(`${await ln.estimateFee(model)} LCAI per job (${model})`);
      break;
    }
    case "analytics": {
      const stats = await ln.getModelStats();
      if (wantJson) {
        printJson(stats);
        break;
      }
      if (csv) {
        console.log(modelStatsCsv(stats));
      } else {
        for (const s of stats) console.log(`${s.name}\t${s.total}j\t${rate(s.completionRate)}\tp50 ${s.p50 ?? "-"}s\tp95 ${s.p95 ?? "-"}s\tinc ${s.incomplete}\t${s.earnings.toFixed(3)} LCAI`);
      }
      break;
    }
    case "reliability": {
      const workers = await ln.getWorkerStats(1000, 20);
      if (wantJson) {
        printJson(workers);
        break;
      }
      if (csv) {
        console.log(workerStatsCsv(workers));
      } else {
        for (const w of workers) console.log(`${w.address}\t${w.total}j\t${rate(w.completionRate)}\tp50 ${w.p50 ?? "-"}s\tinc ${w.incomplete}\t${w.earnings.toFixed(3)} LCAI`);
      }
      break;
    }
    case "bridge": {
      const sub = positionals[1];
      if (sub === "addresses") {
        console.log(JSON.stringify(BRIDGE_ROUTE, null, 2));
        break;
      }
      die("usage: lightnode bridge <addresses>");
      break;
    }
    case "dao": {
      const sub = positionals[1];
      if (sub === "addresses") {
        console.log(JSON.stringify(DAO_ADDRESSES.ethereum, null, 2));
        break;
      }
      if (sub === "config") {
        // Live read against Ethereum mainnet. We use viem's HTTP transport
        // via a minimal inline client (no ethers dep). This is the only
        // ecosystem read that needs a live RPC, so we wire it lazily.
        // Default to publicnode (reliable, no key required). Caller can
        // override with --rpc <url> if they have a higher-quality endpoint.
        const { createPublicClient, http } = await import("viem");
        const ethRpc = flag("--rpc") ?? "https://ethereum-rpc.publicnode.com";
        const pub = createPublicClient({ transport: http(ethRpc) });
        // The DAO ctor accepts a structurally-typed MinimalPublicClient; viem's
        // PublicClient satisfies it directly (the Minimal shape uses bivariant
        // method members), so no cast is needed.
        const dao = new DAO(pub, "ethereum");
        let cfg;
        try {
          cfg = await dao.config();
        } catch (e) {
          const msg = (e as Error).message ?? String(e);
          // Short-circuit the viem stack trace: a friendly one-liner is what
          // the operator wants when the public RPC is having a bad day.
          die(
            `dao config: RPC call failed against ${ethRpc}.\n` +
              `   Hint: try a different Ethereum RPC with --rpc <url>.\n` +
              `   Public options: https://ethereum-rpc.publicnode.com, https://rpc.ankr.com/eth, https://eth.merkle.io\n` +
              `   Underlying: ${msg.split("\n")[0]}`,
          );
        }
        console.log(
          JSON.stringify(
            {
              votingDelayBlocks: cfg.votingDelayBlocks.toString(),
              votingPeriodBlocks: cfg.votingPeriodBlocks.toString(),
              votingPeriodSecs: cfg.votingPeriodSecs,
              proposalThresholdLcai: Number(cfg.proposalThresholdWei) / 1e18,
              addresses: dao.addresses,
            },
            null,
            2,
          ),
        );
        break;
      }
      die("usage: lightnode dao <addresses|config> [--rpc <ethereum-rpc>]");
      break;
    }
    case "add": {
      const sub = positionals[1];
      const template = (flag("--template") as "auto" | "nextjs-api" | "hono" | "node" | undefined) ?? "auto";
      const force = process.argv.includes("--force");
      const network = (net === "mainnet" ? "mainnet" : "testnet") as "mainnet" | "testnet";
      const known = ["inference", "inference-web3", "chat", "chat-web3", "judge", "judge-web3", "wagmi-setup", "agent", "batch", "bridge", "analytics-dashboard", "nft-mint-with-inference", "worker-operator"];
      if (!known.includes(sub ?? "")) {
        const lines = [
          `usage: lightnode add <${known.join("|")}> [--template auto|nextjs-api|hono|node] [--net testnet|mainnet] [--force]`,
        ];
        // A target that's missing here but valid in a newer release means the
        // user is running an OLD lightnode-sdk. The usual cause is an outdated
        // GLOBAL install (`npm i -g lightnode-sdk`) on PATH, which npx prefers
        // over the registry - so `npx lightnode-sdk add ...` keeps hitting the
        // stale binary. We can't know the latest version offline, but we can
        // show what THIS binary is and the two commands that fix it. Listing
        // the global update first because that's the one most people miss.
        if (sub) {
          lines.push("");
          lines.push(`unknown add target "${sub}" - this CLI is lightnode-sdk v${SDK_VERSION}, which`);
          lines.push(`does not have it. You're likely on an older install. Update, then retry:`);
          lines.push(`  npm install -g lightnode-sdk@latest     # if 'lightnode' is on your PATH`);
          lines.push(`  npx lightnode-sdk@latest add ${sub}   # or force the latest for one run`);
        }
        die(lines.join("\n"));
      }
      // ---- one-command setup: flags + optional scaffold ----
      const noInstall = process.argv.includes("--no-install");
      const noScaffold = process.argv.includes("--no-scaffold");
      const cwd = process.cwd();
      const isWeb3Page = sub === "chat-web3" || sub === "inference-web3" || sub === "judge-web3";
      // A Next.js client page needs a Next.js app to live in. In a bare folder,
      // scaffold one first so the generated page renders instead of throwing
      // "Cannot find module 'react'". Opt out with --no-scaffold.
      const didScaffold =
        (NEXT_PAGE_TARGETS.has(sub ?? "") || sub === "chat") && !existsSync(join(cwd, "package.json")) && !noScaffold
          ? scaffoldNextApp(cwd, sub ?? "")
          : false;

      // ---- write the requested files ----
      const result =
        sub === "analytics-dashboard" ? addAnalyticsDashboard({ template, network, force })
        : sub === "nft-mint-with-inference" ? addNftMint({ template, network, force })
        : sub === "chat-web3" ? addChatWeb3({ template, network, force })
        : sub === "inference-web3" ? addInferenceWeb3({ template, network, force })
        : sub === "judge-web3" ? addJudgeWeb3({ template, network, force })
        : sub === "wagmi-setup" ? addWagmiSetup({ template, network, force })
        : sub === "chat" ? addChat({ template, network, force })
        : sub === "agent" ? addAgent({ template, network, force })
        : sub === "batch" ? addBatch({ template, network, force })
        : sub === "bridge" ? addBridge({ template, network, force })
        : sub === "judge" ? addJudge({ template, network, force })
        : sub === "worker-operator" ? addWorkerOperator({ template, network, force })
        : addInference({ template, network, force });
      console.log(`▶ add ${sub} (${result.template} template, default network ${result.network})`);
      printWritten(result.written);

      // ---- web3 pages: bundle the wagmi wiring + wrap the root layout so the
      // page's <ConnectButton /> and wagmi hooks have a provider to resolve. ----
      let layout: LayoutPatch | null = null;
      if (isWeb3Page) {
        const wagmi = addWagmiSetup({ template: result.template, network, force });
        printWritten(wagmi.written);
      }
      if (isWeb3Page || sub === "wagmi-setup") {
        layout = patchLayoutWithProviders(cwd);
        if (layout.patched) console.log(`  ✓ ${layout.path} (wrapped children with <Providers>)`);
        else console.log(`  ⤴ ${layout.path} (${layout.reason})`);
      }

      // ---- fresh scaffold only: make the generated page the homepage and ship
      // the LightChain theme so localhost:3000 lands on the chat, not the
      // create-next-app starter. Skipped in an existing app (nothing to clobber).
      let wiring: ScaffoldWiring | null = null;
      if (didScaffold && (isWeb3Page || sub === "chat")) {
        wiring = wireFreshScaffold(sub as string, { cwd });
        printWritten(wiring.written);
        if (wiring.homepageRoute) console.log(`  ✓ app/page.tsx (chat is now the homepage at /)`);
        if (wiring.darkDefault) console.log(`  ✓ app/layout.tsx (dark theme default)`);
      }

      // ---- install dependencies (opt out with --no-install) ----
      const installed = noInstall ? false : installDeps(result.install, cwd);

      // ---- next steps ----
      const layoutNeedsManual = layout != null && !layout.patched && !/already/.test(layout.reason ?? "");
      if (isWeb3Page) {
        const route = sub === "chat-web3" ? "/chat-web3" : sub === "inference-web3" ? "/inference-web3" : "/judge-web3";
        const chainId = result.network === "mainnet" ? "9200" : "8200";
        console.log(`\n${installed ? "✓ Done - deps installed, wagmi + layout wired. Just run it:" : "Files written. Next:"}`);
        if (!installed) console.log(`  ${result.install}`);
        console.log(`  npm run dev`);
        const openPath = wiring ? "" : route; // fresh scaffold serves the page at /
        console.log(`  open http://localhost:3000${openPath}  and click Connect wallet (chainId ${chainId})`);
        if (wiring) console.log(`  (also reachable at ${route})`);
        console.log(`  ${result.network === "mainnet" ? "llama3-8b costs 0.02 LCAI per call" : "testnet is free"}`);
        if (layoutNeedsManual) {
          console.log(`\nHeads up: couldn't auto-wire the layout (${layout?.reason}).`);
          console.log(`Wrap {children} with <Providers> in app/layout.tsx (import from "./providers").`);
        }
        console.log(`\n  No server-side route - deploy static (Vercel/Netlify/Cloudflare free tier all work).`);
      } else if (sub === "wagmi-setup") {
        console.log(`\n${installed ? "✓ Done - deps installed and layout wired." : "Files written. Run: " + result.install}`);
        console.log(`\nUse it: import { ConnectButton } from "@/components/connect-button"; drop <ConnectButton /> anywhere.`);
        console.log(`Any wagmi hook (useAccount, useWalletClient, ...) now works app-wide. Off-network wallets get a switch prompt.`);
        if (layoutNeedsManual) {
          console.log(`\nHeads up: couldn't auto-wire the layout (${layout?.reason}). Wrap {children} with <Providers> in app/layout.tsx.`);
        }
      } else {
        // server-paid + read-only targets keep the detailed guidance.
        console.log(`\nNext steps:`);
        console.log(`  1. ${installed ? "(done) " : ""}${result.install}`);
        if (sub === "nft-mint-with-inference" || sub === "inference" || sub === "chat" || sub === "agent" || sub === "judge") {
          console.log(`  2. cp .env.example .env  (and put a funded ${result.network} PRIVATE_KEY in it)`);
          if (sub === "agent" && result.template === "nextjs-api") {
            console.log(`  3. Set CRON_SECRET in your Vercel env vars + edit AGENT_TASK in .env`);
            console.log(`  4. Deploy. Vercel Cron fires /api/agent on the schedule in vercel.json`);
          } else if (sub === "agent") {
            console.log(`  3. AGENT_INTERVAL_MS=3600000 npx tsx agent.ts   # or run under pm2/systemd`);
          } else if (sub === "chat" && result.template === "nextjs-api") {
            console.log(`  3. npm run dev   # then open http://localhost:3000${wiring ? "" : "/chat"}`);
            console.log(`     (or: docker compose up --build  to run the whole stack with no function timeout)`);
          } else if (sub === "chat") {
            console.log(`  3. npx tsx chat-repl.ts  (interactive terminal chat)`);
          } else if (sub === "judge" && result.template === "nextjs-api") {
            console.log(`  3. Pick one:`);
            console.log(`     a) docker compose up --build         # run the whole stack yourself, no timeout`);
            console.log(`     b) npm run dev                       # local dev only`);
            console.log(`  4. curl -X POST localhost:3000/api/judge -H 'content-type: application/json' \\\\`);
            console.log(`         -d '{"criteria":"Run a mile under 8 minutes","evidence":{"time_minutes":7.4,"distance_km":1.61}}'`);
          } else if (sub === "judge") {
            console.log(`  3. npx tsx judge.ts 'Run a mile under 8 minutes' '{"time_minutes":7.4,"distance_km":1.61}'`);
          } else if (sub === "nft-mint-with-inference" && result.template === "nextjs-api") {
            console.log(`  3. Make sure /api/inference is mounted too (run: npx lightnode add inference)`);
            console.log(`  4. npm run dev, open /nft-mint`);
          } else if (result.template === "nextjs-api") {
            console.log(`  3. Pick one:`);
            console.log(`     a) docker compose up --build         # run the whole stack yourself, no timeout`);
            console.log(`     b) npm run dev                       # local dev only`);
            console.log(`     POST http://localhost:3000/api/inference  {"prompt":"hello"}`);
          } else if (result.template === "hono") {
            console.log(`  3. wire inferenceHandler into your Hono app, then start it`);
          } else if (sub === "nft-mint-with-inference") {
            console.log(`  3. npx tsx nft-metadata.ts "My NFT" "concept goes here"`);
          } else {
            console.log(`  3. npx tsx lightchain-inference.ts "your prompt"`);
          }
        } else if (sub === "worker-operator") {
          console.log(`  2. cp .env.example .env  (put the WORKER's own funded ${result.network} key in PRIVATE_KEY)`);
          console.log(`  3. npx tsx worker-ops.ts status   # registration, stake, claimable, gas, prioritized to-do`);
          console.log(`     then: settle | clearstuck | withdraw | deregister | profitability  (see WORKER-OPS-README.md)`);
          console.log(`     status prints JSON (todo[] + outOfGas) - drop it in cron to never sit on stuck jobs.`);
        } else if (sub === "batch") {
          console.log(`  2. cp .env.example .env  (put a funded ${result.network} PRIVATE_KEY in it)`);
          console.log(`  3. npx tsx batch.ts   # runs the example prompts in parallel; edit the prompts array`);
        } else if (sub === "bridge") {
          console.log(`  2. cp .env.example .env  (funded key on the SOURCE chain; the bridge is mainnet-only)`);
          console.log(`  3. BRIDGE_DIRECTION=lc-to-eth BRIDGE_AMOUNT=1 npx tsx bridge.ts`);
          console.log(`     lc-to-eth signs on LightChain; eth-to-lc signs on Ethereum (approve + transfer).`);
        } else {
          // analytics-dashboard - read-only, no private key needed.
          if (result.template === "nextjs-api") {
            console.log(`  2. npm run dev, open /lightnode-analytics`);
          } else {
            console.log(`  2. npx tsx lightnode-analytics.ts`);
          }
        }
        // Hosting note: the Docker setup we shipped is the recommended path.
        if (result.template === "nextjs-api"
            && (sub === "inference" || sub === "chat" || sub === "judge")) {
          console.log(`\n  Hosting: a mainnet inference takes 60-90s. The Dockerfile + docker-compose.yml`);
          console.log(`  we just dropped run a long-running Node server with no timeout - that's the`);
          console.log(`  recommended path (your laptop, a $5/mo VPS, anywhere Docker runs).`);
          console.log(`  Don't use Vercel Hobby (10s cap, every call times out). Vercel Pro works at`);
          console.log(`  60s if you'd rather stay on Vercel. See LIGHTNODE-HOSTING.md for the full table.`);
        }
      }
      if (result.network === "testnet") {
        console.log(`\nNo wallet yet? Make one:  npx lightnode wallet new   then fund it free below.`);
      }
      console.log(`\nFree testnet LCAI: https://lightfaucet.ai`);
      console.log(`Builder docs:     https://lightnode.app/build`);
      console.log(`New to all this?  See GETTING-STARTED.md in the lightnode repo.`);
      break;
    }
    case "batch": {
      // `lightnode batch <prompts.json>` or `lightnode batch -` (stdin).
      // Input shape: ["prompt one","prompt two"] OR
      //   { "model": "llama3-8b", "system": "...", "prompts": ["...", "..."] }
      // Output: one JSON object per line (index, answer or error). Composes
      // with `jq` for downstream processing.
      const arg = positionals[1] ?? "";
      if (!arg) die("usage: lightnode batch <prompts.json>   (or `lightnode batch -` to read stdin)");
      const raw = await (arg === "-" ? readStdin() : readFile(arg));
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        die("invalid JSON: " + (e as Error).message);
      }
      const cfg = normalizeBatchInput(parsed);
      const model = flag("--model") ?? cfg.model ?? "llama3-8b";
      const concurrency = Number(flag("--concurrency") ?? "4") || 4;
      const privateKey = pickKey();
      process.stderr.write(`Running ${cfg.prompts.length} prompts on ${net} via ${model} (concurrency=${concurrency})\n`);
      const results = await runInferenceBatch({
        network: net,
        privateKey,
        model,
        system: cfg.system,
        concurrency,
        prompts: cfg.prompts,
        onSlotComplete: ({ index, result, error }) => {
          process.stdout.write(JSON.stringify({
            index,
            ok: error == null,
            answer: result?.answer ?? null,
            error: error?.message ?? null,
            jobId: result?.jobId.toString() ?? error?.jobId ?? null,
          }) + "\n");
        },
      });
      const okCount = results.filter((r) => r.error == null).length;
      process.stderr.write(`Done: ${okCount}/${results.length} succeeded\n`);
      break;
    }
    case "agent": {
      // Quick one-shot agent demo: built-in `add` + `now` tools. Bring the
      // model your prompt as positional args (or pipe via stdin) and watch
      // the step trace on stderr while the answer streams to stdout.
      const inline = positionals.slice(1).join(" ").trim();
      const task = inline || (await readStdin()).trim();
      if (!task) die("usage: lightnode agent <task>   (or pipe the task to stdin)");
      const model = flag("--model") ?? "llama3-8b";
      const maxIter = Number(flag("--max-iter") ?? "4") || 4;
      const privateKey = pickKey();
      // A tiny built-in toolset so the command is runnable without writing
      // a wrapper. For real tools, import Agent from the SDK and pass your own.
      const tools: AgentTool[] = [
        {
          name: "add",
          description: "Add two integers and return the sum.",
          args: { a: "first integer", b: "second integer" },
          handler: ({ a, b }) => Number(a) + Number(b),
        },
        {
          name: "now",
          description: "Return the current ISO timestamp.",
          args: {},
          handler: () => new Date().toISOString(),
        },
      ];
      const agent = new Agent({
        network: net,
        privateKey,
        model,
        system: "You are a careful assistant. Use tools when they help; otherwise answer directly.",
        tools,
        maxIterations: maxIter,
        onStep: (step) => {
          if (step.kind === "tool_call") {
            process.stderr.write(`[tool] ${step.name}(${JSON.stringify(step.args)}) -> ${JSON.stringify(step.result)}\n`);
          } else if (step.kind === "tool_error") {
            process.stderr.write(`[tool-error] ${step.name}: ${step.error}\n`);
          } else if (step.kind === "thought") {
            process.stderr.write(`[think] ${step.text.slice(0, 200)}\n`);
          }
        },
      });
      try {
        const { answer, steps, iterations, hitLimit } = await agent.run(task);
        process.stdout.write(answer + "\n");
        process.stderr.write(JSON.stringify({ iterations, steps: steps.length, hitLimit }) + "\n");
      } catch (e) {
        die("agent failed: " + (e as Error).message);
      }
      break;
    }
    default:
      console.log(HELP);
  }
}

async function readStdin(): Promise<string> {
  return new Promise<string>((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => resolve(buf));
  });
}

async function readFile(path: string): Promise<string> {
  const fs = await import("node:fs/promises");
  return fs.readFile(path, "utf8");
}

function normalizeBatchInput(parsed: unknown): { prompts: string[]; system?: string; model?: string } {
  if (Array.isArray(parsed)) {
    const prompts = parsed.filter((p): p is string => typeof p === "string");
    if (!prompts.length) die("batch input: array must contain at least one string prompt");
    return { prompts };
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as { prompts?: unknown; system?: unknown; model?: unknown };
    const prompts = Array.isArray(obj.prompts) ? obj.prompts.filter((p): p is string => typeof p === "string") : [];
    if (!prompts.length) die("batch input: object must have a `prompts` array of strings");
    return {
      prompts,
      system: typeof obj.system === "string" ? obj.system : undefined,
      model: typeof obj.model === "string" ? obj.model : undefined,
    };
  }
  die("batch input: expected JSON array of strings OR object { prompts, system?, model? }");
  return { prompts: [] };
}

main().catch((e) => die(String(e?.message ?? e)));
