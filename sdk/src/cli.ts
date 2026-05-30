#!/usr/bin/env node
import { LightNode, modelStatsCsv, workerStatsCsv, workerJobsCsv, type NetworkId } from "./index.js";
import { addInference, addAnalyticsDashboard, addNftMint, addChat } from "./add.js";

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

  network                  network summary (workers, jobs, models, earnings)
  models                   registered models + per-job fee
  worker <addr>            a worker: on-chain registration + recent jobs
  jobs <addr> [--csv]      one worker's job history (table or CSV)
  registered <addr>        true | false | null (read from chain events)
  fee [model]              on-chain inference fee (default llama3-8b)
  analytics [--csv]        per-model performance (completion, p50/p95, incomplete)
  reliability [--csv]      per-worker reliability, busiest first

  add inference                   end-to-end encrypted inference route/script
  add chat                        chat-style UI with conversation history
  add analytics-dashboard         read-only network + worker analytics page
  add nft-mint-with-inference     AI-generated NFT metadata (provenance on-chain)
                                  (all add commands: [--template auto|nextjs-api|hono|node] [--force])

To scaffold a new project instead, run: npm create lightnode-app my-app`;

async function main() {
  const ln = new LightNode(net);
  switch (cmd) {
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
      const addr = positionals[1] ?? die("usage: lightnode worker <address> [--net testnet]");
      const [w, registered, jobs] = await Promise.all([ln.getWorker(addr), ln.isRegistered(addr), ln.getWorkerJobs(addr, 5)]);
      console.log(JSON.stringify({ onchainRegistered: registered, worker: w, recentJobs: jobs.map((j) => ({ id: j.id, state: j.state })) }, null, 2));
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
    case "add": {
      const sub = positionals[1];
      const template = (flag("--template") as "auto" | "nextjs-api" | "hono" | "node" | undefined) ?? "auto";
      const force = process.argv.includes("--force");
      const network = (net === "mainnet" ? "mainnet" : "testnet") as "mainnet" | "testnet";
      const known = ["inference", "chat", "analytics-dashboard", "nft-mint-with-inference"];
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
        if (sub === "nft-mint-with-inference" || sub === "inference" || sub === "chat") {
          console.log(`  2. cp .env.example .env  (and put a funded ${result.network} PRIVATE_KEY in it)`);
          if (sub === "chat" && result.template === "nextjs-api") {
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
