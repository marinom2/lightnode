"use client";

/**
 * Shared console UI for the wallet-signed, user-pays inference flow
 * (useEncryptedInference). Used by the Inference and Chat capability panels so
 * both render the connection state, live phase, and on-chain proofs the same
 * way the Playground does - the visitor's own wallet signs and pays.
 */

import { AlertTriangle, Loader2 } from "lucide-react";
import { ConnectButton } from "@/components/connect-button";
import { ProofRow, short } from "@/components/build/console/panel-kit";
import type { FlowState, Phase } from "@/lib/use-encrypted-inference";

const PHASE_LABELS: Record<Phase, string> = {
  idle: "",
  auth: "Authenticating (one-time sign-in)",
  prepare: "Preparing an encrypted session",
  create: "Confirm createSession in your wallet",
  upload: "Encrypting and uploading the prompt",
  submit: "Confirm submitJob in your wallet (pays the fee)",
  stream: "Decrypting the streamed answer",
  done: "Done",
  error: "Error",
};

export function phaseLabel(phase: Phase): string {
  return PHASE_LABELS[phase];
}

/** True while a run is mid-flight (between auth and the final answer). */
export function isRunning(phase: Phase): boolean {
  return phase !== "idle" && phase !== "done" && phase !== "error";
}

/**
 * Connection strip: network + chain, the connect/account control, and a
 * wrong-chain warning. Shown at the top of a wallet-signed panel.
 */
export function ConnectStrip({
  label,
  chainId,
  isConnected,
  address,
  wrongChain,
  expectedChain,
  testnet,
}: {
  label: string;
  chainId: number;
  isConnected: boolean;
  address?: `0x${string}`;
  wrongChain: boolean;
  expectedChain: number;
  testnet: boolean;
}) {
  return (
    <div className="rounded-xl border border-bdr-soft bg-surface-base-faint px-3.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-content-soft">
          <span>Network</span>
          <span className="rounded-full border border-bdr-soft bg-card px-2 py-0.5 font-medium text-content-default">
            {label}
          </span>
          <span>chain {chainId}</span>
          {testnet && (
            <a
              href="https://lightfaucet.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Faucet
            </a>
          )}
        </div>
        {isConnected && address ? (
          <span className="rounded-full border border-bdr-soft bg-card px-2 py-0.5 font-mono text-[11px] text-content-default">
            {short(address)}
          </span>
        ) : (
          <ConnectButton size="sm" />
        )}
      </div>
      {wrongChain && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Wrong network - we&apos;ll request a switch to chain {expectedChain} when you run.
        </p>
      )}
    </div>
  );
}

/** A compact live-phase line (with a spinner while running). */
export function PhaseLine({ state }: { state: FlowState }) {
  if (!isRunning(state.phase)) return null;
  return (
    <p className="inline-flex items-center gap-2 text-xs text-content-soft">
      <Loader2 className="size-3.5 animate-spin text-primary" />
      {phaseLabel(state.phase)}
      {state.attempt > 1 && <span className="text-content-soft/70">· attempt {state.attempt}</span>}
    </p>
  );
}

/** The on-chain proof block (worker + the three-tx proof chain). */
export function FlowProofs({ state, explorer }: { state: FlowState; explorer: string }) {
  if (!state.worker && !state.createTx && !state.submitTx) return null;
  return (
    <div className="rounded-xl border border-bdr-soft p-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">On-chain proofs</p>
      {state.worker && <ProofRow label="worker" value={short(state.worker)} href={`${explorer}/address/${state.worker}`} />}
      {state.sessionId != null && <ProofRow label="sessionId" value={state.sessionId.toString()} />}
      {state.jobId != null && <ProofRow label="jobId" value={state.jobId.toString()} />}
      {state.createTx && <ProofRow label="createSession" value={short(state.createTx, 10, 8)} href={`${explorer}/tx/${state.createTx}`} />}
      {state.submitTx && <ProofRow label="submitJob" value={short(state.submitTx, 10, 8)} href={`${explorer}/tx/${state.submitTx}`} />}
      {state.completedTx && <ProofRow label="jobCompleted" value={short(state.completedTx, 10, 8)} href={`${explorer}/tx/${state.completedTx}`} />}
      <p className="mt-1.5 text-[11px] leading-relaxed text-content-soft">
        createSession and submitJob are signed by your wallet; jobCompleted is the worker&apos;s commit that anchors the
        decrypted answer to an on-chain hash.
      </p>
    </div>
  );
}
