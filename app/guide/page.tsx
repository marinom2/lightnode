"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Rocket, HeartPulse, Coins, ShieldAlert, Boxes, KeyRound, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { openExternal } from "@/lib/tauri";

function Section({ icon: Icon, title, children }: { icon: typeof Rocket; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <div className="mb-3 flex items-center gap-2.5">
        <IconChip icon={Icon} size="sm" />
        <h2 className="text-base font-semibold tracking-tight text-content-primary">{title}</h2>
      </div>
      <div className="space-y-2 text-sm leading-relaxed text-content-soft">{children}</div>
    </Card>
  );
}

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <Link href="/onboard" className="mb-6 inline-flex items-center gap-1.5 text-sm text-content-soft transition-colors hover:text-content-primary">
        <ArrowLeft className="size-4" /> Back
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-content-primary">How LightNode works</h1>
        <p className="mt-2 text-content-soft">
          A short guide to running a LightChain AI worker with the app. Everything here is handled for you by one-click
          install and the dashboard. This is just so you know what is happening under the hood.
        </p>
      </div>

      <div className="space-y-4">
        <Section icon={Rocket} title="What a worker is">
          <p>
            A worker is your machine serving AI inference jobs for the LightChain network and earning LCAI. It runs a local
            model through Ollama inside a Docker container, and it is identified on-chain by a generated worker key with a
            staked deposit. The app generates that key, funds and stakes it from a wallet you choose, starts the container,
            and keeps it online.
          </p>
        </Section>

        <Section icon={HeartPulse} title="The lifecycle">
          <p>
            <span className="font-medium text-content-primary">Set up:</span> pick your model(s), set a keystore password,
            fund the generated worker address, and the app registers and starts the worker.
          </p>
          <p>
            <span className="font-medium text-content-primary">Earn:</span> the gateway routes jobs to you automatically.
            Each completed job&apos;s reward is escrowed, then released by the network (about hourly, up to a few hours).
          </p>
          <p>
            <span className="font-medium text-content-primary">Settle and withdraw:</span> Settle earnings moves released
            rewards into your worker wallet; Withdraw Funds sends that balance to any address you choose.
          </p>
          <p>
            <span className="font-medium text-content-primary">Exit:</span> Deregister returns your stake to the worker
            wallet and stops the worker. Then withdraw to take everything out.
          </p>
        </Section>

        <Section icon={Coins} title="Where your money lives">
          <p>
            Your <span className="font-medium text-content-primary">stake</span> is locked in the registry while you are
            registered. <span className="font-medium text-content-primary">Released earnings</span> sit in the worker
            wallet as spendable LCAI. The stake only returns to the wallet when you deregister, so a typical end-of-life
            balance is earnings plus the returned stake, which you then withdraw.
          </p>
        </Section>

        <Section icon={ShieldAlert} title="Slashing, and how the app avoids it">
          <p>
            You get slashed for going silent on a job you accepted (acknowledged, then failed to finish in time), not for
            honest, reported failures. The two defenses are a worker that stays online and a model that stays warm. The app
            installs a keep-online watchdog (auto-starts Docker and the worker, keeps your machine awake while it runs) and
            pins the model in memory so the first job never pays a cold load. The Speed test shows your worst-case job time
            against the deadline before it matters.
          </p>
        </Section>

        <Section icon={Boxes} title="Serving one or more models">
          <p>
            A worker can serve a single model or several at once. Every served model has to stay loaded in memory at the
            same time, so the model picker sums their footprints and warns when a set will not fit your machine. Each model
            has its own fee. Change the set live on the dashboard with <span className="font-medium text-content-primary">Models
            this worker serves</span>; it updates the set on-chain with no re-stake and restarts the worker with it.
          </p>
        </Section>

        <Section icon={KeyRound} title="Your keys, and never losing them">
          <p>
            Your worker key and keystore password are generated and kept on your device only, in the OS keychain and an
            encrypted keystore. They are never sent to any server, and all signing happens locally. If you ever replace a
            key, the old one is archived on your device, so a worker that still holds a stake is never lost.
            <span className="font-medium text-content-primary"> Recover a replaced key</span> on the dashboard lists them,
            flags any still staked, and restores one as your active worker.
          </p>
        </Section>

        <Section icon={Wrench} title="Running it by hand (advanced)">
          <p>
            The app wraps the official LightChain worker toolkit. If you would rather run every step yourself, the toolkit
            is the upstream source.
          </p>
          <Button variant="outline" size="sm" className="mt-1" onClick={() => openExternal("https://github.com/lightchain-protocol/lightchain-worker-toolkit")}>
            Open the worker toolkit <ArrowRight />
          </Button>
        </Section>
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/onboard"><Button variant="gradient" size="lg"><Rocket /> Become a worker</Button></Link>
        <Link href="/dashboard"><Button variant="outline" size="lg">Open dashboard <ArrowRight /></Button></Link>
      </div>
    </div>
  );
}
