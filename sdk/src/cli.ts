#!/usr/bin/env node
import { LightNode, modelStatsCsv, workerStatsCsv, workerJobsCsv, type NetworkId } from "./index.js";

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

  network              network summary (workers, jobs, models, earnings)
  models               registered models + per-job fee
  worker <addr>        a worker: on-chain registration + recent jobs
  jobs <addr> [--csv]  one worker's job history (table or CSV)
  registered <addr>    true | false | null (read from chain events)
  fee [model]          on-chain inference fee (default llama3-8b)
  analytics [--csv]    per-model performance (completion, p50/p95, incomplete)
  reliability [--csv]  per-worker reliability, busiest first`;

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
    default:
      console.log(HELP);
  }
}

main().catch((e) => die(String(e?.message ?? e)));
