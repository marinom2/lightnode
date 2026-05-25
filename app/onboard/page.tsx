"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ArrowLeft, ArrowRight, Check, Wallet, Gauge, Terminal, HeartPulse, ExternalLink, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConnectButton } from "@/components/connect-button";
import { IconChip } from "@/components/ui/icon-chip";
import { MachineCheck } from "@/components/onboard/machine-check";
import { SetupGuide } from "@/components/onboard/setup-guide";
import { NetworkHealth } from "@/components/network-health";
import { VerifyWorker } from "@/components/onboard/verify-worker";
import { OneClickInstall } from "@/components/onboard/one-click-install";
import { NETWORKS, DEFAULT_MODEL, HARDWARE } from "@/lib/network";
import { useNetwork } from "@/lib/network-context";
import { isDesktop } from "@/lib/tauri";
import type { OS } from "@/lib/scriptgen";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: 0, label: "Connect", icon: Wallet },
  { id: 1, label: "Machine", icon: Gauge },
  { id: 2, label: "Setup", icon: Terminal },
  { id: 3, label: "Run", icon: HeartPulse },
];

export default function OnboardPage() {
  const { isConnected } = useAccount();
  const { network } = useNetwork();
  const [step, setStep] = useState(0);
  const [vramOk, setVramOk] = useState(false);
  const [ackRisk, setAckRisk] = useState(false);
  const [os, setOS] = useState<OS>("linux");
  const [avgJobs, setAvgJobs] = useState(0);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isDesktop()), []);

  useEffect(() => {
    fetch(`/api/network?net=${network}`)
      .then((r) => r.json())
      .then((j) => j.ok && setAvgJobs(j.avgJobsPerLiveWorker ?? 0))
      .catch(() => {});
  }, [network]);

  useEffect(() => {
    if (isConnected && step === 0) setStep(1);
  }, [isConnected, step]);

  // Never hard-block on hardware: if below the 8GB-GPU bar, the user can still
  // proceed after acknowledging the risk (they may want to test on CPU/low spec).
  const canNext = (step === 0 && isConnected) || (step === 1 && (vramOk || ackRisk)) || step === 2;

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-content-primary">Become a worker</h1>
        <p className="mt-2 text-content-soft">
          Four steps from wallet to earning $LCAI on LightChain {NETWORKS[network].label.toLowerCase()}.
          {network === "testnet" && NETWORKS.testnet.faucet && (
            <>
              {" "}
              Need test LCAI?{" "}
              <a href={NETWORKS.testnet.faucet} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                Use the faucet
              </a>
              .
            </>
          )}
        </p>
      </div>

      {/* stepper */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                step === s.id
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : step > s.id
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-bdr-soft bg-surface-base-subtle text-content-soft",
              )}
            >
              {step > s.id ? <Check className="size-4" /> : <s.icon className="size-4" />}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={cn("h-px w-6", step > s.id ? "bg-success/40" : "bg-bdr-soft")} />}
          </div>
        ))}
      </div>

      <Card className="p-6 md:p-8">
        {step === 0 && (
          <div className="py-10 text-center">
            <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-gradient-primary text-white">
              <Wallet className="size-6" />
            </span>
            <h2 className="text-xl font-semibold text-content-primary">Connect the wallet you&apos;ll fund from</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-content-soft">
              This is the wallet that holds your stake capital (≈ {NETWORKS[network].fundLcai.toLocaleString()} LCAI).
              No sign-up, no API key - your worker key gets generated separately and locally.
            </p>
            <div className="mt-6 flex justify-center">
              <ConnectButton size="lg" />
            </div>
            <button
              onClick={() => setStep(1)}
              className="mx-auto mt-4 block text-sm text-content-soft underline-offset-4 hover:text-content-primary hover:underline"
            >
              Skip - I&apos;ll enter my funder key during setup
            </button>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="mb-1 text-xl font-semibold text-content-primary">Check your machine</h2>
            <p className="mb-4 text-sm text-content-soft">
              Confirm your specs. You need an <span className="text-content-primary">{HARDWARE.min.vramGb}GB+ GPU</span> to serve {DEFAULT_MODEL} well.
            </p>
            <div className="mb-6">
              <NetworkHealth />
            </div>
            <MachineCheck
              avgJobsPerLiveWorker={avgJobs}
              onResult={(r) => {
                setVramOk(r.vramOk);
                setOS(r.os);
              }}
            />
            {!vramOk && (
              <label className="mt-5 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-content-default">
                <input
                  type="checkbox"
                  checked={ackRisk}
                  onChange={(e) => setAckRisk(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--warning)]"
                />
                <span>
                  <span className="font-medium text-content-primary">Run anyway (below the {HARDWARE.min.vramGb}GB-GPU bar).</span> Inference
                  will be slow on CPU and may miss the completion deadline - which can cost a small{" "}
                  <span className="text-warning">stake slash</span>. Fine for testing; not ideal for earning. I understand
                  and want to continue.
                </span>
              </label>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="mb-1 text-xl font-semibold text-content-primary">
              {desktop ? "Install & run your worker" : "One command to set it all up"}
            </h2>
            <p className="mb-5 text-sm text-content-soft">
              {desktop
                ? "One click. We generate your worker keys, fund + stake from your connected wallet, then start the node and keep it alive."
                : "Tailored to your OS & chosen model - clones, configures, and runs everything. It only asks for a password and your funder key."}
            </p>

            {!desktop && (
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/10 p-3 text-xs text-content-default">
                <span className="flex items-start gap-2.5">
                  <IconChip icon={Rocket} size="sm" className="shrink-0" />
                  <span>
                    <span className="font-medium text-content-primary">Want truly zero commands?</span> The LightNode
                    desktop app auto-detects hardware and installs + runs with a single button. On the web, use the one
                    command below.
                  </span>
                </span>
                <a href="https://github.com/marinom2/lightnode/releases/latest" target="_blank" rel="noreferrer" className="shrink-0">
                  <Button variant="outline" size="sm">Get the desktop app</Button>
                </a>
              </div>
            )}

            <div className="mb-6">
              <OneClickInstall />
            </div>

            {desktop ? (
              <details className="rounded-xl border border-bdr-soft bg-surface-base-subtle/40 p-4">
                <summary className="cursor-pointer text-sm font-medium text-content-soft hover:text-content-primary">
                  Prefer to run it yourself? Manual / advanced install
                </summary>
                <div className="mt-4">
                  <SetupGuide defaultOS={os} />
                </div>
              </details>
            ) : (
              <SetupGuide defaultOS={os} />
            )}
          </div>
        )}

        {step === 3 && (
          <div className="py-6 text-center">
            <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-gradient-primary text-white">
              <HeartPulse className="size-6" />
            </span>
            <h2 className="text-xl font-semibold text-content-primary">You&apos;re live - now watch it earn</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-content-soft">
              After <code className="rounded bg-surface-base-light px-1.5 py-0.5 text-xs">08-run-worker</code>, your terminal
              prints your <span className="text-content-primary">worker address</span> (and{" "}
              <code className="rounded bg-surface-base-light px-1.5 py-0.5 text-xs">status</code> shows it too). Paste it into
              the dashboard to track jobs, earnings, and health in real time.
            </p>
            <div className="mx-auto mt-6 max-w-lg">
              <p className="mb-2 text-sm font-medium text-content-primary">Verify it&apos;s live</p>
              <VerifyWorker />
            </div>

            <div className="mx-auto mt-6 grid max-w-lg gap-3 text-left">
              {[
                "Logs show: registration validated · gateway auth · websocket connected",
                `status reports stake + supported model (${DEFAULT_MODEL})`,
                "First job: ws_job_received → job completed, earnings start accruing",
              ].map((x) => (
                <div key={x} className="flex items-start gap-2 rounded-lg border border-bdr-light bg-surface-base-subtle p-3 text-sm text-content-default">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" /> {x}
                </div>
              ))}
            </div>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href="/dashboard">
                <Button variant="gradient" size="lg">
                  Open dashboard <ArrowRight />
                </Button>
              </Link>
              <a href="https://github.com/lightchain-protocol/lightchain-worker-toolkit" target="_blank" rel="noreferrer">
                <Button variant="outline" size="lg">
                  Toolkit docs <ExternalLink />
                </Button>
              </a>
            </div>
          </div>
        )}
      </Card>

      {/* nav */}
      {step < 3 && (
        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            <ArrowLeft /> Back
          </Button>
          <div className="flex items-center gap-3">
            {step === 1 && !vramOk && !ackRisk && (
              <Badge tone="warning">Tick the box above to continue anyway</Badge>
            )}
            <Button variant="gradient" disabled={!canNext} onClick={() => setStep((s) => Math.min(3, s + 1))}>
              {step === 2 ? "I've run it" : "Continue"} <ArrowRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
