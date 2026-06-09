/**
 * Read-only preview endpoint for the WorkerOperator SDK. Drives the
 * /build/sdks/operator stepper.
 *
 *   GET /api/operator-preview?action=config&net=testnet|mainnet
 *   GET /api/operator-preview?action=status&net=...&worker=0x...
 *
 * Returns plain JSON safe to render in the widget. Write actions
 * (claimTimeout, releaseAll, withdraw, deregister, ...) live in the
 * SDK only - the visitor runs them with their own funded key in
 * StackBlitz or a local Node script.
 */
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { WorkerOperator, NETWORKS, LightNode, type NetworkId } from "lightnode-sdk";

const STUCK_DEADLINE_SEC = 60 * 60; // SDK default completion timeout

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "";
    const netParam = (url.searchParams.get("net") ?? "mainnet") as NetworkId;
    const net: NetworkId = netParam === "testnet" ? "testnet" : "mainnet";
    const network = NETWORKS[net];
    if (!network) return bad("unknown network");
    const publicClient = createPublicClient({ transport: http(network.rpc) });
    // The SDK's WorkerOperator constructor requires a workerAddress or
    // walletClient even when the call doesn't need one (eg. config). Pass
    // a sentinel address for config-only reads.
    const SENTINEL: `0x${string}` = "0x0000000000000000000000000000000000000001";
    if (action === "config") {
      const op = new WorkerOperator(network, {
        publicClient: publicClient as unknown as ConstructorParameters<typeof WorkerOperator>[1]["publicClient"],
        workerAddress: SENTINEL,
      });
      const cfg = await op.config();
      return NextResponse.json({
        action: "config",
        net,
        config: {
          minStakeLcai: cfg.minStakeLcai,
          completionTimeoutSec: cfg.completionTimeoutSec,
          ackTimeoutSec: cfg.ackTimeoutSec,
          resolutionTimeoutSec: cfg.resolutionTimeoutSec,
          disputeWindowSec: cfg.disputeWindowSec,
          slashBps: cfg.slashBps,
          feeBps: cfg.feeBps,
          suspensionThreshold: cfg.suspensionThreshold,
          suspensionCooldownSec: cfg.suspensionCooldownSec,
        },
      });
    }
    if (action === "status") {
      const worker = url.searchParams.get("worker") ?? "";
      if (!/^0x[0-9a-fA-F]{40}$/.test(worker)) return bad("worker: pass a valid 0x address");
      const op = new WorkerOperator(network, {
        publicClient: publicClient as unknown as ConstructorParameters<typeof WorkerOperator>[1]["publicClient"],
        workerAddress: worker as `0x${string}`,
      });
      const ln = new LightNode(network);
      // Fan out: on-chain operator status, native LCAI balance, subgraph
      // worker record (lifetime counts + last-seen), recent jobs (for
      // bucketing into pending-release / stuck / released / timed-out),
      // on-chain model registrations for this worker (the authoritative
      // "what is this worker offering" signal), and the model registry
      // (to map model_id back to a human name). The whole panel resolves
      // in a single tab of round-trips.
      const [st, walletWei, w, jobs, served] = await Promise.all([
        op.status(),
        publicClient.getBalance({ address: worker as `0x${string}` }),
        ln.getWorker(worker),
        ln.getWorkerJobs(worker, 50),
        // Reconciled list: subgraph WorkerModel rows joined to the model
        // registry AND to on-chain WorkerRegistry.isEligible. The indexer
        // keeps stale is_active=true rows after a deregister -> re-register
        // cycle, so the subgraph alone says "still serving llama3-8b" even
        // when the chain says otherwise. onchainEligible is the truth.
        ln.getServedModels(worker),
      ]);
      // Pending release: completed but not yet released. Released: paid out.
      // Stuck: acknowledged past the completion deadline.
      // Timed-out: lifetime counter from the indexer.
      // In-flight: submitted/acknowledged and still inside the deadline.
      const nowSec = Math.floor(Date.now() / 1000);
      const buckets = jobs.reduce(
        (acc: { released: number; pendingRelease: number; stuck: number; inFlight: number }, j) => {
          const state = (j.state ?? "").toLowerCase();
          if (state.includes("released") || state.includes("resolved") || state.includes("paid")) {
            acc.released += 1;
          } else if (state.includes("complet")) {
            acc.pendingRelease += 1;
          } else if (state.includes("ack")) {
            const since = j.ack_at ? nowSec - j.ack_at : 0;
            if (since > STUCK_DEADLINE_SEC) acc.stuck += 1;
            else acc.inFlight += 1;
          } else if (state.includes("submitted")) {
            acc.inFlight += 1;
          }
          return acc;
        },
        { released: 0, pendingRelease: 0, stuck: 0, inFlight: 0 },
      );
      // Models: reconciled list (subgraph WorkerModel rows joined to the
      // on-chain WorkerRegistry.isEligible read). The widget cares about:
      //   - rows where onchainEligible === true: the worker is ACTUALLY
      //     serving this right now. Render as 'live'.
      //   - rows where onchainEligible === false but indexedActive: stale
      //     index row left over after a deregister -> re-register with a
      //     different model. Render as 'stale' or omit.
      //   - rows where onchainEligible === null: chain read failed; fall
      //     back to indexedActive with a softer badge.
      const registeredModels = served.map((sm) => ({
        id: sm.modelId,
        name: sm.name,
        // The single source of truth the widget should default to.
        isLive: sm.onchainEligible === true,
        // Stale = indexer still says active but the chain has moved on.
        isStale: sm.onchainEligible === false && sm.indexedActive,
        // Chain read failed; let the UI know to soften the label.
        onchainUnknown: sm.onchainEligible === null,
        indexedActive: sm.indexedActive,
      }))
      // Live first, then stale, then removed.
      .sort((a, b) => {
        const score = (m: typeof a) => (m.isLive ? 0 : m.isStale ? 1 : 2);
        return score(a) - score(b);
      });
      const lifetimeEarnedLcai = w?.total_earned ? Number(BigInt(w.total_earned)) / 1e18 : 0;
      return NextResponse.json({
        action: "status",
        net,
        worker,
        status: {
          address: st.address,
          registered: st.registered,
          stakeLcai: st.stakeLcai,
          headroomLcai: st.headroomLcai,
          belowFloor: st.belowFloor,
          claimableLcai: st.claimableLcai,
          walletBalanceLcai: Number(walletWei) / 1e18,
          // Activity (subgraph-backed)
          subgraphStatus: w?.status ?? null, // active | deactivated | deregistered
          activeJobCount: w?.active_job_count ?? 0,
          lifetimeJobsCompleted: w?.jobs_completed ?? 0,
          lifetimeJobsTimedOut: w?.jobs_timed_out ?? 0,
          lifetimeEarnedLcai,
          lastSeenAt: w?.last_seen_at ?? null,
          createdAt: w?.created_at ?? null,
          // Buckets derived from recent jobs (last 50)
          recentReleased: buckets.released,
          recentPendingRelease: buckets.pendingRelease,
          recentStuck: buckets.stuck,
          recentInFlight: buckets.inFlight,
          // On-chain model registrations (authoritative)
          registeredModels,
        },
      });
    }
    if (action === "job") {
      // Classify any job by id, and surface everything an operator needs to
      // act: the indexer's classification + tx hashes (deep-link to submitJob /
      // jobCompleted), the AUTHORITATIVE on-chain struct (ack/deadline/completed
      // timestamps + escrow, so the UI can show the real timeline against the
      // real deadline), and the live protocol params (timeouts, slash bps,
      // suspension) so penalties are concrete, not hand-waved.
      const jobIdRaw = url.searchParams.get("jobId") ?? "";
      if (!/^\d+$/.test(jobIdRaw)) return bad("jobId: pass a positive integer id");
      const ln = new LightNode(network);
      const opForCfg = new WorkerOperator(network, {
        publicClient: publicClient as unknown as ConstructorParameters<typeof WorkerOperator>[1]["publicClient"],
        workerAddress: SENTINEL,
      });
      const [status, onchain, cfg] = await Promise.all([
        ln.getJobStatus(jobIdRaw, { withTransactions: true }),
        ln.getJobOnchain(BigInt(jobIdRaw)).catch(() => null),
        opForCfg.config().catch(() => null),
      ]);
      return NextResponse.json({
        action: "job",
        net,
        jobId: jobIdRaw,
        status,
        // BigInts serialised to JSON-safe numbers (fee -> whole LCAI).
        onchain: onchain
          ? {
              stateIndex: onchain.stateIndex,
              submittedAt: onchain.submittedAt,
              ackAt: onchain.ackAt,
              completedAt: onchain.completedAt,
              deadlineAt: onchain.deadlineAt,
              escrowedFeeLcai: Number(onchain.escrowedFeeWei) / 1e18,
              worker: onchain.worker,
            }
          : null,
        protocol: cfg
          ? {
              ackTimeoutSec: cfg.ackTimeoutSec,
              completionTimeoutSec: cfg.completionTimeoutSec,
              resolutionTimeoutSec: cfg.resolutionTimeoutSec,
              disputeWindowSec: cfg.disputeWindowSec,
              slashBps: cfg.slashBps,
              suspensionThreshold: cfg.suspensionThreshold,
              suspensionCooldownSec: cfg.suspensionCooldownSec,
            }
          : null,
        explorer: { base: network.explorer },
      });
    }
    if (action === "risk") {
      // Suspension & slashing transparency: combine the live on-chain reads
      // (WorkerRegistry.isEligible per served model = the authoritative "jailed"
      // signal; stake vs floor) with the indexer (lifetime timeouts, stuck jobs)
      // and AIConfig (slash bps + suspension threshold/cooldown) into a single
      // risk picture. LightChain's own explorer shows a "Jailed" badge; we show
      // WHY, HOW CLOSE to suspension, and HOW MUCH stake is at risk right now.
      const worker = url.searchParams.get("worker") ?? "";
      if (!/^0x[0-9a-fA-F]{40}$/.test(worker)) return bad("worker: pass a valid 0x address");
      const op = new WorkerOperator(network, {
        publicClient: publicClient as unknown as ConstructorParameters<typeof WorkerOperator>[1]["publicClient"],
        workerAddress: worker as `0x${string}`,
      });
      const ln = new LightNode(network);
      const [st, cfg, liveness, w, served] = await Promise.all([
        op.status(),
        op.config(),
        ln.getWorkerLiveness(worker),
        ln.getWorker(worker),
        ln.getServedModels(worker),
      ]);
      const servedModels = served.map((m) => ({ modelId: m.modelId, name: m.name, eligible: m.onchainEligible }));
      const anyEligibleTrue = servedModels.some((m) => m.eligible === true);
      const anyEligibleFalse = servedModels.some((m) => m.eligible === false);
      // Derived standing. "suspended" is the on-chain jailed signal: registered
      // and above the stake floor, but isEligible() is false for every model it
      // serves (and not merely an unavailable chain read).
      const verdict = !st.registered
        ? "unregistered"
        : st.belowFloor
          ? "below-floor"
          : servedModels.length === 0
            ? "no-models"
            : anyEligibleTrue
              ? "active"
              : anyEligibleFalse
                ? "suspended"
                : "active"; // all eligibility reads unknown - don't false-alarm
      return NextResponse.json({
        action: "risk",
        net,
        worker,
        standing: {
          registered: st.registered,
          stakeLcai: st.stakeLcai,
          minStakeLcai: cfg.minStakeLcai,
          belowFloor: st.belowFloor,
          headroomLcai: st.headroomLcai,
          servedModels,
          verdict,
        },
        suspension: {
          lifetimeTimeouts: w?.jobs_timed_out ?? 0,
          threshold: cfg.suspensionThreshold,
          cooldownSec: cfg.suspensionCooldownSec,
          stuckNow: liveness.stuckJobs.length,
          atRisk: liveness.suspensionRisk,
        },
        slash: {
          exposureLcai: liveness.slashExposureLcai,
          exposureBps: liveness.slashExposureBps,
          maxBps: cfg.slashBps.max,
          stuckJobs: liveness.stuckJobs.map((s) => ({
            id: s.id,
            kind: s.kind,
            slashBps: s.slashBps,
            pastDeadlineSec: s.pastDeadlineSec,
          })),
        },
        schedule: {
          ackTimeoutBps: cfg.slashBps.ackTimeout,
          completionTimeoutBps: cfg.slashBps.completionTimeout,
          disputeBps: cfg.slashBps.dispute,
          maxBps: cfg.slashBps.max,
        },
      });
    }
    return bad("unknown action - try 'config', 'status', 'job', or 'risk'");
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message?.split("\n")[0] ?? "fetch failed" },
      { status: 500 },
    );
  }
}
