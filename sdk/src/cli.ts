#!/usr/bin/env node
import { LightNode, modelStatsCsv, workerStatsCsv, workerJobsCsv, runInferenceWithKey, runInferenceBatch, Agent, isStalledWorker, workerPreflight, workerWatch, WorkerOperator, isWorkerOpError, BRIDGE_ROUTE, DAO, DAO_ADDRESSES, type NetworkId, type AgentTool } from "./index.js";
import { addInference, addAnalyticsDashboard, addNftMint, addChat, addChatWeb3, addAgent, addJudge } from "./add.js";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const positionals = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const cmd = positionals[0];
const net = (flag("--net") as NetworkId) || "mainnet";
const csv = process.argv.includes("--csv");

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}
const lcai = (wei?: string) => (wei ? Number(BigInt(wei)) / 1e18 : 0);
const rate = (r: number | null) => (r == null ? "-" : `${Math.round(r * 100)}%`);

const HELP = `lightnode <command> [--net mainnet|testnet]

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

Scaffold templates into the current project:
  add inference                   end-to-end encrypted inference route/script
  add chat                        chat-style UI with conversation history
  add agent                       scheduled/loop inference (cron-style)
  add analytics-dashboard         read-only network + worker analytics page
  add nft-mint-with-inference     AI-generated NFT metadata (provenance on-chain)
                                  (all add commands: [--template auto|nextjs-api|hono|node] [--force])

To scaffold a new project instead, run: npm create lightnode-app my-app`;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new WorkerOperator(n.network, { publicClient: publicClient as any, workerAddress: address as `0x${string}` });
}

/** A write-capable WorkerOperator signed by PRIVATE_KEY / --key. The viem clients
 *  are cast to the SDK's structural Minimal* types (same boundary cast the
 *  inference module uses) - viem's strict writeContract union does not accept the
 *  intentionally-loose Minimal shape directly. */
function writeOperator(n: LightNode): WorkerOperator {
  const chain = viemChain(n);
  const account = privateKeyToAccount(pickKey());
  const publicClient = createPublicClient({ transport: http(n.network.rpc), chain });
  const walletClient = createWalletClient({ account, transport: http(n.network.rpc), chain });
  return new WorkerOperator(n.network, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publicClient: publicClient as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    walletClient: walletClient as any,
  });
}

/** The worker's job IDs from the indexer, used to drive on-chain settle/clear. */
async function workerJobIds(n: LightNode, address: string): Promise<number[]> {
  const jobs = await n.getWorkerJobs(address, 100);
  return jobs.map((j) => Number(j.id)).filter((x) => Number.isFinite(x));
}

async function main() {
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
      for (const m of await ln.getModels()) {
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
      if (sub === "can-deregister") {
        const op = writeOperator(ln);
        const ids = await workerJobIds(ln, privateKeyToAccount(pickKey()).address);
        const r = await op.canDeregister(ids);
        console.log(JSON.stringify({ ok: r.ok, blockedBy: r.blockedBy.map(String), reason: r.reason }, null, 2));
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
        console.log(JSON.stringify({ released: rel.released.map((r) => ({ jobId: r.jobId.toString(), tx: r.tx })), notReady: rel.notReady.map(String), withdrawTx: withdrawTx ?? null }, null, 2));
        break;
      }
      if (sub === "clearstuck") {
        const op = writeOperator(ln);
        const addr = privateKeyToAccount(pickKey()).address;
        const ids = await workerJobIds(ln, addr);
        if (net === "mainnet" && !process.argv.includes("--yes")) {
          const cfg = await op.config();
          die(`clearstuck finalizes stuck jobs as TimedOut, realizing a ${cfg.slashBps.completionTimeout / 100}% slash per job on mainnet. Re-run with --yes to confirm.`);
        }
        console.error(`> clearing stuck (acknowledged, past-deadline) jobs on ${net}...`);
        const r = await op.clearStuck(ids);
        console.log(JSON.stringify({ cleared: r.cleared.map((c) => ({ jobId: c.jobId.toString(), tx: c.tx })), skipped: r.skipped.map(String) }, null, 2));
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
        if (net === "mainnet" && !process.argv.includes("--yes")) {
          die("deregister on mainnet may require clearing stuck jobs first (which realizes a slash). Run 'worker can-deregister' to check, then re-run with --yes.");
        }
        try {
          const r = await op.unstickAndDeregister(ids);
          console.log(JSON.stringify({ cleared: r.cleared.map((c) => c.jobId.toString()), released: r.released.map((c) => c.jobId.toString()), withdrawTx: r.withdrawTx ?? null, deregisterTx: r.deregisterTx }, null, 2));
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
      const addr = sub ?? die("usage: lightnode worker <address|watch|preflight|status|models|can-deregister|settle|clearstuck|withdraw|deregister> [...]");
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
      if (csv) {
        console.log(modelStatsCsv(stats));
      } else {
        for (const s of stats) console.log(`${s.name}\t${s.total}j\t${rate(s.completionRate)}\tp50 ${s.p50 ?? "-"}s\tp95 ${s.p95 ?? "-"}s\tinc ${s.incomplete}\t${s.earnings.toFixed(3)} LCAI`);
      }
      break;
    }
    case "reliability": {
      const workers = await ln.getWorkerStats(1000, 20);
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
        // PublicClient satisfies it. The unknown cast is the standard SDK pattern
        // for keeping the public API free of viem generic noise.
        const dao = new DAO(pub as unknown as ConstructorParameters<typeof DAO>[0], "ethereum");
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
      const known = ["inference", "chat", "chat-web3", "agent", "judge", "analytics-dashboard", "nft-mint-with-inference"];
      if (!known.includes(sub ?? "")) {
        die(`usage: lightnode add <${known.join("|")}> [--template auto|nextjs-api|hono|node] [--net testnet|mainnet] [--force]`);
      }
      const result =
        sub === "analytics-dashboard"
          ? addAnalyticsDashboard({ template, network, force })
          : sub === "nft-mint-with-inference"
            ? addNftMint({ template, network, force })
            : sub === "chat-web3"
              ? addChatWeb3({ template, network, force })
              : sub === "chat"
                ? addChat({ template, network, force })
                : sub === "agent"
                  ? addAgent({ template, network, force })
                  : sub === "judge"
                    ? addJudge({ template, network, force })
                    : addInference({ template, network, force });
      console.log(`▶ add ${sub} (${result.template} template, default network ${result.network})`);
      for (const f of result.written) {
        if (f.skipped) console.log(`  ⤴ ${f.path} (skipped - ${f.reason})`);
        else console.log(`  ✓ ${f.path}`);
      }
      const anyWritten = result.written.some((f) => !f.skipped);
      if (!anyWritten) {
        console.log("\nNothing to do - all target files already exist. Pass --force to overwrite.");
      } else {
        console.log(`\nNext steps (these files were added to your CURRENT folder, not a new project):`);
        console.log(`  1. ${result.install}`);
        if (sub === "chat-web3") {
          // chat-web3 has no PRIVATE_KEY (each visitor pays their own way).
          const needsWagmi = (result as { needsWagmi?: boolean }).needsWagmi;
          if (needsWagmi) {
            console.log(`  2. Set up wagmi in your app if you have not already.`);
            console.log(`     See https://wagmi.sh/react/getting-started - wrap your root layout with`);
            console.log(`     <WagmiProvider config={wagmiConfig}> and add a Connect button using`);
            console.log(`     useConnect / RainbowKit / Reown AppKit / ConnectKit, whatever you prefer.`);
            console.log(`  3. npm run dev, open /chat-web3`);
            console.log(`  4. Connect a wallet on LightChain ${result.network === "mainnet" ? "mainnet (chainId 9200)" : "testnet (chainId 8200)"}.`);
            console.log(`     Mainnet llama3-8b costs 0.02 LCAI per turn; testnet is free from https://lightfaucet.ai`);
          } else {
            console.log(`  2. npm run dev, open /chat-web3`);
            console.log(`  3. Connect a wallet on LightChain ${result.network === "mainnet" ? "mainnet (chainId 9200)" : "testnet (chainId 8200)"}.`);
            console.log(`     Mainnet llama3-8b costs 0.02 LCAI per turn; testnet is free from https://lightfaucet.ai`);
          }
        } else if (sub === "nft-mint-with-inference" || sub === "inference" || sub === "chat" || sub === "agent" || sub === "judge") {
          console.log(`  2. cp .env.example .env  (and put a funded ${result.network} PRIVATE_KEY in it)`);
          if (sub === "agent" && result.template === "nextjs-api") {
            console.log(`  3. Set CRON_SECRET in your Vercel env vars + edit AGENT_TASK in .env`);
            console.log(`  4. Deploy. Vercel Cron fires /api/agent on the schedule in vercel.json`);
          } else if (sub === "agent") {
            console.log(`  3. AGENT_INTERVAL_MS=3600000 npx tsx agent.ts   # or run under pm2/systemd`);
          } else if (sub === "chat" && result.template === "nextjs-api") {
            console.log(`  3. Make sure /api/inference is mounted too (run: npx lightnode add inference)`);
            console.log(`  4. npm run dev, open /chat`);
          } else if (sub === "chat") {
            console.log(`  3. npx tsx chat-repl.ts  (interactive terminal chat)`);
          } else if (sub === "judge" && result.template === "nextjs-api") {
            console.log(`  3. npm run dev`);
            console.log(`  4. curl -X POST localhost:3000/api/judge -H 'content-type: application/json' \\\\`);
            console.log(`         -d '{"criteria":"Run a mile under 8 minutes","evidence":{"time_minutes":7.4,"distance_km":1.61}}'`);
          } else if (sub === "judge") {
            console.log(`  3. npx tsx judge.ts 'Run a mile under 8 minutes' '{"time_minutes":7.4,"distance_km":1.61}'`);
          } else if (sub === "nft-mint-with-inference" && result.template === "nextjs-api") {
            console.log(`  3. Make sure /api/inference is mounted too (run: npx lightnode add inference)`);
            console.log(`  4. npm run dev, open /nft-mint`);
          } else if (result.template === "nextjs-api") {
            console.log(`  3. npm run dev  (then POST /api/inference)`);
          } else if (result.template === "hono") {
            console.log(`  3. wire inferenceHandler into your Hono app, then start it`);
          } else if (sub === "nft-mint-with-inference") {
            console.log(`  3. npx tsx nft-metadata.ts "My NFT" "concept goes here"`);
          } else {
            console.log(`  3. npx tsx lightchain-inference.ts "your prompt"`);
          }
        } else {
          // analytics-dashboard - read-only, no private key needed.
          if (result.template === "nextjs-api") {
            console.log(`  2. npm run dev, open /lightnode-analytics`);
          } else {
            console.log(`  2. npx tsx lightnode-analytics.ts`);
          }
        }
        if (result.network === "testnet") {
          console.log(`\nNo wallet yet? Make one:  npx lightnode wallet new   then fund it free below.`);
        }
        console.log(`\nFree testnet LCAI: https://lightfaucet.ai`);
        console.log(`Builder docs:     https://lightnode.app/build`);
        console.log(`New to all this?  See GETTING-STARTED.md in the lightnode repo.`);
      }
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
