import Link from "next/link";
import { ArrowRight, Github, PlayCircle, Boxes, ShieldCheck, Receipt, Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { StatStrip } from "@/components/build/console/stat-strip";
import { CAPABILITY_ITEMS } from "@/components/build/console/nav-config";

const EXAMPLES_REPO = "marinom2/lightnode-examples";

export const metadata = {
  title: "Build with LightChain AI",
  description:
    "The lightnode developer console: run encrypted LightChain AI inference, chat, agents, batch, worker ops, bridge, and DAO from one place. Five-line SDK, live network reads, a bundled CLI, and scaffolders.",
};

const QUICKSTART = `import { runInferenceWithKey } from "lightnode-sdk";

const { answer, txs } = await runInferenceWithKey({
  network: "testnet",                 // or "mainnet"
  privateKey: process.env.PRIVATE_KEY, // 0x... funded key
  prompt: "One fun fact about the ocean.",
});

console.log(answer);            // decrypted answer
console.log(txs.createSession); // verifiable on-chain receipts`;

const VALUE_PROPS = [
  { icon: ShieldCheck, title: "Encrypted end to end", body: "ECDH + AES-GCM with the worker. The SDK never sees plaintext after it leaves the caller." },
  { icon: Receipt, title: "Verifiable on-chain", body: "Every call leaves createSession + submitJob + jobCompleted receipts anyone can check." },
  { icon: Plug, title: "Non-custodial", body: "Your key signs locally. No accounts, no hosted middleman, single peer dep (viem)." },
];

export default function BuildOverviewPage() {
  return (
    <div className="space-y-12">
      <ConsolePanel
        kicker="Developer platform"
        title={
          <>
            Build on <span className="text-gradient">LightChain AI</span>
          </>
        }
        subtitle="One console for the whole SDK: run encrypted inference, chat, agents, batch jobs, worker operations, the bridge, and the DAO - each as a live, runnable panel, with the exact code to copy. Pick a capability on the left, or start below."
        actions={
          <>
            <Button asChild size="sm" variant="gradient">
              <Link href="/playground">
                <PlayCircle /> Playground
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href="https://github.com/marinom2/lightnode" target="_blank" rel="noreferrer">
                <Github /> GitHub
              </a>
            </Button>
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="space-y-3">
            <CodeTabs tabs={[{ label: "install", code: "npm install lightnode-sdk viem" }]} />
            <CodeTabs tabs={[{ label: "scaffold a new app", code: "npm create lightnode-app my-app" }]} />
            <div className="grid gap-2.5 pt-1">
              {VALUE_PROPS.map((v) => (
                <div key={v.title} className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-bdr-soft bg-surface-base-faint text-primary">
                    <v.icon className="size-4" />
                  </span>
                  <p className="text-sm text-content-soft">
                    <span className="font-medium text-content-primary">{v.title}.</span> {v.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-content-soft">Five lines to your first inference</p>
            <CodeTabs tabs={[{ label: "TypeScript", code: QUICKSTART }]} />
          </div>
        </div>
      </ConsolePanel>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">Live network</h2>
          <Link href="/build/network" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            Open network panel <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <StatStrip />
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Boxes className="size-4 text-primary" />
          <h2 className="text-base font-semibold tracking-tight text-content-primary">Capabilities</h2>
          <span className="text-sm text-content-soft">- each one runs live in the console</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CAPABILITY_ITEMS.map((item) => {
            const Icon = item.icon;
            const soon = item.ready === false;
            const inner = (
              <>
                <div className="mb-2 flex items-center gap-2.5">
                  <span className="grid size-9 place-items-center rounded-lg border border-bdr-soft bg-surface-base-faint text-primary">
                    <Icon className="size-4" />
                  </span>
                  <span className="text-sm font-semibold text-content-primary">{item.label}</span>
                  {soon ? (
                    <Badge tone="muted" className="ml-auto">soon</Badge>
                  ) : (
                    <ArrowRight className="ml-auto size-4 text-content-soft transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  )}
                </div>
                <p className="text-xs leading-relaxed text-content-soft">{item.blurb}</p>
              </>
            );
            const cls = "rounded-2xl border border-bdr-soft bg-card/60 p-4 backdrop-blur-sm transition-colors";
            return soon ? (
              <div key={item.label} className={`${cls} opacity-60`}>{inner}</div>
            ) : (
              <Link key={item.label} href={item.href} className={`group ${cls} hover:border-primary/40 hover:bg-surface-base-faint`}>
                {inner}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-bdr-soft pt-6 text-sm">
        <span className="text-content-soft">More:</span>
        <Link href="/build/reference" className="font-medium text-content-default hover:text-primary">SDK reference</Link>
        <Link href="/build/cli" className="font-medium text-content-default hover:text-primary">CLI</Link>
        <a href={`https://github.com/${EXAMPLES_REPO}`} target="_blank" rel="noreferrer" className="font-medium text-content-default hover:text-primary">Runnable examples</a>
        <a href="https://www.npmjs.com/package/lightnode-sdk" target="_blank" rel="noreferrer" className="font-medium text-content-default hover:text-primary">npm</a>
      </section>
    </div>
  );
}
