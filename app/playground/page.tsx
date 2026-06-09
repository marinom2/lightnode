"use client";

/**
 * Live, in-browser encrypted-inference playground built directly on the published
 * lightnode-sdk. Connects the user's wallet (Reown/wagmi), runs the SIWE handshake
 * against the consumer gateway, prepares a session, signs createSession + submitJob
 * via viem, then opens the relay WebSocket and decrypts the streamed response with
 * the session key. Same code path the SDK consumers in any third-party dApp would
 * call - if it works here, the SDK works.
 *
 * The flow itself lives in useEncryptedInference (lib/use-encrypted-inference.ts)
 * so the BUILD console panels run the exact same wallet-signed, user-pays path.
 */

import { useState } from "react";
import Link from "next/link";
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
import { useEncryptedInference, MAX_ATTEMPTS, type Phase } from "@/lib/use-encrypted-inference";

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
const TESTNET = "testnet" as const;

export default function PlaygroundPage() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const {
    state: s,
    run: runFlow,
    reset,
    authPending,
    isConnected,
    address,
    wrongChain,
    expectedChain,
    cfg,
    explorer,
    net,
  } = useEncryptedInference();
  const wallet = address ?? null;
  const run = () => runFlow(prompt);

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
          Connect a wallet, type a prompt. The page drives the same SDK any third-party dApp would call: SIWE auth →
          prepareSession → wallet-signed createSession + submitJob → encrypted relay stream → decrypted answer. Switch
          network from the toggle in the top bar.
        </p>
      </div>

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-content-soft">
            <span>Network:</span>
            <span className="rounded-full border border-bdr-soft bg-surface-base-faint px-2.5 py-1 font-medium text-content-default">
              {cfg.label}
            </span>
            <span>chain {cfg.chainId}</span>
            {net === TESTNET && (
              <a
                href="https://lightfaucet.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Faucet <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
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
                  <span className="text-content-soft/40">|</span>
                  <span className="text-content-soft">worker</span>
                  <span className="font-mono text-content-default">
                    {a.worker.slice(0, 6)}…{a.worker.slice(-4)}
                  </span>
                  <span className="text-content-soft/40">|</span>
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
                <dd className="break-all font-mono text-content-default">{s.worker}</dd>
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
          {s.phase === "done" && !s.completedTx && s.submitTx && (
            <p className="mt-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-content-default">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>
                Answer delivered + decrypted with your session key (so the result is real). The{" "}
                <span className="font-medium">jobCompleted</span> event hasn&apos;t shown up on-chain
                yet - the worker either commits it shortly or the protocol marks the job timed-out
                in the dispute window. Either way, the answer above stays valid.
              </span>
            </p>
          )}
        </Card>
      )}

      <p className="text-xs text-content-soft">
        Source for the flow above is in{" "}
        <a
          href="https://github.com/marinom2/lightnode/blob/main/lib/use-encrypted-inference.ts"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          lib/use-encrypted-inference.ts
        </a>{" "}
        - the same SDK any third-party dApp uses (see <Link href="/build" className="text-primary hover:underline">/build</Link> for the install steps).
      </p>
    </div>
  );
}
