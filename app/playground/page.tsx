"use client";

/**
 * Live, in-browser encrypted-inference playground built directly on the published
 * lightnode-sdk. Connects the user's wallet (Reown/wagmi), runs the SIWE handshake
 * against the consumer gateway, prepares a session, signs createSession + submitJob
 * via viem, then opens the relay WebSocket and decrypts the streamed response with
 * the session key. Same code path the SDK consumers in any third-party dApp would
 * call - if it works here, the SDK works.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { parseAbi, parseAbiItem, parseEther, type Log } from "viem";
import { useAccount, usePublicClient, useWalletClient, useChainId, useSwitchChain } from "wagmi";
import {
  GatewayClient,
  prepareSession,
  submitPrompt,
  decryptResponse,
  estimateJobFee,
  JOB_REGISTRY_CONSUMER_ABI,
  NETWORKS,
  type NetworkId,
} from "lightnode-sdk";
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  ExternalLink,
  Loader2,
  PlayCircle,
  Send,
  Shield,
  Sparkles,
  Wallet2,
  Workflow,
  XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { ConnectButton } from "@/components/connect-button";
import { cn } from "@/lib/utils";

type Phase = "idle" | "auth" | "prepare" | "create" | "upload" | "submit" | "stream" | "done" | "error";

// Tracks every paid attempt + its eventual refund timing, so the operator can
// see why their wallet was charged multiple times if the first worker stalled.
interface StalledAttempt {
  jobId: string;
  worker: `0x${string}`;
  feeLcai: number;
  submitTx: `0x${string}`;
}

const MAX_ATTEMPTS = 3;

interface FlowState {
  phase: Phase;
  modelTag: string;
  modelId: `0x${string}` | null;
  feeLcai: number | null;
  sessionId: bigint | null;
  jobId: bigint | null;
  createTx: `0x${string}` | null;
  submitTx: `0x${string}` | null;
  // The worker's own commit-result transaction (where JobCompleted fires with
  // responseHash + ciphertextHash). It's NOT a tx the user signs; it's the
  // third party in the chain of proof and worth showing alongside the user's.
  completedTx: `0x${string}` | null;
  worker: `0x${string}` | null;
  output: string;
  error: string | null;
  elapsedMs: number;
  // Auto-retry bookkeeping.
  attempt: number; // 1..MAX_ATTEMPTS
  stalled: StalledAttempt[]; // every prior attempt whose worker silently stalled
  // True when the SIWE handshake was satisfied from the cached JWT (no wallet
  // popup needed). Surfaces in the UI as "auth reused (cached)".
  authCached: boolean;
}

const initial: FlowState = {
  phase: "idle",
  modelTag: "llama3-8b",
  modelId: null,
  feeLcai: null,
  sessionId: null,
  jobId: null,
  createTx: null,
  submitTx: null,
  completedTx: null,
  worker: null,
  output: "",
  error: null,
  elapsedMs: 0,
  attempt: 1,
  stalled: [],
  authCached: false,
};

// SIWE JWT cache so a builder running multiple prompts in the same browser
// session only signs the auth message once. Lives in sessionStorage (cleared
// on tab close), keyed by network+address, and gated by the issued-token
// expiry minus a 30s safety margin so we never hand back a JWT that's about
// to expire.
const JWT_KEY = (net: string, address: string) => `lc.playground.jwt.${net}.${address.toLowerCase()}`;
interface CachedJwt {
  token: string;
  expiresAt: number; // unix ms
}
function readCachedJwt(net: string, address: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(JWT_KEY(net, address));
    if (!raw) return null;
    const v = JSON.parse(raw) as CachedJwt;
    if (!v?.token || typeof v.expiresAt !== "number") return null;
    if (Date.now() > v.expiresAt - 30_000) return null;
    return v.token;
  } catch {
    return null;
  }
}
function writeCachedJwt(net: string, address: string, token: string, expiresAtIso: string): void {
  if (typeof window === "undefined") return;
  const expiresAt = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresAt)) return;
  try {
    window.sessionStorage.setItem(JWT_KEY(net, address), JSON.stringify({ token, expiresAt } satisfies CachedJwt));
  } catch {
    // sessionStorage may be unavailable (private mode); fall back to no caching.
  }
}

// Sentinel error thrown by the inference attempt when the worker acknowledged
// the job but never produced a result inside the deadline. Caught by the outer
// run() loop to trigger an automatic retry with a different worker.
class StalledWorkerError extends Error {
  constructor(public jobId: bigint, public worker: `0x${string}`, public submitTx: `0x${string}`, public feeLcai: number) {
    super("worker stalled");
    this.name = "StalledWorkerError";
  }
}

const STEPS: { id: Phase; label: string; icon: typeof Wallet2 }[] = [
  { id: "auth", label: "Authenticate", icon: Shield },
  { id: "prepare", label: "Prepare session", icon: Workflow },
  { id: "create", label: "Sign createSession", icon: Wallet2 },
  { id: "upload", label: "Encrypt & upload", icon: Send },
  { id: "submit", label: "Sign submitJob", icon: Wallet2 },
  { id: "stream", label: "Decrypt response", icon: Sparkles },
];

function StepIcon({ status }: { status: "pending" | "active" | "done" | "error" }) {
  if (status === "done")
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success/15 text-success">
        <CheckCircle2 className="size-3.5" />
      </span>
    );
  if (status === "error")
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive">
        <XCircle className="size-3.5" />
      </span>
    );
  if (status === "active")
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
        <Loader2 className="size-3.5 animate-spin" />
      </span>
    );
  return <span className="grid size-6 shrink-0 place-items-center rounded-full border border-bdr-soft text-content-soft" />;
}

function statusOf(currentPhase: Phase, stepPhase: Phase, error: boolean): "pending" | "active" | "done" | "error" {
  const order: Phase[] = ["auth", "prepare", "create", "upload", "submit", "stream", "done"];
  const ci = order.indexOf(currentPhase);
  const si = order.indexOf(stepPhase);
  if (error && currentPhase === stepPhase) return "error";
  if (ci > si) return "done";
  if (ci === si) return "active";
  return "pending";
}

const DEFAULT_PROMPT = "Reply with a one-sentence fun fact about the ocean.";
const TESTNET: NetworkId = "testnet";
const MAINNET: NetworkId = "mainnet";

export default function PlaygroundPage() {
  // Default to testnet so a first-time visitor's call costs nothing.
  const [net, setNet] = useState<NetworkId>(TESTNET);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [s, setS] = useState<FlowState>(initial);
  const [authPending, setAuthPending] = useState(false);
  const startRef = useRef<number>(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: NETWORKS[net].chainId });
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const cfg = NETWORKS[net];
  const expectedChain = cfg.chainId;
  const wrongChain = isConnected && chainId !== expectedChain;

  // Show elapsed time live so the operator sees progress even during the slowest stage.
  useEffect(() => {
    if (s.phase === "idle" || s.phase === "done" || s.phase === "error") {
      if (tickerRef.current) clearInterval(tickerRef.current);
      tickerRef.current = null;
      return;
    }
    if (!tickerRef.current) {
      tickerRef.current = setInterval(() => {
        setS((p) => ({ ...p, elapsedMs: Date.now() - startRef.current }));
      }, 250);
    }
    return () => {
      if (tickerRef.current && (s.phase === "done" || s.phase === "error")) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
    };
  }, [s.phase]);

  const reset = () => setS(initial);

  const run = async () => {
    if (!isConnected || !address || !walletClient || !publicClient) {
      setS({ ...initial, phase: "error", error: "Connect a wallet first." });
      return;
    }
    if (wrongChain && switchChainAsync) {
      try {
        await switchChainAsync({ chainId: expectedChain });
      } catch {
        setS({ ...initial, phase: "error", error: `Switch your wallet to chain ${expectedChain} and try again.` });
        return;
      }
    }
    if (!prompt.trim()) {
      setS({ ...initial, phase: "error", error: "Type a prompt first." });
      return;
    }

    startRef.current = Date.now();
    setS({ ...initial, phase: "auth" });
    // Capture narrowed handles so the inner runAttempt closure (which TS
    // doesn't narrow across function boundaries) doesn't re-widen them.
    const wal = walletClient;
    const pub = publicClient;
    // sockRef.current lives across an inner async closure; use a ref so TS doesn't
    // narrow it to `never` after the closure mutates it from the outer scope.
    const sockRef: { current: WebSocket | null } = { current: null };
    try {
      // === 1. SIWE handshake via our same-origin proxy ===
      // First try the cached JWT for this (network, address). When valid, the
      // user signs nothing here - one fewer wallet popup for repeat prompts in
      // the same browser session.
      const gwBase = `/api/gw/${net}`;
      let token = readCachedJwt(net, address);
      if (token) {
        setS((p) => ({ ...p, authCached: true }));
      } else {
        setAuthPending(true);
        const ch = await fetch(`${gwBase}/api/auth/challenge?address=${address}`, {
          headers: { Accept: "application/json" },
        }).then((r) => r.json() as Promise<{ message?: string }>);
        if (!ch?.message) throw new Error("auth challenge returned no message");
        const signature = await wal.signMessage({ message: ch.message });
        const verify = await fetch(`${gwBase}/api/auth/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ message: ch.message, signature }),
        }).then((r) => r.json() as Promise<{ token?: string; expiresAt?: string }>);
        if (!verify?.token) throw new Error("auth verify did not return a token");
        token = verify.token;
        if (verify.expiresAt) writeCachedJwt(net, address, token, verify.expiresAt);
        setAuthPending(false);
      }
      const gateway = new GatewayClient({ network: net, bearer: token, baseUrl: gwBase });

      // === 2..7. Retry loop. If a worker silently stalls (~5% of testnet)
      // we record the lost-fee attempt, ask the dispatcher for a fresh worker,
      // and run prepare -> createSession -> submitJob again with new wallet
      // signatures. The stalled escrow is reclaimed by the protocol's own
      // timeout/dispute pipeline (off the consumer's hot path), which is why
      // we don't try to call timeoutJob from here. Capped at MAX_ATTEMPTS so
      // a chronically broken testnet doesn't drain the wallet.
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        setS((p) => ({ ...p, attempt }));
        try {
          sockRef.current = await runAttempt(gateway);
          break; // success - leave the retry loop
        } catch (e) {
          if (e instanceof StalledWorkerError && attempt < MAX_ATTEMPTS) {
            // Remember this stalled attempt for the UI, close its WS, and loop.
            try {
              sockRef.current?.close();
            } catch {
              // ignore
            }
            sockRef.current = null;
            setS((p) => ({
              ...p,
              stalled: [
                ...p.stalled,
                { jobId: e.jobId.toString(), worker: e.worker, feeLcai: e.feeLcai, submitTx: e.submitTx },
              ],
            }));
            continue;
          }
          throw e;
        }
      }
      // (runAttempt sets phase "done" itself on the successful attempt.)
      return;
    } catch (err) {
      try {
        // TS narrows `sockRef.current` to never across the inner async closure; the
        // typed local reflects the real lifetime (any open WS we may still hold).
        // sockRef.current is the live WS, if any.
        sockRef.current?.close();
      } catch {
        // ignore
      }
      setAuthPending(false);
      setS((p) => ({ ...p, phase: "error", error: err instanceof Error ? err.message : String(err) }));
    }
    // ---- inner helper -----------------------------------------------------
    async function runAttempt(gateway: GatewayClient): Promise<WebSocket> {
      // === 2. Prepare session (pick a worker, wrap session key, get dispatcher sig) ===
      setS((p) => ({ ...p, phase: "prepare", createTx: null, submitTx: null, sessionId: null, jobId: null, output: "" }));
      const prepared = await prepareSession(gateway, "llama3-8b");
      const fee = await estimateJobFee(cfg, "llama3-8b");
      setS((p) => ({
        ...p,
        feeLcai: fee,
        worker: prepared.createSessionArgs.worker,
        modelId: prepared.createSessionArgs.paramsHash,
      }));

      // === 3. Sign createSession on-chain ===
      setS((p) => ({ ...p, phase: "create" }));
      const abi = parseAbi(JOB_REGISTRY_CONSUMER_ABI);
      const createTx = await wal.writeContract({
        address: cfg.jobRegistry as `0x${string}`,
        abi,
        functionName: "createSession",
        args: [
          prepared.createSessionArgs.paramsHash,
          prepared.createSessionArgs.worker,
          prepared.createSessionArgs.encWorkerKey,
          prepared.createSessionArgs.ephemeralPubKey,
          prepared.createSessionArgs.initState,
          prepared.createSessionArgs.expiry,
        ],
        gas: 1_000_000n,
      });
      setS((p) => ({ ...p, createTx }));
      const createReceipt = await pub.waitForTransactionReceipt({ hash: createTx });
      if (createReceipt.status !== "success") throw new Error("createSession reverted");
      const sessionCreated = parseAbiItem(
        "event SessionCreated(uint256 indexed sessionId, address indexed user, bytes32 indexed paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey)",
      );
      const sessionLogs = await pub.getLogs({
        address: cfg.jobRegistry as `0x${string}`,
        event: sessionCreated,
        blockHash: createReceipt.blockHash,
      });
      const sessionLog = sessionLogs.find((l: Log) => l.transactionHash === createTx);
      if (!sessionLog || !("args" in sessionLog) || !sessionLog.args?.sessionId)
        throw new Error("SessionCreated not in receipt");
      const sessionId = sessionLog.args.sessionId as bigint;
      setS((p) => ({ ...p, sessionId }));

      // === 4. Wait for relay token, open the WS BEFORE submitJob ===
      let relayToken: string | undefined;
      for (let i = 0; i < 30 && !relayToken; i++) {
        const r = await gateway.getSessionToken(Number(sessionId));
        if ("token" in r && r.token) {
          relayToken = r.token;
          break;
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
      if (!relayToken) throw new Error("relay token never became ready");
      sockRef.current = new WebSocket(`wss://relay.${net}.lightchain.ai/ws?token=${encodeURIComponent(relayToken)}`);
      sockRef.current.binaryType = "arraybuffer";
      await new Promise<void>((res, rej) => {
        sockRef.current!.addEventListener("open", () => res(), { once: true });
        sockRef.current!.addEventListener("error", () => rej(new Error("relay WebSocket open failed")), { once: true });
        setTimeout(() => rej(new Error("relay WebSocket open timeout")), 20_000);
      });
      const chunks: string[] = [];
      sockRef.current.addEventListener("message", async (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
        let frame: { type?: string; payload?: string };
        try {
          frame = JSON.parse(raw);
        } catch {
          return;
        }
        if (frame.type === "chunk" && frame.payload) {
          try {
            const piece = await decryptResponse(prepared.sessionKey, frame.payload);
            chunks.push(piece);
            setS((p) => ({ ...p, output: chunks.join("") }));
          } catch {
            // skip non-decryptable control frames
          }
        }
      });

      // === 5. Encrypt + upload the prompt ===
      setS((p) => ({ ...p, phase: "upload" }));
      const promptHash = await submitPrompt(gateway, prepared.sessionKey, prompt);

      // === 6. Sign submitJob on-chain, paying the fee ===
      setS((p) => ({ ...p, phase: "submit" }));
      const submitTx = await wal.writeContract({
        address: cfg.jobRegistry as `0x${string}`,
        abi,
        functionName: "submitJob",
        args: [sessionId, promptHash],
        value: parseEther(String(fee)),
        gas: 500_000n,
      });
      setS((p) => ({ ...p, submitTx }));
      const submitReceipt = await pub.waitForTransactionReceipt({ hash: submitTx });
      if (submitReceipt.status !== "success") throw new Error("submitJob reverted");
      const jobSubmitted = parseAbiItem(
        "event JobSubmitted(uint256 indexed jobId, uint256 indexed sessionId, address worker)",
      );
      const jobLogs = await pub.getLogs({
        address: cfg.jobRegistry as `0x${string}`,
        event: jobSubmitted,
        blockHash: submitReceipt.blockHash,
      });
      const jobLog = jobLogs.find((l: Log) => l.transactionHash === submitTx);
      if (!jobLog || !("args" in jobLog) || !jobLog.args?.jobId) throw new Error("JobSubmitted not in receipt");
      const jobId = jobLog.args.jobId as bigint;
      setS((p) => ({ ...p, jobId, phase: "stream" }));

      // === 7. Wait for JobCompleted (typed event filter to avoid matching JobSubmitted's signature) ===
      // Healthy workers finish in 5-30s. A small percentage of testnet workers
      // ack a job and then never produce a result; cap the wait at 90s so the
      // operator gets a clear "try again" instead of a 5-minute hang.
      const jobCompleted = parseAbiItem(
        "event JobCompleted(uint256 indexed jobId, address indexed worker, bytes32 responseHash, bytes32 ciphertextHash)",
      );
      const waitDeadlineMs = Date.now() + 90_000;
      let completed: Log | null = null;
      while (!completed && Date.now() < waitDeadlineMs) {
        await new Promise((res) => setTimeout(res, 3000));
        const logs = await pub.getLogs({
          address: cfg.jobRegistry as `0x${string}`,
          event: jobCompleted,
          args: { jobId },
          fromBlock: submitReceipt.blockNumber,
        });
        if (logs.length) completed = logs[0] as Log;
      }
      if (!completed) {
        // Throw a typed sentinel so the outer run() can catch + auto-retry with
        // a different worker. The caller will close this WS and record the
        // stalled attempt for the UI / refund-timing display.
        throw new StalledWorkerError(jobId, prepared.createSessionArgs.worker, submitTx, fee);
      }
      // Grace for the last relay frame, then close cleanly.
      await new Promise((res) => setTimeout(res, 4000));
      sockRef.current.close();
      setS((p) => ({
        ...p,
        phase: "done",
        elapsedMs: Date.now() - startRef.current,
        // The worker's own commit-result transaction (where JobCompleted fired
        // with responseHash + ciphertextHash). It's the third proof in the chain.
        completedTx: completed.transactionHash as `0x${string}`,
      }));
      return sockRef.current;
    }
  };

  const wallet = useMemo(() => address ?? null, [address]);
  const explorer = cfg.explorer;

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-8">
        <Badge tone="brand" className="mb-3">
          Live playground
        </Badge>
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-content-primary sm:text-4xl">
          Run one real encrypted inference in your browser
        </h1>
        <p className="mt-3 max-w-2xl text-content-soft">
          Connect a wallet, pick testnet (free LCAI from the faucet) or mainnet, type a prompt. The page drives the
          same SDK any third-party dApp would call: SIWE auth → prepareSession → wallet-signed createSession + submitJob
          → encrypted relay stream → decrypted answer.
        </p>
      </div>

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-content-soft">Network</span>
            <div className="inline-flex rounded-lg border border-bdr-soft bg-surface-base-faint p-0.5">
              <button
                type="button"
                onClick={() => setNet(TESTNET)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  net === TESTNET ? "bg-card text-content-primary shadow" : "text-content-soft hover:text-content-primary",
                )}
              >
                Testnet
              </button>
              <button
                type="button"
                onClick={() => setNet(MAINNET)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  net === MAINNET ? "bg-card text-content-primary shadow" : "text-content-soft hover:text-content-primary",
                )}
              >
                Mainnet
              </button>
            </div>
            <span className="text-xs text-content-soft">chain {cfg.chainId}</span>
            {net === TESTNET && (
              <a
                href="https://lightfaucet.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Faucet <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            {wallet ? (
              <span className="rounded-full border border-bdr-soft bg-surface-base-faint px-2.5 py-1 font-mono text-[11px] text-content-default">
                {wallet.slice(0, 6)}…{wallet.slice(-4)}
              </span>
            ) : (
              <ConnectButton size="sm" />
            )}
          </div>
        </div>
        {wrongChain && (
          <p className="mt-3 flex items-start gap-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Your wallet is on a different chain. We will request a switch to chain {expectedChain} when you click Run.
          </p>
        )}
      </Card>

      <Card className="mb-6 p-5">
        <label htmlFor="prompt" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-content-soft">
          Prompt
        </label>
        <textarea
          id="prompt"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask the model anything..."
          className="w-full rounded-xl border border-bdr-soft bg-surface-base-faint p-3 font-mono text-sm leading-relaxed text-content-primary outline-none transition-colors focus:border-primary/60"
        />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-content-soft">
            <span className="inline-flex items-center gap-1.5">
              <Coins className="size-3.5 text-primary" />
              {s.feeLcai != null ? `${s.feeLcai} LCAI` : "~0.02 LCAI"} per call
            </span>
            <span>{net === TESTNET ? "(free testnet LCAI)" : "(real LCAI)"}</span>
          </div>
          <div className="flex items-center gap-2">
            {s.phase !== "idle" && s.phase !== "done" && s.phase !== "error" && (
              <span className="font-mono text-xs text-content-soft">{(s.elapsedMs / 1000).toFixed(1)}s</span>
            )}
            {(s.phase === "done" || s.phase === "error") && (
              <Button variant="outline" size="sm" onClick={reset}>
                Reset
              </Button>
            )}
            <Button
              onClick={run}
              disabled={
                !isConnected ||
                authPending ||
                (s.phase !== "idle" && s.phase !== "done" && s.phase !== "error")
              }
            >
              {isConnected ? (
                <>
                  <PlayCircle /> {s.phase === "idle" || s.phase === "done" || s.phase === "error" ? "Run inference" : "Running…"}
                </>
              ) : (
                "Connect a wallet to run"
              )}
            </Button>
          </div>
        </div>
      </Card>

      {(s.phase !== "idle" || s.error) && (
        <Card className="mb-6 p-5">
          <div className="mb-4 flex items-center gap-3">
            <IconChip icon={Workflow} size="md" />
            <h2 className="text-base font-semibold tracking-tight text-content-primary">Progress</h2>
            {s.authCached && (
              <Badge tone="success" className="ml-auto">
                <Shield className="size-3" /> auth reused (cached)
              </Badge>
            )}
          </div>
          <ol className="space-y-2.5">
            {STEPS.map((step) => {
              const status = statusOf(s.phase, step.id, s.phase === "error");
              return (
                <li key={step.id} className="flex items-center gap-3">
                  <StepIcon status={status} />
                  <span
                    className={cn(
                      "text-sm",
                      status === "done"
                        ? "text-content-default"
                        : status === "active"
                          ? "font-medium text-content-primary"
                          : status === "error"
                            ? "font-medium text-destructive"
                            : "text-content-soft",
                    )}
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
          {s.error && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm leading-relaxed text-content-default">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>{s.error}</span>
            </p>
          )}
        </Card>
      )}

      {s.output && (
        <Card className="mb-6 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="text-base font-semibold tracking-tight text-content-primary">Decrypted answer</h2>
            {s.phase === "stream" && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-content-soft">
                <Loader2 className="size-3.5 animate-spin" /> streaming…
              </span>
            )}
          </div>
          <p className="whitespace-pre-wrap rounded-xl border border-bdr-soft bg-surface-base-faint p-4 text-sm leading-relaxed text-content-default">
            {s.output}
          </p>
        </Card>
      )}

      {s.stalled.length > 0 && (
        <Card className="mb-6 border border-warning/30 bg-warning/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            <h2 className="text-sm font-semibold text-content-primary">
              Retried with a different worker{s.stalled.length > 1 ? ` (${s.stalled.length} times)` : ""}
            </h2>
            <Badge tone="warning">attempt {s.attempt} of {MAX_ATTEMPTS}</Badge>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-content-soft">
            The fee from {s.stalled.length === 1 ? "this earlier attempt" : "these earlier attempts"} is escrowed
            on-chain. The protocol marks stalled workers as timed out and refunds the fee to your wallet after the
            dispute window (a few hours on testnet, ~24h on mainnet). You can confirm the JobTimedOut event later via
            the explorer link below; nothing more to do from here.
          </p>
          <ul className="space-y-2 text-xs">
            {s.stalled.map((a) => (
              <li key={a.jobId} className="rounded-lg border border-bdr-soft bg-card p-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-content-soft">jobId</span>
                  <span className="font-mono text-content-default">{a.jobId}</span>
                  <span className="text-content-soft">·</span>
                  <span className="text-content-soft">worker</span>
                  <span className="font-mono text-content-default">
                    {a.worker.slice(0, 6)}…{a.worker.slice(-4)}
                  </span>
                  <span className="text-content-soft">·</span>
                  <span className="text-content-soft">fee</span>
                  <span className="tabular-nums text-content-default">{a.feeLcai} LCAI</span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-content-soft">submitJob</span>
                  <a
                    href={`${explorer}/tx/${a.submitTx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline"
                  >
                    {a.submitTx.slice(0, 14)}…{a.submitTx.slice(-12)} <ExternalLink className="ml-0.5 inline size-3" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(s.createTx || s.submitTx || s.worker) && (
        <Card className="mb-6 p-5">
          <h2 className="mb-3 text-sm font-semibold text-content-primary">On-chain proofs</h2>
          <dl className="grid gap-2 text-xs">
            {s.worker && (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt className="font-medium text-content-soft">worker</dt>
                <dd className="font-mono text-content-default">{s.worker}</dd>
              </div>
            )}
            {s.sessionId != null && (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt className="font-medium text-content-soft">sessionId</dt>
                <dd className="font-mono text-content-default">{s.sessionId.toString()}</dd>
              </div>
            )}
            {s.jobId != null && (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt className="font-medium text-content-soft">jobId</dt>
                <dd className="font-mono text-content-default">{s.jobId.toString()}</dd>
              </div>
            )}
            {s.createTx && (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt className="font-medium text-content-soft">createSession</dt>
                <dd>
                  <a
                    href={`${explorer}/tx/${s.createTx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline"
                  >
                    {s.createTx.slice(0, 14)}…{s.createTx.slice(-12)}{" "}
                    <ExternalLink className="ml-0.5 inline size-3" />
                  </a>
                </dd>
              </div>
            )}
            {s.submitTx && (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt className="font-medium text-content-soft">submitJob</dt>
                <dd>
                  <a
                    href={`${explorer}/tx/${s.submitTx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline"
                  >
                    {s.submitTx.slice(0, 14)}…{s.submitTx.slice(-12)}{" "}
                    <ExternalLink className="ml-0.5 inline size-3" />
                  </a>
                </dd>
              </div>
            )}
            {s.completedTx && (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt className="font-medium text-content-soft" title="Worker's commit-result transaction (JobCompleted event with responseHash + ciphertextHash)">
                  jobCompleted
                </dt>
                <dd>
                  <a
                    href={`${explorer}/tx/${s.completedTx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline"
                  >
                    {s.completedTx.slice(0, 14)}…{s.completedTx.slice(-12)}{" "}
                    <ExternalLink className="ml-0.5 inline size-3" />
                  </a>
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-[11px] text-content-soft">
            Three on-chain proofs: <span className="text-content-default">createSession</span> and{" "}
            <span className="text-content-default">submitJob</span> are signed by your wallet;{" "}
            <span className="text-content-default">jobCompleted</span> is the worker&apos;s commit that
            anchors the decrypted answer to an on-chain hash you can verify later.
          </p>
        </Card>
      )}

      <p className="text-xs text-content-soft">
        Source for the flow above is in{" "}
        <a
          href="https://github.com/marinom2/lightnode/blob/main/app/playground/page.tsx"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          app/playground/page.tsx
        </a>{" "}
        - the same SDK any third-party dApp uses (see <Link href="/build" className="text-primary hover:underline">/build</Link> for the install steps).
      </p>
    </div>
  );
}
