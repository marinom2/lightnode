/**
 * Plain-text worker diagnostics report for copy-paste into support or an issue.
 * Pure (no React, no I/O) so it is shared by the Action Center panel and the
 * Operations panel and can be unit-tested directly.
 */
import { fmt } from "@/lib/utils";
import { classifyJobs } from "@/lib/analytics";
import type { Job } from "@/lib/subgraph";
import type { WorkerActionCenter } from "lightnode-sdk";

export function buildDiagnosticsReport(a: WorkerActionCenter, jobs: Job[], nowSec = Math.floor(Date.now() / 1000)): string {
  const b = classifyJobs(jobs, nowSec);
  const lv = a.liveness;
  const lines = [
    "LightChain worker diagnostics",
    `address:     ${a.address}`,
    `registered:  ${a.registered}   stake: ${fmt(a.stakeLcai, 0)} LCAI`,
    `wallet gas:  ${a.walletGasLcai} LCAI${a.outOfGas ? "   ** OUT OF GAS - settle/claim/deregister cannot be sent **" : ""}`,
    `claimable:   ${fmt(a.claimableLcai, 3)} LCAI (released, not yet withdrawn)`,
    `liveness:    ${lv.liveness}   last on-chain activity ${lv.lastSeenAgoSec == null ? "unknown" : `${Math.round(lv.lastSeenAgoSec / 3600)}h ago`}`,
    `stuck jobs:  ${lv.stuckJobs.length} (unacked ${lv.unackedCount}, incomplete ${lv.incompleteCount})${lv.slashExposureLcai > 0 ? `, ~${fmt(lv.slashExposureLcai, 0)} LCAI slash risk${lv.suspensionRisk ? " + suspension" : ""}` : ""}`,
    `settlement:  ${a.settlement.releasableNowCount} releasable now, ${a.settlement.inWindowCount} in dispute window, ${a.settlement.pendingReleaseCount} pending release`,
    `job history: ${b.total} jobs, ${b.success} settled, ${b.timedOut} timed out, ${b.stuck} stuck; completion ${b.completionRate == null ? "n/a" : `${Math.round(b.completionRate * 100)}%`}; p50 ${b.p50 ?? "n/a"}s, p95 ${b.p95 ?? "n/a"}s`,
    "actions:",
    ...(a.actions.length ? a.actions.map((x, i) => `  ${i + 1}. [${x.urgency}] ${x.title} - ${x.detail}`) : ["  (none)"]),
  ];
  return lines.join("\n");
}
