"use client";

/**
 * Preview seam for the worker-liveness banner. The banner only renders when a
 * worker genuinely has jobs stuck past their deadline, which is (correctly) rare,
 * so there is normally no way to eyeball the UI on demand. Appending
 * `?demo=liveness` to the dashboard or any worker page injects this representative
 * report so the banner renders over whatever worker is shown - no live stuck
 * worker required. Read-only and opt-in; it changes nothing on-chain.
 */
import { useEffect, useState } from "react";
import type { WorkerLivenessReport } from "lightnode-sdk";

/**
 * A representative "stalled worker" report, mirroring the real mainnet case that
 * motivated the diagnostic: 3 jobs Submitted but never acknowledged, all past the
 * ack deadline, ~3000 LCAI (6%) at risk, reaching the suspension threshold.
 */
export const DEMO_LIVENESS: WorkerLivenessReport = {
  address: "0xdemo000000000000000000000000000000000000",
  status: "active",
  liveness: "stalled",
  lastSeenAgoSec: 166_000,
  activeJobCount: 3,
  stuckJobs: [
    { id: "981", kind: "unacked", state: "Submitted", deadlineAtSec: 0, pastDeadlineSec: 166_000, slashBps: 200 },
    { id: "965", kind: "unacked", state: "Submitted", deadlineAtSec: 0, pastDeadlineSec: 173_000, slashBps: 200 },
    { id: "963", kind: "unacked", state: "Submitted", deadlineAtSec: 0, pastDeadlineSec: 180_000, slashBps: 200 },
  ],
  unackedCount: 3,
  incompleteCount: 0,
  slashExposureBps: 600,
  slashExposureLcai: 3000,
  suspensionThreshold: 3,
  suspensionRisk: true,
  summary:
    "3 assigned but never acknowledged (worker offline), up to ~3000 LCAI at risk if timed out; reaching the suspension threshold.",
};

/**
 * True when the page URL carries `?demo=liveness`. Read client-side after mount
 * so it never touches `window` during SSR (returns false until then).
 */
export function useLivenessDemo(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      setOn(new URLSearchParams(window.location.search).get("demo") === "liveness");
    } catch {
      setOn(false);
    }
  }, []);
  return on;
}
