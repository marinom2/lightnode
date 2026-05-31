import { Activity, Boxes, Database, ExternalLink, Gauge, Globe, PlayCircle, Rocket, ShieldCheck, Wallet2, Workflow, Zap } from "lucide-react";
import { LightNode } from "lightnode-sdk";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/build/section-header";
import { BuildTabs } from "@/components/build/build-tabs";

export const revalidate = 60;

export const metadata = {
  title: "Live network - Build with LightChain AI",
  description:
    "Real mainnet data refreshed every minute: workers, models, per-model performance, top reliability. Plus the 5-stage inference protocol and live-verified mainnet+testnet transaction receipts.",
};

interface LiveData {
  network: { workers: number; active: number; jobsCompleted: number; earningsLcai: number; modelCount: number };
  models: Array<{ name: string; feeLcai: number; maxTokens: number; live: boolean }>;
  topWorkers: Array<{ address: string; completionPct: number; p50s: number | null; jobs: number; earningsLcai: number }>;
  modelStats: Array<{ name: string; total: number; completionPct: number; p50s: number | null; p95s: number | null; incomplete: number }>;
  fetchedAt: number;
  error: string | null;
}

const NULL_LIVE: LiveData = {
  network: { workers: 0, active: 0, jobsCompleted: 0, earningsLcai: 0, modelCount: 0 },
  models: [],
  topWorkers: [],
  modelStats: [],
  fetchedAt: 0,
  error: null,
};

async function fetchLive(): Promise<LiveData> {
  try {
    const ln = new LightNode("mainnet");
    const [net, models, topWorkers, modelStats] = await Promise.all([
      ln.getNetworkStats(),
      ln.getModels(),
      ln.getWorkerStats(500, 5),
      ln.getModelStats(500),
    ]);
    return {
      network: {
        workers: net.total,
        active: net.active,
        jobsCompleted: net.jobsCompleted,
        earningsLcai: net.totalEarnedLcai,
        modelCount: net.models,
      },
      models: models.slice(0, 6).map((m) => ({
        name: m.name,
        feeLcai: Number(BigInt(m.fee ?? "0")) / 1e18,
        maxTokens: m.max_output_tokens,
        live: !!(m.is_whitelisted && m.is_enabled),
      })),
      topWorkers: topWorkers.map((w) => ({
        address: w.address,
        completionPct: Math.round((w.completionRate ?? 0) * 100),
        p50s: w.p50,
        jobs: w.total,
        earningsLcai: w.earnings,
      })),
      modelStats: modelStats.slice(0, 5).map((s) => ({
        name: s.name,
        total: s.total,
        completionPct: Math.round((s.completionRate ?? 0) * 100),
        p50s: s.p50,
        p95s: s.p95,
        incomplete: s.incomplete,
      })),
      fetchedAt: Date.now(),
      error: null,
    };
  } catch (e) {
    return { ...NULL_LIVE, error: (e as Error).message };
  }
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const PHASES = [
  { icon: Wallet2, label: "Auth", desc: "SIWE handshake yields a JWT for the consumer gateway." },
  { icon: Workflow, label: "Prepare", desc: "Worker selected. Session key wrapped with ECDH-P256." },
  { icon: ShieldCheck, label: "Sign", desc: "Your wallet signs createSession on chain." },
  { icon: Zap, label: "Submit", desc: "AES-GCM encrypted prompt uploaded. submitJob pays the fee." },
  { icon: PlayCircle, label: "Stream", desc: "Encrypted relay frames decrypted live with the session key." },
] as const;

const VERIFIED = {
  mainnet: {
    createSession: "0xf091957f515eb472e71f6d442ee24c9c74e948412e2b7ad658dfbb4b57d4a6ca",
    submitJob: "0x6ff44a4aa4b08cd38715369705a4338af3bb6ee456f2b8819d62fc779846bb89",
    explorer: "https://mainnet.lightscan.app",
    output:
      "Did you know there is a type of jellyfish called the 'Upside-Down Jellyfish' that actually swims on its back, using its tentacles to catch prey and defend itself from predators?",
  },
  testnet: {
    createSession: "0x77686f3fc37573f0745f256a5c74f5944d3a2a7de745129bd918e8b0ef2bc587",
    submitJob: "0xba9d48c4f8eacf24d363ceb884f6c6c2fcca54a82fa0a341625944d293b2bd96",
    explorer: "https://testnet.lightscan.app",
    output:
      "Did you know that the deepest part of the ocean, the Mariana Trench, is so deep that if you were to drop Mount Everest into it, its peak would still be more than 1 mile underwater?!",
  },
} as const;

function TxRow({
  net,
  data,
}: {
  net: "mainnet" | "testnet";
  data: (typeof VERIFIED)["mainnet"] | (typeof VERIFIED)["testnet"];
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Badge tone={net === "mainnet" ? "success" : "brand"}>{net}</Badge>
        <span className="text-xs text-content-soft">chain {net === "mainnet" ? "9200" : "8200"}</span>
      </div>
      <div className="space-y-2 font-mono text-xs">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-content-soft">createSession</span>
          <a
            href={`${data.explorer}/tx/${data.createSession}`}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary hover:underline"
          >
            {data.createSession.slice(0, 12)}…{data.createSession.slice(-10)}
            <ExternalLink className="ml-1 inline size-3" />
          </a>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-content-soft">submitJob</span>
          <a
            href={`${data.explorer}/tx/${data.submitJob}`}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary hover:underline"
          >
            {data.submitJob.slice(0, 12)}…{data.submitJob.slice(-10)}
            <ExternalLink className="ml-1 inline size-3" />
          </a>
        </div>
      </div>
      <p className="mt-4 rounded-lg border border-bdr-soft bg-surface-base-faint p-3 text-sm leading-relaxed text-content-default">
        <span className="mr-1 text-xs uppercase tracking-wide text-content-soft">decrypted</span>
        {data.output}
      </p>
    </Card>
  );
}

function LiveDemoCard({
  icon: Icon,
  title,
  desc,
  snippet,
  children,
}: {
  icon: typeof Boxes;
  title: string;
  desc: string;
  snippet: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <span className="text-sm font-semibold text-content-primary">{title}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-success">
          <span className="size-1.5 animate-pulse rounded-full bg-success" />
          live mainnet
        </span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-content-soft">{desc}</p>
      <pre className="overflow-x-auto rounded-lg border border-bdr-soft code-surface p-3 font-mono text-[11px] leading-relaxed text-content-default">
        <code>{snippet}</code>
      </pre>
      <div className="mt-3 rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-content-soft">
          <Activity className="size-3 text-success" /> what that call returns right now
        </div>
        {children}
      </div>
    </Card>
  );
}

export default async function BuildNetworkPage() {
  const live = await fetchLive();
  const fmt = new Intl.NumberFormat("en-US");

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <BuildTabs />

      <div className="mb-8">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-content-primary sm:text-4xl">
          Live network
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-content-soft">
          Real mainnet data refreshed once a minute. Each card shows the SDK call that produced it.
        </p>
      </div>

      {/* ── LIVE DEMO PANEL ──────────────────────────────────────────── */}
      <div className="mb-12">
        <SectionHeader
          icon={Activity}
          title="Try it live (no install, no key)"
          blurb="Each card pairs a one-line SDK snippet with the data that call returns right now."
        />
        {live.error ? (
          <Card className="p-5">
            <p className="text-xs text-content-soft">
              Couldn&apos;t reach the indexer right now. The SDK calls work regardless - try them locally.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <LiveDemoCard
              icon={Globe}
              title="Network at a glance"
              desc="One call that summarizes the entire mainnet."
              snippet={`const ln = new LightNode("mainnet");
const stats = await ln.getNetworkStats();`}
            >
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-content-soft">workers (active / total)</span>
                <span className="text-right font-mono text-content-default">{fmt.format(live.network.active)} / {fmt.format(live.network.workers)}</span>
                <span className="text-content-soft">jobs completed</span>
                <span className="text-right font-mono text-content-default">{fmt.format(live.network.jobsCompleted)}</span>
                <span className="text-content-soft">total earnings</span>
                <span className="text-right font-mono text-content-default">{live.network.earningsLcai.toFixed(2)} LCAI</span>
                <span className="text-content-soft">registered models</span>
                <span className="text-right font-mono text-content-default">{fmt.format(live.network.modelCount)}</span>
              </div>
            </LiveDemoCard>

            <LiveDemoCard
              icon={Database}
              title="Top workers by reliability"
              desc="Per-worker completion + p50 latency over the last 500 jobs."
              snippet={`const workers = await ln.getWorkerStats(500, 5);`}
            >
              {live.topWorkers.length === 0 ? (
                <p className="text-xs text-content-soft">(no workers in the sample)</p>
              ) : (
                <div className="overflow-x-auto"><table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-content-soft">
                    <tr>
                      <th className="pb-1 text-left font-medium">worker</th>
                      <th className="pb-1 text-right font-medium">jobs</th>
                      <th className="pb-1 text-right font-medium">complete</th>
                      <th className="pb-1 text-right font-medium">p50</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.topWorkers.map((w) => (
                      <tr key={w.address} className="border-t border-bdr-soft/40">
                        <td className="py-1 font-mono text-content-default">{shortAddr(w.address)}</td>
                        <td className="py-1 text-right font-mono text-content-soft">{w.jobs}</td>
                        <td className="py-1 text-right font-mono text-content-soft">{w.completionPct}%</td>
                        <td className="py-1 text-right font-mono text-content-soft">{w.p50s != null ? `${w.p50s}s` : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </LiveDemoCard>

            <LiveDemoCard
              icon={Boxes}
              title="Registered models"
              desc="Live whitelist with on-chain fee + max output tokens."
              snippet={`const models = await ln.getModels();`}
            >
              {live.models.length === 0 ? (
                <p className="text-xs text-content-soft">(no models found)</p>
              ) : (
                <div className="overflow-x-auto"><table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-content-soft">
                    <tr>
                      <th className="pb-1 text-left font-medium">model</th>
                      <th className="pb-1 text-right font-medium">fee</th>
                      <th className="pb-1 text-right font-medium">max out</th>
                      <th className="pb-1 text-right font-medium">live</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.models.map((m) => (
                      <tr key={m.name} className="border-t border-bdr-soft/40">
                        <td className="py-1 font-mono text-content-default">{m.name}</td>
                        <td className="py-1 text-right font-mono text-content-soft">{m.feeLcai.toFixed(3)}</td>
                        <td className="py-1 text-right font-mono text-content-soft">{fmt.format(m.maxTokens)}</td>
                        <td className="py-1 text-right">{m.live ? <Badge tone="success">yes</Badge> : <Badge tone="muted">off</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </LiveDemoCard>

            <LiveDemoCard
              icon={Gauge}
              title="Per-model performance"
              desc="Completion rate, p50 / p95 latency, incomplete count over the last 500 jobs."
              snippet={`const stats = await ln.getModelStats(500);`}
            >
              {live.modelStats.length === 0 ? (
                <p className="text-xs text-content-soft">(no stats yet)</p>
              ) : (
                <div className="overflow-x-auto"><table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-content-soft">
                    <tr>
                      <th className="pb-1 text-left font-medium">model</th>
                      <th className="pb-1 text-right font-medium">jobs</th>
                      <th className="pb-1 text-right font-medium">complete</th>
                      <th className="pb-1 text-right font-medium">p50 / p95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.modelStats.map((m) => (
                      <tr key={m.name} className="border-t border-bdr-soft/40">
                        <td className="py-1 font-mono text-content-default">{m.name}</td>
                        <td className="py-1 text-right font-mono text-content-soft">{m.total}</td>
                        <td className="py-1 text-right font-mono text-content-soft">{m.completionPct}%</td>
                        <td className="py-1 text-right font-mono text-content-soft">{m.p50s != null ? `${m.p50s}s` : "-"} / {m.p95s != null ? `${m.p95s}s` : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </LiveDemoCard>
          </div>
        )}
      </div>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
      <Card className="mb-12 p-6">
        <SectionHeader
          icon={Workflow}
          title="How encrypted inference works under the hood"
          blurb="Five stages of the inference path. Bridge / DAO / read-only have their own much shorter shapes."
        />
        <ol className="space-y-2.5">
          {PHASES.map((p, i) => (
            <li
              key={p.label}
              className="flex items-start gap-3 rounded-xl border border-bdr-soft bg-surface-base-faint px-4 py-3"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 font-mono text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p.icon className="size-4 text-content-soft" />
                  <span className="text-sm font-semibold text-content-primary">{p.label}</span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-content-soft">{p.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {/* ── LIVE-VERIFIED ────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionHeader
          icon={Rocket}
          title="Live-verified end to end"
          blurb="The SDK is tested with real LCAI before each release. These ran the same code path you'd call."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <TxRow net="mainnet" data={VERIFIED.mainnet} />
          <TxRow net="testnet" data={VERIFIED.testnet} />
        </div>
      </div>
    </div>
  );
}
