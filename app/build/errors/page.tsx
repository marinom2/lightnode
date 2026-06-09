"use client";

import { useMemo, useState } from "react";
import { Bug, ShieldCheck, ShieldAlert, RotateCw, Ban } from "lucide-react";
import {
  explainInferenceError,
  decodeWorkerError,
  StalledWorkerError,
  OnChainRevertError,
  GatewayAuthError,
  RelayTokenTimeoutError,
  InferenceAbortedError,
  type ErrorExplanation,
  type DecodedWorkerError,
} from "lightnode-sdk";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { PanelGrid, PanelColumn, Field, RunButton, ResponseEmpty } from "@/components/build/console/panel-kit";
import { cn } from "@/lib/utils";

const SNIPPET = `import { explainInferenceError, decodeWorkerError } from "lightnode-sdk";

try {
  await runInferenceWithKey({ network, privateKey, prompt });
} catch (e) {
  const x = explainInferenceError(e, { refundWindowSec });
  // x.kind, x.fundsSafe, x.retryable, x.nextStep - no message-string regexing
  if (x.retryable) retry();
}

// or decode a raw on-chain revert into a named contract error:
decodeWorkerError("0x592f994b...").message;`;

// Representative instances so a builder can see each typed error explained
// without having to trigger it. Constructed client-side; pure resolver.
const EXAMPLES: { label: string; make: () => unknown }[] = [
  { label: "StalledWorkerError", make: () => new StalledWorkerError({ jobId: 1234n, worker: "0x" + "ab".repeat(20) as `0x${string}`, submitTx: ("0x" + "cd".repeat(32)) as `0x${string}`, feeLcai: 0.02 }) },
  { label: "OnChainRevertError (submitJob)", make: () => new OnChainRevertError("submitJob", ("0x" + "ef".repeat(32)) as `0x${string}`) },
  { label: "GatewayAuthError (401)", make: () => new GatewayAuthError(401, "token expired") },
  { label: "RelayTokenTimeoutError", make: () => new RelayTokenTimeoutError() },
  { label: "InferenceAbortedError", make: () => new InferenceAbortedError("relay-token") },
  { label: "Wallet rejection", make: () => new Error("User rejected the request.") },
  { label: "Insufficient funds", make: () => new Error("insufficient funds for gas * price + value") },
];

function looksLikeRevert(s: string): boolean {
  return /^0x[0-9a-fA-F]{8,}$/.test(s.trim());
}

function YesNo({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", ok ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning")}>
      {ok ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
      {label}
    </span>
  );
}

export default function ErrorsPage() {
  const [input, setInput] = useState("");
  const [explanation, setExplanation] = useState<ErrorExplanation | null>(null);
  const [decoded, setDecoded] = useState<DecodedWorkerError | null>(null);

  const run = (raw?: unknown) => {
    setExplanation(null);
    setDecoded(null);
    if (raw !== undefined) {
      setExplanation(explainInferenceError(raw, { refundWindowSec: 24 * 3600 }));
      return;
    }
    const text = input.trim();
    if (!text) return;
    if (looksLikeRevert(text)) {
      setDecoded(decodeWorkerError(text));
    } else {
      setExplanation(explainInferenceError(new Error(text), { refundWindowSec: 24 * 3600 }));
    }
  };

  const catalog = useMemo(() => EXAMPLES.map((ex) => ({ label: ex.label, x: explainInferenceError(ex.make(), { refundWindowSec: 24 * 3600 }) })), []);

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Reference · Errors"
        title="Error & revert decoder"
        subtitle="Paste any thrown error or raw on-chain revert data: get a structured remediation - what happened, whether your LCAI is safe, whether to retry, and the exact next step. Pure SDK helpers (explainInferenceError + decodeWorkerError), runs in your browser, no wallet."
      >
        <PanelGrid>
          <PanelColumn title="Input">
            <div className="space-y-4">
              <Field label="Load an example">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const ex = EXAMPLES.find((x) => x.label === e.target.value);
                    if (ex) {
                      setInput("");
                      run(ex.make());
                    }
                  }}
                  className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 text-sm text-content-primary outline-none focus:border-primary/60"
                >
                  <option value="">Pick a typed error...</option>
                  {EXAMPLES.map((ex) => (
                    <option key={ex.label} value={ex.label}>
                      {ex.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Or paste an error message / 0x revert data" hint="Auto-detects raw revert hex vs a thrown message.">
                <textarea
                  rows={4}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="execution reverted: 0x592f994b...  |  User rejected the request."
                  className="w-full rounded-xl border border-bdr-soft bg-surface-base-faint p-3 font-mono text-xs leading-relaxed text-content-primary outline-none focus:border-primary/60"
                />
              </Field>
              <div className="flex justify-end">
                <RunButton running={false} disabled={!input.trim()} onClick={() => run()} idle="Decode" busy="..." />
              </div>
            </div>
          </PanelColumn>

          <PanelColumn title="Explanation">
            {!explanation && !decoded && <ResponseEmpty>Pick an example or paste an error / revert to decode it.</ResponseEmpty>}
            {explanation && (
              <div className="space-y-3">
                <div className="rounded-xl border border-bdr-soft p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary">{explanation.kind}</span>
                    <span className="text-sm font-semibold text-content-primary">{explanation.title}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-content-default">{explanation.detail}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <YesNo ok={explanation.fundsSafe} label={explanation.fundsSafe ? "funds safe" : "check funds"} />
                    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", explanation.retryable ? "border-success/30 bg-success/10 text-success" : "border-bdr-soft text-content-soft")}>
                      {explanation.retryable ? <RotateCw className="size-3" /> : <Ban className="size-3" />}
                      {explanation.retryable ? "retryable" : "not retryable"}
                    </span>
                  </div>
                </div>
                <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-content-soft">Next step</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-content-default">{explanation.nextStep}</p>
                  {(explanation.jobId || explanation.tx) && (
                    <p className="mt-1.5 font-mono text-[11px] text-content-soft">
                      {explanation.jobId && `jobId ${explanation.jobId}`} {explanation.tx && `· tx ${explanation.tx.slice(0, 14)}...`}
                    </p>
                  )}
                </div>
              </div>
            )}
            {decoded && (
              <div className="space-y-2 rounded-xl border border-bdr-soft p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">revert</span>
                  <span className="text-sm font-semibold text-content-primary">{decoded.name}</span>
                  <span className="font-mono text-[11px] text-content-soft">{decoded.selector}</span>
                </div>
                <p className="text-xs leading-relaxed text-content-default">{decoded.message}</p>
                {decoded.args.length > 0 && <p className="font-mono text-[11px] text-content-soft">args: {decoded.args.map(String).join(", ")}</p>}
              </div>
            )}
          </PanelColumn>
        </PanelGrid>
      </ConsolePanel>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">Every failure mode, explained</h2>
        <div className="divide-y divide-bdr-light overflow-hidden rounded-2xl border border-bdr-soft">
          {catalog.map(({ label, x }) => (
            <div key={label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="w-44 shrink-0 font-mono text-xs text-content-primary">{label}</span>
              <span className="flex-1 text-xs text-content-default">{x.title}</span>
              <span className="text-[11px] text-content-soft">{x.fundsSafe ? "funds safe" : "check funds"} · {x.retryable ? "retry" : "no retry"}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Bug className="size-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The SDK behind it</h2>
        </div>
        <CodeTabs tabs={[{ label: "TypeScript", code: SNIPPET }]} />
      </section>
    </div>
  );
}
