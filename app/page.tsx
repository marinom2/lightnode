import Link from "next/link";
import {
  ArrowRight,
  Terminal,
  ShieldCheck,
  Coins,
  Gauge,
  Wallet,
  Cpu,
  CheckCircle2,
  HeartPulse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveStats } from "@/components/live-stats";
import { ModelsPanel } from "@/components/models-panel";
import { HeroPreview } from "@/components/hero-preview";
import { DownloadDesktop } from "@/components/download-desktop";

const FRICTIONS = ["the terminal", "Docker", "env vars", "wallets & keys", "ports", "Linux", "RPC configs", "the docs"];

const STEPS = [
  { icon: Wallet, title: "Connect your wallet", body: "Connect the wallet you'll fund the worker from. No sign-up, no API key." },
  { icon: Gauge, title: "Check your machine", body: "We score your GPU/CPU/RAM, confirm you clear the 8GB-VRAM floor, and estimate rewards." },
  { icon: Terminal, title: "Get a tailored setup", body: "A personalized, copy-paste install for your OS - wrapping the official toolkit, gotchas pre-fixed." },
  { icon: HeartPulse, title: "Run & watch rewards", body: "Start the node, then track jobs, earnings, and health on a live dashboard." },
];

export default function Home() {
  return (
    <div className="relative">
      {/* ambient hero glow + grid */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[640px] glow-radial" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-grid opacity-60" />

      {/* HERO */}
      <section className="relative mx-auto max-w-6xl px-5 pt-24 pb-16 text-center">
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-content-primary md:text-6xl">
          Become a LightChain AI worker in <span className="text-gradient">one flow</span>.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-content-soft md:text-lg">
          Most people don&apos;t fail to run a node because they lack hardware - they fail on setup.
          LightNode abstracts all of it: connect a wallet, check your machine, get a tailored install,
          and start earning <span className="text-content-primary font-medium">$LCAI</span> for serving real AI inference.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/onboard">
            <Button variant="gradient" size="lg">
              Start onboarding <ArrowRight />
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline" size="lg">
              I already run a worker
            </Button>
          </Link>
        </div>

        <HeroPreview />

        <div className="mx-auto mt-14 max-w-4xl">
          <LiveStats />
        </div>
      </section>

      {/* DESKTOP DOWNLOAD - one click */}
      <DownloadDesktop />

      {/* WHAT WE REMOVE */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <Card className="overflow-hidden">
          <div className="grid gap-8 p-8 md:grid-cols-2 md:p-10">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-content-primary">
                We remove the friction, not the rewards.
              </h2>
              <p className="mt-3 text-content-soft">
                Becoming a worker today means wrestling with all of this by hand. LightNode turns the
                official 9-phase onboarding into a guided flow and a single tailored script.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {FRICTIONS.map((f) => (
                  <span
                    key={f}
                    className="rounded-lg border border-bdr-soft bg-surface-base-faint px-2.5 py-1 text-sm text-content-soft line-through decoration-destructive/60"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
            <div className="space-y-3 rounded-xl border border-bdr-soft bg-surface-base-subtle p-5">
              {[
                { icon: Coins, t: "Earn $LCAI", d: "Paid per inference job your worker completes." },
                { icon: ShieldCheck, t: "Secure the network", d: "Stake LCAI and contribute censorship-resistant compute." },
                { icon: Cpu, t: "Use real hardware", d: "Serve llama3-8b through Ollama on your own GPU." },
              ].map((b) => (
                <div key={b.t} className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                    <b.icon className="size-4.5" />
                  </span>
                  <div>
                    <div className="font-medium text-content-primary">{b.t}</div>
                    <div className="text-sm text-content-soft">{b.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-content-primary">How it works</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-content-soft">Four steps from wallet to earning.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <Card key={s.title} className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-gradient-primary text-white">
                  <s.icon className="size-5" />
                </span>
                <span className="text-sm font-mono text-content-soft">0{i + 1}</span>
              </div>
              <h3 className="font-semibold text-content-primary">{s.title}</h3>
              <p className="mt-1.5 text-sm text-content-soft">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* MODELS */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-content-primary">What you&apos;ll serve</h2>
        <p className="mx-auto mt-2 mb-8 max-w-xl text-center text-content-soft">
          The models the network pays workers to run, with the live per-job fee.
        </p>
        <Card className="p-6">
          <ModelsPanel compactHeader />
        </Card>
      </section>

      {/* ROLE CARDS */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="relative overflow-hidden p-8">
            <div className="absolute right-0 top-0 size-40 glow-radial opacity-70" />
            <Badge tone="success">Available now</Badge>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight text-content-primary">Run a Worker</h3>
            <p className="mt-2 text-content-soft">
              Serve llama3-8b inference and earn $LCAI. Needs an 8GB+ GPU and a 50,000 LCAI stake.
              This is the one-flow path - start here.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-content-soft">
              {["Guided machine check + reward estimate", "Tailored install for macOS / Linux / Windows", "Built-in alias + liveness checks (no silent slashes)"].map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-success" /> {x}
                </li>
              ))}
            </ul>
            <Link href="/onboard" className="mt-6 inline-block">
              <Button variant="gradient">
                Become a worker <ArrowRight />
              </Button>
            </Link>
          </Card>

          <Card className="p-8">
            <Badge tone="muted">Roadmap</Badge>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight text-content-primary">Run a Validator</h3>
            <p className="mt-2 text-content-soft">
              Secure the chain at the consensus layer. This is a heavier, capital-gated path
              (500,000 LCAI deposit + a full node), so we&apos;re shipping the worker flow first and
              guided validator onboarding next.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-content-soft">
              {["Full-node sync + validator client", "500,000 LCAI deposit", "Monitoring & backups"].map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-content-extraLight" /> {x}
                </li>
              ))}
            </ul>
            <Button variant="outline" className="mt-6" disabled>
              Coming soon
            </Button>
          </Card>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <Card className="bg-gradient-primary p-[1px]">
          <div className="rounded-[15px] bg-background/85 px-8 py-12 text-center backdrop-blur-sm">
            <h2 className="text-3xl font-semibold tracking-tight text-content-primary">
              Got a spare GPU and 50k LCAI?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-content-soft">
              Put it to work in a few minutes. LightNode walks you the whole way.
            </p>
            <Link href="/onboard" className="mt-7 inline-block">
              <Button variant="gradient" size="lg">
                Start onboarding <ArrowRight />
              </Button>
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
