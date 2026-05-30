import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Code2,
  Coins,
  Cpu,
  Database,
  Download,
  Gauge,
  HeartPulse,
  PackageOpen,
  PlayCircle,
  Rocket,
  ShieldCheck,
  Terminal,
  Wallet2,
  Workflow,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveStats } from "@/components/live-stats";
import { ModelsPanel } from "@/components/models-panel";
import { HeroPreview } from "@/components/hero-preview";
import { DownloadDesktop } from "@/components/download-desktop";
import { HomeHeroCta } from "@/components/home-hero-cta";
import { WebOnly } from "@/components/web-only";
import { HardwareRequirements } from "@/components/hardware-requirements";
import { IconChip } from "@/components/ui/icon-chip";
import { StakeAmount } from "@/components/stake-amount";
import { DEFAULT_MODEL, HARDWARE } from "@/lib/network";

// What the builder track gives you. Eight SDKs in one package.
const BUILDER_SDKS = [
  { icon: Zap, name: "Encrypted inference", line: "5-line API. Wallet signs, SDK encrypts + streams the answer." },
  { icon: Workflow, name: "Multi-turn chat", line: "Conversation class with history + system prompt." },
  { icon: Database, name: "Read-only network client", line: "13 methods for workers, jobs, models, stats. No key needed." },
  { icon: Coins, name: "Bridge SDK", line: "Move LCAI Ethereum <-> LightChain. Quote, approve, transfer." },
  { icon: ShieldCheck, name: "DAO SDK", line: "Read + vote on LCAI Governor proposals on Ethereum." },
  { icon: Gauge, name: "Worker preflight + watch", line: "One real test inference; event stream on state change." },
];

// Worker-track install steps. Same flow as before, slightly reordered.
const WORKER_STEPS = [
  { icon: Download, title: "Download", body: "macOS, Windows, or Linux. No sign-up, no API key." },
  { icon: Gauge, title: "Machine check", body: `Auto-detects GPU/CPU/RAM and scores against the ${HARDWARE.min.vramGb}GB-VRAM floor.` },
  { icon: Rocket, title: "One-click install", body: "Generates keys, funds and stakes from your wallet, starts the node. No terminal." },
  { icon: HeartPulse, title: "Earn & manage", body: "Track jobs, earnings, and health. Settle, withdraw, deregister - all in the app." },
];

export default function Home() {
  return (
    <div className="relative">
      {/* ambient hero glow + grid */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[640px] glow-radial" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-grid opacity-60" />

      {/* HERO */}
      <section className="relative mx-auto max-w-6xl px-5 pt-24 pb-12 text-center">
        <Badge tone="brand" className="mb-4">Community-built ecosystem for LightChain AI</Badge>
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-content-primary md:text-6xl">
          Build with, and run for, <span className="text-gradient">LightChain AI</span>.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-content-soft md:text-lg">
          One project, two tracks. Add encrypted decentralized AI to your app in five lines of code,
          or stake a GPU and earn <span className="text-content-primary font-medium">$LCAI</span> for serving
          real inference. Pick one (most people only need one).
        </p>

        {/* Two-track CTA strip */}
        <div className="mx-auto mt-8 grid max-w-4xl gap-3 md:grid-cols-2">
          <Card className="p-5 text-left">
            <div className="mb-2 flex items-center gap-2">
              <IconChip icon={Code2} size="sm" />
              <span className="text-sm font-semibold text-content-primary">Build</span>
              <Badge tone="success" className="ml-auto">live</Badge>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-content-soft">
              <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-[11px] text-content-default">lightnode-sdk</code>{" "}
              for encrypted on-chain AI. Plus bridge, DAO, model registry, worker watch. Non-custodial.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/build">
                  <PlayCircle /> Builder hub <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/playground">
                  Open the playground
                </Link>
              </Button>
            </div>
          </Card>
          <Card className="p-5 text-left">
            <div className="mb-2 flex items-center gap-2">
              <IconChip icon={Cpu} size="sm" />
              <span className="text-sm font-semibold text-content-primary">Run a worker</span>
              <Badge tone="success" className="ml-auto">live</Badge>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-content-soft">
              One-click desktop app. Generates your worker keys, funds + stakes from your wallet,
              brings the node online. Earn $LCAI per inference job.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="gradient">
                <Link href="/onboard">
                  Become a worker <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/network">
                  See the network
                </Link>
              </Button>
            </div>
          </Card>
        </div>

        <div className="mt-6">
          <HomeHeroCta />
        </div>

        {/* worker rig hero device - kept; speaks to the worker track */}
        <div className="relative mx-auto mt-12 w-fit">
          <div className="pointer-events-none absolute -top-28 left-1/2 -z-10 h-[440px] w-[860px] -translate-x-1/2 bg-[radial-gradient(ellipse_42%_56%_at_50%_0%,rgba(178,158,255,0.16),transparent_72%)] blur-2xl" />
          <div className="pointer-events-none absolute left-1/2 top-[36%] -z-10 size-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(124,90,233,0.36),transparent_60%)] blur-3xl" />
          <div className="pointer-events-none absolute bottom-3 left-1/2 -z-10 h-12 w-[280px] -translate-x-1/2 rounded-[50%] bg-primary/25 blur-2xl" />
          <Image
            src="/images/rn-hero-device.png"
            alt="LightChain worker rig powering AI inference"
            width={420}
            height={404}
            priority
            className="relative mx-auto w-[260px] drop-shadow-[0_30px_55px_rgba(80,60,160,0.45)] sm:w-[320px] md:w-[380px]"
          />
        </div>

        <div className="mt-4">
          <HeroPreview />
        </div>

        <div className="mx-auto mt-14 max-w-4xl">
          <LiveStats />
        </div>
      </section>

      {/* DESKTOP DOWNLOAD - one click (web only; hidden inside the desktop app) */}
      <WebOnly>
        <DownloadDesktop />
      </WebOnly>

      {/* BUILD TRACK - SDK ecosystem grid */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="mb-8 text-center">
          <Badge tone="brand" className="mb-2">For builders</Badge>
          <h2 className="text-2xl font-semibold tracking-tight text-content-primary">
            One install, eight SDKs.
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-content-soft">
            <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">npm install lightnode-sdk viem</code>
            {" "}gets you encrypted inference plus the whole ecosystem.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {BUILDER_SDKS.map((s) => (
            <Card key={s.name} className="flex flex-col p-5">
              <div className="mb-2 flex items-center gap-2">
                <IconChip icon={s.icon} size="sm" />
                <span className="text-sm font-semibold text-content-primary">{s.name}</span>
              </div>
              <p className="text-xs leading-relaxed text-content-soft">{s.line}</p>
            </Card>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <Button asChild>
            <Link href="/build">
              Builder hub <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/playground">
              <PlayCircle /> Try in browser
            </Link>
          </Button>
          <Button asChild variant="outline">
            <a href="https://www.npmjs.com/package/lightnode-sdk" target="_blank" rel="noopener noreferrer">
              <PackageOpen /> npm
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href="https://github.com/marinom2/lightnode-examples" target="_blank" rel="noopener noreferrer">
              <Terminal /> Examples
            </a>
          </Button>
        </div>
      </section>

      {/* WORKER TRACK - how it works */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="mb-8 text-center">
          <Badge tone="success" className="mb-2">For operators</Badge>
          <h2 className="text-2xl font-semibold tracking-tight text-content-primary">Set up in clicks, not hours.</h2>
          <p className="mx-auto mt-2 max-w-xl text-content-soft">
            Got a spare GPU and <StakeAmount /> LCAI? The desktop app handles keys, staking, Docker, and the watchdog.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {WORKER_STEPS.map((s, i) => (
            <Card key={s.title} className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <IconChip icon={s.icon} />
                <span className="font-mono text-sm text-content-soft">0{i + 1}</span>
              </div>
              <h3 className="font-semibold text-content-primary">{s.title}</h3>
              <p className="mt-1.5 text-sm text-content-soft">{s.body}</p>
            </Card>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <Button asChild variant="gradient">
            <Link href="/onboard">
              Start onboarding <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/network">
              See live worker stats
            </Link>
          </Button>
        </div>
      </section>

      {/* MODELS - serves both tracks */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-content-primary">
          The models on the network
        </h2>
        <p className="mx-auto mt-2 mb-8 max-w-xl text-center text-content-soft">
          What the network pays workers to serve. Builders call these via the SDK; operators serve one or more.
        </p>
        <Card className="p-6">
          <ModelsPanel compactHeader />
        </Card>
      </section>

      {/* HARDWARE - worker side */}
      <HardwareRequirements />

      {/* CTA - dual */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <Card className="bg-gradient-primary p-[1px]">
          <div className="rounded-[15px] bg-background/85 px-8 py-12 text-center backdrop-blur-sm">
            <h2 className="text-3xl font-semibold tracking-tight text-content-primary">Pick your path.</h2>
            <p className="mx-auto mt-3 max-w-2xl text-content-soft">
              Two tracks, one community. Most people only need one. Both are live on mainnet today.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
              <Button asChild variant="gradient" size="lg">
                <Link href="/build">
                  <Code2 /> Build with the SDK <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/onboard">
                  <Wallet2 /> Run a worker
                </Link>
              </Button>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
