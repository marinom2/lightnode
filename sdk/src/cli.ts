#!/usr/bin/env node
import { LightNode, modelStatsCsv, workerStatsCsv, workerJobsCsv, runInferenceWithKey, isStalledWorker, workerPreflight, workerWatch, BRIDGE_ROUTE, DAO, DAO_ADDRESSES, type NetworkId } from "./index.js";
import { addInference, addAnalyticsDashboard, addNftMint, addChat, addAgent } from "./add.js";
import { createPublicClient, http, parseEther } from "viem";
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

Preflight (needs PRIVATE_KEY in env):
  worker preflight         run one real test inference, print verdict + timings
                           ([--key 0x...] [--model llama3-8b] [--deadline 60])

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
      // Default: one-shot worker summary by address.
      const addr = sub ?? die("usage: lightnode worker <address|watch|preflight> [...]");
      const [w, registered, jobs] = await Promise.all([ln.getWorker(addr), ln.isRegistered(addr), ln.getWorkerJobs(addr, 5)]);
      console.log(JSON.stringify({ onchainRegistered: registered, worker: w, recentJobs: jobs.map((j) => ({ id: j.id, state: j.state })) }, null, 2));
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
        const { createPublicClient, http } = await import("viem");
        const ethRpc = flag("--rpc") ?? "https://eth.llamarpc.com";
        const pub = createPublicClient({ transport: http(ethRpc) });
        // The DAO ctor accepts a structurally-typed MinimalPublicClient; viem's
        // PublicClient satisfies it. The unknown cast is the standard SDK pattern
        // for keeping the public API free of viem generic noise.
        const dao = new DAO(pub as unknown as ConstructorParameters<typeof DAO>[0], "ethereum");
        const cfg = await dao.config();
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
      const known = ["inference", "chat", "agent", "analytics-dashboard", "nft-mint-with-inference"];
      if (!known.includes(sub ?? "")) {
        die(`usage: lightnode add <${known.join("|")}> [--template auto|nextjs-api|hono|node] [--net testnet|mainnet] [--force]`);
      }
      const result =
        sub === "analytics-dashboard"
          ? addAnalyticsDashboard({ template, network, force })
          : sub === "nft-mint-with-inference"
            ? addNftMint({ template, network, force })
            : sub === "chat"
              ? addChat({ template, network, force })
              : sub === "agent"
                ? addAgent({ template, network, force })
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
        console.log(`\nNext steps:`);
        console.log(`  1. ${result.install}`);
        if (sub === "nft-mint-with-inference" || sub === "inference" || sub === "chat" || sub === "agent") {
          console.log(`  2. cp .env.example .env  (and put a funded ${result.network} PRIVATE_KEY in it)`);
          if (sub === "agent" && result.template === "nextjs-api") {
            console.log(`  3. Set CRON_SECRET in your Vercel env vars + edit AGENT_TASK in .env`);
            console.log(`  4. Deploy. Vercel Cron fires /api/agent on the schedule in vercel.json`);
          } else if (sub === "agent") {
            console.log(`  3. AGENT_INTERVAL_MS=3600000 tsx agent.ts   # or run under pm2/systemd`);
          } else if (sub === "chat" && result.template === "nextjs-api") {
            console.log(`  3. Make sure /api/inference is mounted too (run: npx lightnode add inference)`);
            console.log(`  4. npm run dev, open /chat`);
          } else if (sub === "chat") {
            console.log(`  3. tsx chat-repl.ts  (interactive terminal chat)`);
          } else if (sub === "nft-mint-with-inference" && result.template === "nextjs-api") {
            console.log(`  3. Make sure /api/inference is mounted too (run: npx lightnode add inference)`);
            console.log(`  4. npm run dev, open /nft-mint`);
          } else if (result.template === "nextjs-api") {
            console.log(`  3. npm run dev  (then POST /api/inference)`);
          } else if (result.template === "hono") {
            console.log(`  3. wire inferenceHandler into your Hono app, then start it`);
          } else if (sub === "nft-mint-with-inference") {
            console.log(`  3. tsx nft-metadata.ts "My NFT" "concept goes here"`);
          } else {
            console.log(`  3. tsx lightchain-inference.ts "your prompt"`);
          }
        } else {
          // analytics-dashboard - read-only, no private key needed.
          if (result.template === "nextjs-api") {
            console.log(`  2. npm run dev, open /lightnode-analytics`);
          } else {
            console.log(`  2. tsx lightnode-analytics.ts`);
          }
        }
        console.log(`\nFree testnet LCAI: https://lightfaucet.ai`);
        console.log(`Builder docs:     https://lightnode.app/build`);
      }
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => die(String(e?.message ?? e)));
