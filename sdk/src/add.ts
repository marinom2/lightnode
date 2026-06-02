/**
 * `lightnode add inference` - patch an EXISTING project to do encrypted
 * LightChain AI inference. Detects the framework from package.json (Next.js,
 * Hono, or plain Node) and writes the appropriate route/script + a .env.example
 * if one isn't already there. Idempotent: existing files are not overwritten
 * unless --force is passed.
 *
 * No runtime dependencies; templates are inlined as string literals.
 */

import * as fs from "node:fs";
import * as path from "node:path";

type Template = "nextjs-api" | "hono" | "node";
type Network = "testnet" | "mainnet";

interface AddOpts {
  template?: Template | "auto";
  network?: Network;
  force?: boolean;
  cwd?: string;
}

interface WrittenFile {
  path: string;
  skipped?: boolean;
  reason?: string;
}

function readPackageJson(cwd: string): { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null {
  const p = path.join(cwd, "package.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown> as ReturnType<typeof readPackageJson>;
  } catch {
    return null;
  }
}

function detectTemplate(cwd: string): Template {
  const pkg = readPackageJson(cwd);
  if (!pkg) return "node";
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (all["next"]) return "nextjs-api";
  if (all["hono"]) return "hono";
  return "node";
}

const HOSTING_GUIDE = `# Hosting your LightChain AI app

A single LightChain mainnet inference takes **60-90 seconds** (the workers
run the model, attest the result on-chain, and return the answer). Anywhere
that puts a short timeout on your request will fail with a generic timeout
error. So the question is just: how do you give your route enough time to
finish?

If you used \`lightnode add chat-web3\`, skip this file - that path has NO
server-side route, the visitor's own browser does the wait.

## The clean answer: run it yourself

This template ships with a **Dockerfile + docker-compose.yml** so you can
run the entire stack on your own machine, your own VPS, or anywhere Docker
runs. Long-running Node processes have no timeout. The result:

\`\`\`bash
docker compose up --build
# → http://localhost:3000 ready, no signup, no per-call cost beyond your
#   LCAI fee, no platform vendor lock-in.
\`\`\`

That's the recommended path. You own the box, you own the keys, you own
the uptime. Costs as much as the VPS does - $5/mo on Hetzner gets you a
2-core machine that handles plenty of traffic.

### Where to run that container

| Where                    | Cost                  | Notes |
|--------------------------|-----------------------|-------|
| Your laptop / home server | free                 | Perfect for dev + small personal projects. Expose via Cloudflare Tunnel or Tailscale Funnel if you want a public URL. |
| Hetzner CX22             | ~€4/mo                | 2 CPU, 4 GB RAM. Generous bandwidth. EU-based. |
| DigitalOcean droplet     | $4/mo                 | 1 CPU, 512 MB. Bumps to $6 for 1 GB. |
| OVH VPS                  | ~€3/mo                | Cheap, EU. |
| AWS Lightsail            | $5/mo                 | 1 CPU, 1 GB. AWS billing if you want it. |
| Your existing k8s        | $0 marginal           | Just \`docker push\` and \`kubectl apply\`. |
| Fly.io                   | free tier + $0-5/mo   | Their Docker-native platform, cleanest UX of the paid options. |
| Railway                  | $5/mo                 | Same idea. No timeout, easy deploys. |
| Render                   | $7/mo                 | Same idea. |
| Google Cloud Run         | pay-per-request       | Scales to zero. Watch the 60-minute request limit. |

## When you'd pick a managed platform instead

| Platform            | Trade-off |
|---------------------|-----------|
| Vercel Pro ($20/mo) | If you're already deploying your Next.js app on Vercel and don't want to split infra. The 60s function cap is tight for mainnet (70-80s calls cut it close); rely on streaming to keep the connection warm. **Hobby tier (free) does NOT work** - 10s cap, every call times out. |
| Netlify             | 26s sync function cap is too tight. Use Netlify's "background functions" (15min) and adapt the route to write the result to KV / a webhook. More work. |
| Cloudflare Workers  | 30s on free, unbounded with Durable Objects. The WebSocket relay setup is more involved than a plain Node server. |

The free-tier serverless platforms (Vercel Hobby, Netlify free, Cloudflare
free) **all fail** at the 60-90s mark. There's no way around that on those
plans short of upgrading. If you're not paying anyway, self-host - it's
strictly cheaper and faster than a $20/mo plan.

## What I'd actually pick

- **First time trying this out**: \`docker compose up\` on your laptop. Free,
  works in 30 seconds, real end-to-end test of your code.
- **Going to production with users**: same Dockerfile on a $5/mo Hetzner or
  Fly VM. You're done; it'll handle plenty of traffic.
- **You already have a Next.js app on Vercel**: upgrade to Pro and keep your
  build pipeline. The streaming route works under their 60s cap for most
  mainnet calls.
- **You're building a Web3 dApp**: re-run \`lightnode add chat-web3\`. No
  backend, no LCAI cost for you - each user pays their own way.

## Why the request is slow at all

LightChain inference is not a synchronous LLM call. Each request:
1. Negotiates an ECDH-encrypted session with a worker (off-chain).
2. Sends a \`createSession\` tx on-chain (one confirmation).
3. Uploads the encrypted prompt blob to the gateway.
4. Sends a \`submitJob\` tx on-chain (one confirmation).
5. Waits for the worker to run inference + post the encrypted result.
6. Decrypts the result client-side.

Steps 2, 4, and 5 are the slow part - each waits for a block confirmation
and worker pickup. The protocol's verifiable-AI guarantee comes from doing
all of this on-chain instead of just hitting an OpenAI-style API, which is
the reason the call takes 60-90s instead of 1-2s. There is no way to
shortcut this on the SDK side; the host just has to allow long-running
processes - which is exactly what a plain Node server (or Docker container)
already does for free.
`;

/**
 * Dockerfile that builds your Next.js app and runs it as a long-running
 * Node server. There is no function timeout on a plain server, so a 60-90s
 * mainnet inference just works. Multi-stage build keeps the runtime image
 * around 200 MB.
 */
const NEXTJS_DOCKERFILE = `# Generated by 'lightnode add chat' (or 'add inference' / 'add judge').
# Build a Next.js production image; run with 'docker compose up --build'.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=optional

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
# Long-running Node process - no function timeout to fight. Mainnet inference
# calls (60-90s) complete normally because the process just stays up.
CMD ["npm", "start"]
`;

/**
 * docker-compose.yml. The 'env_file' line wires .env from the project root
 * into the container at runtime, so the same PRIVATE_KEY a 'npm run dev'
 * session uses also flows to the container build.
 */
const NEXTJS_DOCKER_COMPOSE = `# Generated by 'lightnode add chat' (or 'add inference' / 'add judge').
# Quick start: docker compose up --build
# (then visit http://localhost:3000)
services:
  app:
    build: .
    image: lightnode-app
    container_name: lightnode-app
    ports:
      - "3000:3000"
    # PRIVATE_KEY, NETWORK, MODEL are read from .env at runtime.
    # Make sure .env exists in the same folder as this file (cp .env.example .env).
    env_file:
      - .env
    restart: unless-stopped
`;

const DOCKERIGNORE = `# Generated by 'lightnode add chat' (or 'add inference' / 'add judge').
.git
.gitignore
node_modules
.next
.env
.env.local
.env.*.local
LIGHTNODE-HOSTING.md
README.md
*.log
`;

const ENV_EXAMPLE = (net: Network) => `# Funded private key. Testnet works free (faucet at https://lightfaucet.ai).
PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000

NETWORK=${net}
MODEL=llama3-8b
`;

const NEXTJS_ROUTE = `// app/api/inference/route.ts
// Generated by 'lightnode add inference'. See https://lightnode.app/build
// Uses runInferenceWithKey: one call, full encrypted-inference flow.
import { NextResponse } from "next/server";
import { runInferenceWithKey } from "lightnode-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Mainnet 8b takes 60-90s under load; give the function room to finish.
export const maxDuration = 120;

const NETWORK = (process.env.NETWORK ?? "testnet") as "mainnet" | "testnet";
const MODEL = process.env.MODEL ?? "llama3-8b";

export async function POST(req: Request) {
  if (!process.env.PRIVATE_KEY?.startsWith("0x")) {
    return NextResponse.json({ error: "PRIVATE_KEY not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { prompt?: string; system?: string };
  const prompt = body.prompt?.trim();
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  try {
    const { answer, worker, txs, jobId } = await runInferenceWithKey({
      network: NETWORK,
      privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
      model: MODEL,
      // Optional system prompt - leave undefined for raw user prompts.
      system: body.system?.trim() || undefined,
      prompt,
    });
    return NextResponse.json({
      answer,
      worker,
      jobId: jobId.toString(),
      txs: {
        createSession: txs.createSession,
        submitJob: txs.submitJob,
        jobCompleted: txs.jobCompleted,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
`;

const HONO_HANDLER = `// lightchain-inference.ts
// Generated by 'lightnode add inference'. See https://lightnode.app/build
// Plug the handler below into your Hono router:
//
//   import { Hono } from "hono";
//   import { inferenceHandler } from "./lightchain-inference.js";
//   const app = new Hono();
//   app.post("/inference", inferenceHandler);
//
import type { Context } from "hono";
import { runInferenceWithKey } from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "testnet") as "mainnet" | "testnet";
const MODEL = process.env.MODEL ?? "llama3-8b";

export async function inferenceHandler(c: Context) {
  if (!process.env.PRIVATE_KEY?.startsWith("0x")) return c.json({ error: "PRIVATE_KEY not set" }, 500);
  const body = (await c.req.json().catch(() => ({}))) as { prompt?: string; system?: string };
  const prompt = body.prompt?.trim();
  if (!prompt) return c.json({ error: "prompt is required" }, 400);

  try {
    const { answer, worker, txs, jobId } = await runInferenceWithKey({
      network: NETWORK,
      privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
      model: MODEL,
      system: body.system?.trim() || undefined,
      prompt,
    });
    return c.json({
      answer,
      worker,
      jobId: jobId.toString(),
      txs: {
        createSession: txs.createSession,
        submitJob: txs.submitJob,
        jobCompleted: txs.jobCompleted,
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
}
`;

const NODE_SCRIPT = `// lightchain-inference.ts
// Generated by 'lightnode add inference'. Run with: tsx lightchain-inference.ts "your prompt"
import { runInferenceWithKey, LightNode } from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "testnet") as "mainnet" | "testnet";
const MODEL = process.env.MODEL ?? "llama3-8b";
const PROMPT = process.argv.slice(2).join(" ").trim() || "Reply with a one-sentence fun fact.";
const PRIVATE_KEY = process.env.PRIVATE_KEY as \`0x\${string}\` | undefined;
if (!PRIVATE_KEY) { console.error("PRIVATE_KEY not set. Put one in .env (testnet faucet: https://lightfaucet.ai)"); process.exit(1); }
const KEY = PRIVATE_KEY as \`0x\${string}\`;

const ln = new LightNode(NETWORK);
const { answer, worker, txs, jobId } = await runInferenceWithKey({
  network: NETWORK,
  privateKey: KEY,
  model: MODEL,
  prompt: PROMPT,
});

console.log("\\nanswer       :", answer);
console.log("job id       :", jobId.toString());
console.log("worker       :", worker);
console.log("submitJob tx :", ln.explorerTxUrl(txs.submitJob));
if (txs.jobCompleted) console.log("completed tx :", ln.explorerTxUrl(txs.jobCompleted));
`;

function writeFile(abs: string, contents: string, force: boolean): WrittenFile {
  const rel = path.relative(process.cwd(), abs) || abs;
  if (fs.existsSync(abs) && !force) {
    return { path: rel, skipped: true, reason: "already exists (use --force to overwrite)" };
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
  return { path: rel };
}

function depsNeeded(template: Template): string[] {
  if (template === "nextjs-api") return ["lightnode-sdk", "viem", "ws"];
  if (template === "hono") return ["lightnode-sdk", "viem", "ws"];
  // The node/script template is run with `npx tsx <file>.ts`, so tsx must be
  // installed too, otherwise `tsx ...` fails with "command not found".
  return ["lightnode-sdk", "viem", "ws", "tsx"];
}

/** Full `npm install` line for a template's next-steps, including the dev type
 *  packages an editor needs. The node/script template uses Node builtins
 *  (`node:process`, `node:readline`) and imports `ws`, so without @types/node
 *  and @types/ws a freshly-scaffolded file is a wall of red squiggles in any
 *  TypeScript-aware editor even though `tsx` runs it fine. */
function installLine(template: Template): string {
  const runtime = `npm install ${depsNeeded(template).join(" ")}`;
  if (template === "node") return `${runtime} && npm install -D @types/node @types/ws`;
  return runtime;
}

/**
 * Implementation called by `lightnode add inference [...]`.
 * Returns the list of files written + the install command the user should run.
 */
export function addInference(opts: AddOpts = {}): { written: WrittenFile[]; install: string; template: Template; network: Network } {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "testnet";
  const template: Template = opts.template && opts.template !== "auto" ? opts.template : detectTemplate(cwd);
  const force = !!opts.force;

  const written: WrittenFile[] = [];

  if (template === "nextjs-api") {
    written.push(writeFile(path.join(cwd, "app/api/inference/route.ts"), NEXTJS_ROUTE, force));
    written.push(writeFile(path.join(cwd, "LIGHTNODE-HOSTING.md"), HOSTING_GUIDE, force));
    written.push(writeFile(path.join(cwd, "Dockerfile"), NEXTJS_DOCKERFILE, force));
    written.push(writeFile(path.join(cwd, "docker-compose.yml"), NEXTJS_DOCKER_COMPOSE, force));
    written.push(writeFile(path.join(cwd, ".dockerignore"), DOCKERIGNORE, force));
  } else if (template === "hono") {
    written.push(writeFile(path.join(cwd, "lightchain-inference.ts"), HONO_HANDLER, force));
  } else {
    written.push(writeFile(path.join(cwd, "lightchain-inference.ts"), NODE_SCRIPT, force));
  }
  written.push(writeFile(path.join(cwd, ".env.example"), ENV_EXAMPLE(network), force));

  return {
    written,
    install: installLine(template),
    template,
    network,
  };
}

// ---------------------------------------------------------------------------
// `lightnode add analytics-dashboard` - drop in a read-only network/worker
// analytics page that uses the SDK's getNetworkAnalytics + getModelStats +
// getWorkerStats. All reads, no wallet needed, no fees - so it composes onto
// any existing dApp.
// ---------------------------------------------------------------------------

const NEXTJS_DASHBOARD_PAGE = `// app/lightnode-analytics/page.tsx
// Generated by 'lightnode add analytics-dashboard'. See https://lightnode.app/build
import { LightNode, type NetworkId } from "lightnode-sdk";

export const revalidate = 30; // cache the SSR render for 30s

const NETWORK = (process.env.NEXT_PUBLIC_LIGHTCHAIN_NETWORK ?? "mainnet") as NetworkId;

export default async function LightNodeAnalyticsPage() {
  const ln = new LightNode(NETWORK);
  const [network, models, workers] = await Promise.all([
    ln.getNetworkAnalytics(),
    ln.getModelStats(),
    ln.getWorkerStats(1000, 12),
  ]);

  return (
    <main style={{ maxWidth: 1080, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#111" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600 }}>LightChain {NETWORK} - network analytics</h1>
        <p style={{ color: "#555", marginTop: 6 }}>
          Live read from the public worker subgraph + on-chain registration. Auto-refreshes every 30 seconds.
        </p>
      </header>

      <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 28 }}>
        <Stat label="Completion" value={pct(network.completionRate)} />
        <Stat label="Jobs" value={fmt(network.jobs)} />
        <Stat label="Incomplete" value={fmt(network.incomplete)} />
        <Stat label="Earnings (LCAI)" value={network.earnings.toFixed(2)} />
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Per-model performance</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd", color: "#666" }}>
              <th style={{ padding: 8 }}>Model</th>
              <th style={{ padding: 8 }}>Jobs</th>
              <th style={{ padding: 8 }}>Completion</th>
              <th style={{ padding: 8 }}>p50</th>
              <th style={{ padding: 8 }}>p95</th>
              <th style={{ padding: 8 }}>Earnings</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.modelId} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: 8, fontWeight: 500 }}>{m.name}</td>
                <td style={{ padding: 8 }}>{fmt(m.total)}</td>
                <td style={{ padding: 8 }}>{pct(m.completionRate)}</td>
                <td style={{ padding: 8 }}>{m.p50 ?? "-"}s</td>
                <td style={{ padding: 8 }}>{m.p95 ?? "-"}s</td>
                <td style={{ padding: 8 }}>{m.earnings.toFixed(2)} LCAI</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Busiest workers (top 12)</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd", color: "#666" }}>
              <th style={{ padding: 8 }}>Worker</th>
              <th style={{ padding: 8 }}>Jobs</th>
              <th style={{ padding: 8 }}>Completion</th>
              <th style={{ padding: 8 }}>Earnings</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.address} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: 8, fontFamily: "monospace" }}>{short(w.address)}</td>
                <td style={{ padding: 8 }}>{fmt(w.total)}</td>
                <td style={{ padding: 8 }}>{pct(w.completionRate)}</td>
                <td style={{ padding: 8 }}>{w.earnings.toFixed(3)} LCAI</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p style={{ marginTop: 28, color: "#888", fontSize: 12 }}>
        Powered by the open-source <a href="https://www.npmjs.com/package/lightnode-sdk">lightnode-sdk</a>.
        Same data the dashboard at lightnode.app uses; you can re-style or filter freely.
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fafafa", border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function pct(r: number | null): string { return r == null ? "-" : \`\${Math.round(r * 100)}%\`; }
function fmt(n: number): string { return n.toLocaleString(); }
function short(a: string): string { return \`\${a.slice(0, 6)}…\${a.slice(-4)}\`; }
`;

const NODE_DASHBOARD_SCRIPT = `// lightnode-analytics.ts
// Generated by 'lightnode add analytics-dashboard'. Run with: tsx lightnode-analytics.ts
import { LightNode, type NetworkId } from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "mainnet") as NetworkId;
const ln = new LightNode(NETWORK);

const [network, models, workers] = await Promise.all([
  ln.getNetworkAnalytics(),
  ln.getModelStats(),
  ln.getWorkerStats(1000, 10),
]);

console.log(\`LightChain \${NETWORK} - network analytics\\n\`);
console.log(\`Completion : \${pct(network.completionRate)}\`);
console.log(\`Jobs       : \${network.jobs.toLocaleString()}\`);
console.log(\`Incomplete : \${network.incomplete.toLocaleString()}\`);
console.log(\`Earnings   : \${network.earnings.toFixed(2)} LCAI\\n\`);

console.log("Per-model performance:");
for (const m of models) {
  console.log(\`  \${m.name.padEnd(14)} jobs=\${String(m.total).padStart(5)} completion=\${pct(m.completionRate)} p50=\${m.p50 ?? "-"}s earnings=\${m.earnings.toFixed(3)} LCAI\`);
}

console.log("\\nTop 10 workers:");
for (const w of workers) {
  console.log(\`  \${short(w.address)} jobs=\${String(w.total).padStart(4)} completion=\${pct(w.completionRate)} earnings=\${w.earnings.toFixed(3)} LCAI\`);
}

function pct(r: number | null): string { return r == null ? "-" : \`\${Math.round(r * 100)}%\`; }
function short(a: string): string { return \`\${a.slice(0, 6)}…\${a.slice(-4)}\`; }
`;

export function addAnalyticsDashboard(opts: AddOpts = {}): { written: WrittenFile[]; install: string; template: Template; network: Network } {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "mainnet";
  const template: Template = opts.template && opts.template !== "auto" ? opts.template : detectTemplate(cwd);
  const force = !!opts.force;
  const written: WrittenFile[] = [];

  if (template === "nextjs-api") {
    written.push(writeFile(path.join(cwd, "app/lightnode-analytics/page.tsx"), NEXTJS_DASHBOARD_PAGE, force));
  } else {
    // Hono and Node both get the CLI-style script; the SDK calls are pure
    // server-side reads anyway and a custom Hono route is trivial to wrap.
    written.push(writeFile(path.join(cwd, "lightnode-analytics.ts"), NODE_DASHBOARD_SCRIPT, force));
  }

  return { written, install: `npm install lightnode-sdk`, template, network };
}

// ---------------------------------------------------------------------------
// `lightnode add nft-mint-with-inference` - drop in a function that uses
// LightChain AI to generate NFT metadata from a prompt. The caller wires it
// into their existing mint flow; we don't pick a specific ERC-721 contract.
// ---------------------------------------------------------------------------

const NEXTJS_NFT_METADATA_ROUTE = `// app/api/nft-metadata/route.ts
// Generated by 'lightnode add nft-mint-with-inference'.
// Calls /api/inference (also added by 'lightnode add inference') to generate
// an NFT description from a short prompt, returns ERC-721-style metadata.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MintInput {
  name?: string;
  prompt?: string;
  image?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as MintInput;
  const name = body.name?.trim();
  const prompt = body.prompt?.trim();
  if (!name || !prompt) return NextResponse.json({ error: "name and prompt are required" }, { status: 400 });

  // Reuse the inference route added by 'lightnode add inference'. If you mounted
  // it elsewhere, update this path. If you'd rather call the SDK directly here,
  // copy the contents of app/api/inference/route.ts into this file.
  const origin = new URL(req.url).origin;
  const inference = await fetch(\`\${origin}/api/inference\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: \`Write a short, evocative 1-2 sentence description of an NFT titled "\${name}" with this concept: \${prompt}\` }),
  }).then((r) => r.json()) as { answer?: string; txs?: Record<string, string>; error?: string };

  if (!inference?.answer) {
    return NextResponse.json({ error: inference?.error ?? "inference failed" }, { status: 502 });
  }

  return NextResponse.json({
    name,
    description: inference.answer.trim(),
    image: body.image ?? null,
    attributes: body.attributes ?? [],
    // Provenance: the on-chain LightChain AI transactions that generated this metadata.
    // Pin this whole object to IPFS and use the IPFS hash as your tokenURI.
    lightchain_inference: inference.txs,
  });
}
`;

const NEXTJS_NFT_MINT_CLIENT = `// app/nft-mint/page.tsx
// Generated by 'lightnode add nft-mint-with-inference'.
// Minimal client that takes a name + concept, generates AI metadata via the
// /api/nft-metadata route, and shows the result. Bring your own mint() call.
"use client";
import { useState } from "react";

interface Metadata { name: string; description: string; image: string | null; attributes: unknown[]; lightchain_inference?: Record<string, string> }

export default function NftMint() {
  const [name, setName] = useState("Cosmic Wanderer");
  const [prompt, setPrompt] = useState("an astronaut surfing on the edge of a black hole");
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main style={{ maxWidth: 640, margin: "40px auto", padding: 20, fontFamily: "system-ui" }}>
      <h1>Mint an NFT with AI metadata</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        The description is generated by LightChain AI inference. The transaction hashes are returned in the
        metadata as on-chain provenance you can pin alongside the JSON.
      </p>
      <label style={{ display: "block", marginTop: 16, fontSize: 13 }}>NFT name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 10, fontSize: 14 }} />
      <label style={{ display: "block", marginTop: 12, fontSize: 13 }}>Concept</label>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} style={{ width: "100%", padding: 10, fontSize: 14 }} />
      <button
        disabled={busy || !name || !prompt}
        onClick={async () => {
          setBusy(true); setMeta(null);
          try {
            const r = await fetch("/api/nft-metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, prompt }) }).then((r) => r.json());
            setMeta(r);
          } finally { setBusy(false); }
        }}
        style={{ marginTop: 12, padding: "10px 20px", fontSize: 14 }}
      >
        {busy ? "Generating..." : "Generate metadata"}
      </button>
      {meta && (
        <pre style={{ marginTop: 20, padding: 16, background: "#eee", whiteSpace: "pre-wrap", fontSize: 13 }}>
          {JSON.stringify(meta, null, 2)}
        </pre>
      )}
      {/* Wire your own mint(uri) call here. tokenURI = ipfs://<hash of meta> after pinning. */}
    </main>
  );
}
`;

const NODE_NFT_METADATA_SCRIPT = `// nft-metadata.ts
// Generated by 'lightnode add nft-mint-with-inference'.
// Use:  tsx nft-metadata.ts "Cosmic Wanderer" "an astronaut surfing on the edge of a black hole"
//
// Calls LightChain AI inference directly, prints ERC-721-style metadata to stdout.
// Pipe to a file + pin to IPFS for the tokenURI in your mint contract.
import WS from "ws";
import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, parseEther, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  LightNode, prepareSession, submitPrompt, decryptResponse,
  estimateJobFee, consumerGatewayUrl, JOB_REGISTRY_CONSUMER_ABI,
  GatewayClient, type NetworkId,
} from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "testnet") as NetworkId;
const MODEL = process.env.MODEL ?? "llama3-8b";
const [, , NAME, ...promptArgs] = process.argv;
const CONCEPT = promptArgs.join(" ").trim();
if (!NAME || !CONCEPT) { console.error('usage: tsx nft-metadata.ts "NFT Name" "concept"'); process.exit(1); }
const PRIVATE_KEY = process.env.PRIVATE_KEY as \`0x\${string}\` | undefined;
if (!PRIVATE_KEY?.startsWith("0x") || PRIVATE_KEY.length !== 66) { console.error("set PRIVATE_KEY in .env"); process.exit(1); }

const ln = new LightNode(NETWORK);
const cfg = ln.network;
const acct = privateKeyToAccount(PRIVATE_KEY);
const chain = { id: cfg.chainId, name: cfg.label, nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } };
const pub = createPublicClient({ transport: http(cfg.rpc), chain });
const wal = createWalletClient({ account: acct, transport: http(cfg.rpc), chain });
const abi = parseAbi(JOB_REGISTRY_CONSUMER_ABI);

const ch = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/challenge?address=\${acct.address}\`)).json() as { message?: string };
if (!ch.message) throw new Error("auth challenge failed");
const sig = await wal.signMessage({ message: ch.message });
const verify = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/verify\`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: ch.message, signature: sig }) })).json() as { token?: string };
if (!verify.token) throw new Error("auth verify failed");
const gateway = new GatewayClient({ network: NETWORK, bearer: verify.token });

const { sessionKey, createSessionArgs } = await prepareSession(gateway, MODEL);
const fee = await estimateJobFee(cfg, MODEL);
const createTx = await wal.writeContract({
  address: cfg.jobRegistry as \`0x\${string}\`, abi, functionName: "createSession",
  args: [createSessionArgs.paramsHash, createSessionArgs.worker, createSessionArgs.encWorkerKey, createSessionArgs.ephemeralPubKey, createSessionArgs.initState, createSessionArgs.expiry],
  gas: 1_000_000n,
});
const createReceipt = await pub.waitForTransactionReceipt({ hash: createTx });
const sessionCreated = parseAbiItem("event SessionCreated(uint256 indexed sessionId, address indexed user, bytes32 indexed paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey)");
const sessionLog = (await pub.getLogs({ address: cfg.jobRegistry as \`0x\${string}\`, event: sessionCreated, blockHash: createReceipt.blockHash })).find((l) => l.transactionHash === createTx);
const sessionId = sessionLog?.args.sessionId;
if (!sessionId) throw new Error("SessionCreated missing");

let relayToken: string | undefined;
for (let i = 0; i < 30 && !relayToken; i++) {
  const r = await gateway.getSessionToken(Number(sessionId));
  if ("token" in r && r.token) relayToken = r.token; else await new Promise((res) => setTimeout(res, 1000));
}
if (!relayToken) throw new Error("relay token never became ready");
const ws = new WS(\`wss://relay.\${NETWORK}.lightchain.ai/ws?token=\${encodeURIComponent(relayToken)}\`);
const chunks: string[] = [];
await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
ws.on("message", async (data: Buffer) => {
  let f: { type?: string; payload?: string };
  try { f = JSON.parse(data.toString("utf8")); } catch { return; }
  if (!f.payload) return;
  if (f.type === "chunk") { try { chunks.push(await decryptResponse(sessionKey, f.payload)); } catch {} }
  else if (f.type === "complete" && chunks.length === 0) { try { chunks.push(await decryptResponse(sessionKey, f.payload)); } catch {} }
});

const PROMPT = \`Write a short, evocative 1-2 sentence description of an NFT titled "\${NAME}" with this concept: \${CONCEPT}\`;
const promptHash = await submitPrompt(gateway, sessionKey, PROMPT);
const submitTx = await wal.writeContract({
  address: cfg.jobRegistry as \`0x\${string}\`, abi, functionName: "submitJob",
  args: [sessionId, promptHash], value: parseEther(String(fee)), gas: 500_000n,
});
const submitReceipt = await pub.waitForTransactionReceipt({ hash: submitTx });
const jobSubmitted = parseAbiItem("event JobSubmitted(uint256 indexed jobId, uint256 indexed sessionId, address worker)");
const jobLog = (await pub.getLogs({ address: cfg.jobRegistry as \`0x\${string}\`, event: jobSubmitted, blockHash: submitReceipt.blockHash })).find((l) => l.transactionHash === submitTx);
const jobId = jobLog?.args.jobId;
if (!jobId) throw new Error("JobSubmitted missing");

const jobCompleted = parseAbiItem("event JobCompleted(uint256 indexed jobId, address indexed worker, bytes32 responseHash, bytes32 ciphertextHash)");
const deadline = Date.now() + 90_000;
let completed: Log | null = null;
while (!completed && Date.now() < deadline) {
  await new Promise((res) => setTimeout(res, 3000));
  const logs = await pub.getLogs({ address: cfg.jobRegistry as \`0x\${string}\`, event: jobCompleted, args: { jobId }, fromBlock: submitReceipt.blockNumber });
  if (logs.length) completed = logs[0] as Log;
}
if (!completed) { console.error("worker stalled - re-run for a different worker"); process.exit(1); }
await new Promise((res) => setTimeout(res, 4000));
ws.close();

const description = chunks.join("").trim();
const metadata = {
  name: NAME,
  description,
  image: null,
  attributes: [] as unknown[],
  lightchain_inference: {
    createSession: createTx,
    submitJob: submitTx,
    jobCompleted: completed.transactionHash,
    sessionId: sessionId.toString(),
    jobId: jobId.toString(),
    worker: createSessionArgs.worker,
  },
};
console.log(JSON.stringify(metadata, null, 2));
process.exit(0);
`;

// ---------------------------------------------------------------------------
// `lightnode add chat` - drop in a chat-style UI that uses the SDK's high-
// level runInference() helper. Keeps conversation history client-side and
// formats every prior turn into the next prompt so the model has context.
// ---------------------------------------------------------------------------

const NEXTJS_CHAT_PAGE = `// app/chat/page.tsx
// Generated by 'lightnode add chat'.
"use client";
import { useState } from "react";

type Turn = { role: "user" | "assistant"; text: string; txs?: Record<string, string> };

export default function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!draft.trim()) return;
    const next: Turn[] = [...turns, { role: "user", text: draft.trim() }];
    setTurns(next);
    setDraft("");
    setBusy(true);
    // Reserve the assistant bubble immediately so tokens can stream into it.
    setTurns([...next, { role: "assistant", text: "" }]);
    try {
      const prompt =
        next.map((t) => (t.role === "user" ? \`User: \${t.text}\` : \`Assistant: \${t.text}\`)).join("\\n") +
        "\\nAssistant:";
      const r = await fetch("/api/inference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, stream: true }),
      });
      if (!r.ok || !r.body) {
        const err = await r.text().catch(() => "");
        throw new Error(\`route returned \${r.status}: \${err.slice(0, 200)}\`);
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let assembled = "";
      let txs: Record<string, string> | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        // The route ends the stream with one line of JSON on a new \\u0000
        // delimiter (a NUL byte we put between the streamed prose and the
        // metadata). Anything before is body; anything after is metadata.
        const nulIdx = text.indexOf("\\u0000");
        if (nulIdx === -1) {
          assembled += text;
          setTurns((prev) => prev.map((t, i) => i === prev.length - 1 ? { ...t, text: assembled } : t));
        } else {
          assembled += text.slice(0, nulIdx);
          try { txs = JSON.parse(text.slice(nulIdx + 1)) as Record<string, string>; } catch { /* ignore */ }
          setTurns((prev) => prev.map((t, i) => i === prev.length - 1 ? { ...t, text: assembled, txs } : t));
        }
      }
    } catch (e) {
      // Replace the empty assistant bubble with the error.
      setTurns((prev) => prev.map((t, i) =>
        i === prev.length - 1 ? { ...t, text: \`(error: \${(e as Error).message})\` } : t
      ));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: "30px auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h1>LightChain AI - chat</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        Each turn pays ~0.02 LCAI on mainnet (free on testnet). Conversation history is sent with each turn so the
        model has context.
      </p>
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        {turns.map((t, i) => (
          <div
            key={i}
            style={{
              padding: 14,
              borderRadius: 12,
              background: t.role === "user" ? "#e8f0ff" : "#f4f4f4",
              alignSelf: t.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              whiteSpace: "pre-wrap",
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {t.role}
            </div>
            {t.text}
            {t.txs && (
              <div style={{ marginTop: 8, fontSize: 11, color: "#888", fontFamily: "monospace" }}>
                jobCompleted: {t.txs.jobCompleted?.slice(0, 18)}…
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div style={{ padding: 14, color: "#888", fontStyle: "italic" }}>
            running encrypted inference…
          </div>
        )}
      </div>
      <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && send()}
          placeholder="Type a message…"
          style={{ flex: 1, padding: 12, fontSize: 14, borderRadius: 8, border: "1px solid #ccc" }}
        />
        <button
          onClick={send}
          disabled={busy || !draft.trim()}
          style={{ padding: "10px 20px", fontSize: 14, borderRadius: 8 }}
        >
          Send
        </button>
      </div>
      <p style={{ marginTop: 16, fontSize: 12, color: "#888" }}>
        Your server signs every call with the PRIVATE_KEY in <code>.env</code>. Cost per turn is paid from that wallet.
        See <code>LIGHTNODE-HOSTING.md</code> for picking a host that handles 60-90s function calls.
      </p>
    </main>
  );
}
`;

/**
 * Streaming inference route, paired with NEXTJS_CHAT_PAGE.
 *
 * Why a second route: the plain NEXTJS_ROUTE returns JSON in one shot,
 * which is fine for one-off calls but means the chat UI shows nothing for
 * 60-90s. This streams decrypted chunks as they arrive (via
 * runInferenceStream), so the user sees tokens land live and the host
 * keeps the connection warm. After the last chunk we append a NUL byte
 * (\\u0000) and a JSON line with the tx hashes so the client can render
 * the on-chain receipt under the assistant bubble.
 */
const NEXTJS_INFERENCE_STREAM_ROUTE = `// app/api/inference/route.ts
// Generated by 'lightnode add chat'. Streaming inference route - tokens
// arrive live as the model produces them, then a NUL byte separates them
// from a final JSON line with the on-chain tx hashes.
//
// Pass { stream: true } in the body to get streaming. Without that flag
// the same route still returns one-shot JSON, which is fine for non-chat
// integrations.
//
// Mainnet 8b inference takes 60-90s. Vercel Hobby caps function execution
// at 10s and will time out. See LIGHTNODE-HOSTING.md for hosts that work.
import { NextResponse } from "next/server";
import { runInferenceWithKey, runInferenceStream } from "lightnode-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NETWORK = (process.env.NETWORK ?? "testnet") as "mainnet" | "testnet";
const MODEL = process.env.MODEL ?? "llama3-8b";

export async function POST(req: Request) {
  if (!process.env.PRIVATE_KEY?.startsWith("0x")) {
    return NextResponse.json({ error: "PRIVATE_KEY not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { prompt?: string; system?: string; stream?: boolean };
  const prompt = body.prompt?.trim();
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  const args = {
    network: NETWORK,
    privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
    model: MODEL,
    system: body.system?.trim() || undefined,
    prompt,
  };

  // One-shot JSON path: same shape as the original 'add inference' route.
  if (!body.stream) {
    try {
      const { answer, worker, txs, jobId } = await runInferenceWithKey(args);
      return NextResponse.json({
        answer, worker, jobId: jobId.toString(),
        txs: { createSession: txs.createSession, submitJob: txs.submitJob, jobCompleted: txs.jobCompleted },
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // Streaming path: tokens, NUL byte, then tx metadata as JSON.
  const stream = runInferenceStream(args);
  const encoder = new TextEncoder();
  const body$ = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) controller.enqueue(encoder.encode(chunk));
        const { worker, txs, jobId } = await stream.done;
        const meta = JSON.stringify({
          worker, jobId: jobId.toString(),
          createSession: txs.createSession, submitJob: txs.submitJob, jobCompleted: txs.jobCompleted,
        });
        controller.enqueue(encoder.encode("\\u0000" + meta));
        controller.close();
      } catch (e) {
        controller.enqueue(encoder.encode(\`\\u0000{"error":\${JSON.stringify((e as Error).message)}}\`));
        controller.close();
      }
    },
  });
  return new Response(body$, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
`;

const NEXTJS_CHAT_WEB3_PAGE = `// app/chat-web3/page.tsx
// Generated by 'lightnode add chat-web3'. User-pays chat: each visitor's own
// wallet signs SIWE + createSession per turn. Your app holds zero funds.
//
// Prereqs:
//   - wagmi configured in your app (https://wagmi.sh/react/getting-started)
//   - the connected wallet has LCAI on the LightChain network it is on
//     (mainnet 9200 or testnet 8200). Mainnet llama3-8b costs 0.02 LCAI per
//     turn plus a small gas amount.
"use client";

import { useEffect, useState } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { siweSignIn, GatewayClient, runInference, estimateJobFee, NETWORKS } from "lightnode-sdk";
import { ConnectButton } from "@/components/connect-button";

type Turn = {
  role: "user" | "assistant";
  text: string;
  worker?: string | null;
  jobId?: string | null;
  submitTx?: \`0x\${string}\` | null;
  jobCompletedTx?: \`0x\${string}\` | null;
};

const MODEL = "llama3-8b";

export default function ChatWeb3() {
  const { address, chain } = useAccount();
  const network: "mainnet" | "testnet" | null =
    chain?.id === 9200 ? "mainnet" : chain?.id === 8200 ? "testnet" : null;
  const { data: walletClient } = useWalletClient({ chainId: chain?.id });
  const publicClient = usePublicClient({ chainId: chain?.id });

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [feeLcai, setFeeLcai] = useState<number | null>(null);

  // Read the on-chain fee for the connected network so we can show the
  // visitor the real cost per turn before they click Send.
  useEffect(() => {
    if (!network) { setFeeLcai(null); return; }
    let cancelled = false;
    estimateJobFee(NETWORKS[network], MODEL).then(
      (fee) => { if (!cancelled) setFeeLcai(fee); },
      () => { if (!cancelled) setFeeLcai(null); },
    );
    return () => { cancelled = true; };
  }, [network]);

  /** Build a single prompt from history + new user input. */
  function composePrompt(history: Turn[], next: string, system: string): string {
    const lines: string[] = [];
    for (const t of history) {
      lines.push(\`\${t.role === "user" ? "User" : "Assistant"}: \${t.text}\`);
    }
    lines.push(\`User: \${next}\`);
    lines.push("Assistant:");
    return system ? \`\${system}\\n\\n\${lines.join("\\n\\n")}\` : lines.join("\\n\\n");
  }

  async function send() {
    if (!walletClient || !publicClient || !address || !network) {
      setErr("Connect a wallet on LightChain mainnet (9200) or testnet (8200) first.");
      return;
    }
    const next = input.trim();
    if (!next) return;
    setBusy(true);
    setErr(null);
    const history = [...turns];
    // Optimistic user bubble so it appears immediately.
    setTurns([...history, { role: "user", text: next }]);
    setInput("");
    try {
      const system = "You are a concise assistant. Reply in one or two short sentences.";
      const prompt = composePrompt(history, next, system);

      setBusyStage("Sign in with your wallet (SIWE)...");
      const session = await siweSignIn(walletClient as unknown as Parameters<typeof siweSignIn>[0], network);

      setBusyStage("Approve the createSession transaction in your wallet...");
      const gateway = new GatewayClient({ network, bearer: session.bearer });
      const result = await runInference({
        prompt,
        gateway,
        wallet: walletClient as unknown as Parameters<typeof runInference>[0]["wallet"],
        publicClient: publicClient as unknown as Parameters<typeof runInference>[0]["publicClient"],
        network: NETWORKS[network],
        model: MODEL,
        jobCompletedTimeoutMs: 120_000,
        maxRetries: 1,
      });

      setTurns([...history, { role: "user", text: next }, {
        role: "assistant",
        text: result.answer,
        worker: result.worker,
        jobId: result.jobId?.toString() ?? null,
        submitTx: result.txs?.submitJob ?? null,
        jobCompletedTx: result.txs?.jobCompleted ?? null,
      }]);
    } catch (e) {
      // Roll back the optimistic user bubble so the visitor can retry.
      setTurns(history);
      setInput(next);
      const msg = (e as Error).message ?? "chat failed";
      setErr(
        /user rejected|user denied|reject/i.test(msg)
          ? "You rejected the wallet popup. Try again."
          : /insufficient funds|insufficient balance/i.test(msg)
            ? \`Your wallet has no \${network === "mainnet" ? "LCAI" : "testnet LCAI"}. Top it up before sending.\`
            : msg.split("\\n")[0],
      );
    } finally {
      setBusy(false);
      setBusyStage("");
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "32px auto", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1>Chat (user-pays)</h1>
        <ConnectButton />
      </div>
      <p style={{ color: "#666" }}>
        Each turn signs one createSession transaction from your wallet on{" "}
        <code>{network ?? "(connect a wallet)"}</code>. Fee:{" "}
        <code>{feeLcai != null ? \`\${feeLcai} LCAI\` : "(fetching)"}</code> per turn plus a small gas amount.
      </p>
      {!address && (
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, margin: "12px 0", display: "flex", alignItems: "center", gap: 12 }}>
          <span>Connect a wallet to start chatting.</span>
          <ConnectButton />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "16px 0" }}>
        {turns.map((t, i) => (
          <div
            key={i}
            style={{
              alignSelf: t.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              borderRadius: 12,
              padding: "8px 12px",
              background: t.role === "user" ? "#e9e7ff" : "#f5f5f7",
            }}
          >
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t.text}</div>
            {t.role === "assistant" && t.submitTx ? (
              <div style={{ marginTop: 6, fontSize: 11, color: "#666", display: "flex", gap: 8, flexWrap: "wrap" }}>
                {t.worker && (
                  <a href={\`https://\${network}.lightscan.app/address/\${t.worker}\`} target="_blank" rel="noopener noreferrer">
                    worker
                  </a>
                )}
                {t.jobId && <span>job #{t.jobId}</span>}
                {t.submitTx && (
                  <a href={\`https://\${network}.lightscan.app/tx/\${t.submitTx}\`} target="_blank" rel="noopener noreferrer">
                    submitJob
                  </a>
                )}
                {t.jobCompletedTx && (
                  <a href={\`https://\${network}.lightscan.app/tx/\${t.jobCompletedTx}\`} target="_blank" rel="noopener noreferrer">
                    completed
                  </a>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!busy && input.trim()) send(); }
        }}
        rows={2}
        placeholder={turns.length === 0 ? "Say hello (cmd+enter to send)" : "Reply..."}
        style={{ width: "100%", padding: 8, fontFamily: "inherit" }}
      />
      <button
        type="button"
        onClick={() => send()}
        disabled={busy || !input.trim() || !address || !network}
        style={{ marginTop: 8, padding: "8px 16px" }}
      >
        {busy ? (busyStage || "Sending...") : (turns.length === 0 ? "Send first message" : "Send")}
      </button>
      {err && (
        <p style={{ marginTop: 8, padding: "8px 12px", border: "1px solid #f5c2c7", background: "#f8d7da", color: "#842029", borderRadius: 6 }}>
          {err}
        </p>
      )}
    </main>
  );
}
`;

const NEXTJS_INFERENCE_WEB3_PAGE = `// app/inference-web3/page.tsx
// Generated by 'lightnode add inference-web3'. User-pays one-shot inference:
// each visitor's wallet signs SIWE + createSession + submitJob. Your app
// holds zero funds and the answer comes back with on-chain proof anyone
// can verify.
//
// Prereqs:
//   - wagmi configured (npx lightnode add wagmi-setup if you don't have it)
//   - the connected wallet has LCAI on the chain it's on
//     (mainnet 9200 or testnet 8200). Mainnet llama3-8b is 0.02 LCAI per call.
"use client";

import { useEffect, useState } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { siweSignIn, GatewayClient, runInference, estimateJobFee, NETWORKS } from "lightnode-sdk";
import { ConnectButton } from "@/components/connect-button";

type Result = {
  answer: string;
  worker: \`0x\${string}\`;
  jobId: string;
  submitJob: \`0x\${string}\`;
  jobCompleted: \`0x\${string}\` | null;
  elapsedMs: number;
};

const MODEL = "llama3-8b";

export default function InferenceWeb3() {
  const { address, chain } = useAccount();
  const network: "mainnet" | "testnet" | null =
    chain?.id === 9200 ? "mainnet" : chain?.id === 8200 ? "testnet" : null;
  const { data: walletClient } = useWalletClient({ chainId: chain?.id });
  const publicClient = usePublicClient({ chainId: chain?.id });

  const [system, setSystem] = useState("You are a concise assistant. Reply in one or two short sentences.");
  const [prompt, setPrompt] = useState("Reply with the single word OK.");
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [feeLcai, setFeeLcai] = useState<number | null>(null);

  useEffect(() => {
    if (!network) { setFeeLcai(null); return; }
    let cancelled = false;
    estimateJobFee(NETWORKS[network], MODEL).then(
      (fee) => { if (!cancelled) setFeeLcai(fee); },
      () => { if (!cancelled) setFeeLcai(null); },
    );
    return () => { cancelled = true; };
  }, [network]);

  async function run() {
    if (!walletClient || !publicClient || !address || !network) {
      setErr("Connect a wallet on LightChain mainnet (9200) or testnet (8200) first.");
      return;
    }
    if (!prompt.trim()) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    const t0 = Date.now();
    try {
      setBusyStage("Sign in with your wallet (SIWE)...");
      const session = await siweSignIn(walletClient as unknown as Parameters<typeof siweSignIn>[0], network);

      setBusyStage("Approve the createSession transaction in your wallet...");
      const gateway = new GatewayClient({ network, bearer: session.bearer });
      const composed = system.trim() ? \`\${system.trim()}\\n\\n\${prompt}\` : prompt;
      const r = await runInference({
        prompt: composed,
        gateway,
        wallet: walletClient as unknown as Parameters<typeof runInference>[0]["wallet"],
        publicClient: publicClient as unknown as Parameters<typeof runInference>[0]["publicClient"],
        network: NETWORKS[network],
        model: MODEL,
        jobCompletedTimeoutMs: 120_000,
        maxRetries: 1,
      });
      setResult({
        answer: r.answer,
        worker: r.worker,
        jobId: r.jobId?.toString() ?? "",
        submitJob: r.txs?.submitJob,
        jobCompleted: r.txs?.jobCompleted ?? null,
        elapsedMs: Date.now() - t0,
      });
    } catch (e) {
      const msg = (e as Error).message ?? "inference failed";
      setErr(
        /user rejected|user denied|reject/i.test(msg) ? "You rejected the wallet popup. Try again."
        : /insufficient funds|insufficient balance/i.test(msg)
          ? \`Your wallet has no \${network === "mainnet" ? "LCAI" : "testnet LCAI"}. Top it up before sending.\`
          : msg.split("\\n")[0]
      );
    } finally {
      setBusy(false);
      setBusyStage("");
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "32px auto", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1>Inference (user-pays)</h1>
        <ConnectButton />
      </div>
      <p style={{ color: "#666" }}>
        Signs one encrypted inference from your wallet on{" "}
        <code>{network ?? "(connect a wallet)"}</code>. Fee:{" "}
        <code>{feeLcai != null ? \`\${feeLcai} LCAI\` : "(fetching)"}</code> per call plus a small gas amount.
      </p>
      {!address && (
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, margin: "12px 0", display: "flex", alignItems: "center", gap: 12 }}>
          <span>Connect a wallet to run inference.</span>
          <ConnectButton />
        </div>
      )}

      <label style={{ display: "block", margin: "12px 0" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888", marginBottom: 4 }}>System prompt</div>
        <textarea value={system} onChange={(e) => setSystem(e.target.value)} rows={2}
          style={{ width: "100%", padding: 8, fontFamily: "monospace", fontSize: 12 }} />
      </label>
      <label style={{ display: "block", margin: "12px 0" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888", marginBottom: 4 }}>Prompt</div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5}
          style={{ width: "100%", padding: 8, fontFamily: "monospace", fontSize: 12 }} />
      </label>
      <button type="button" onClick={() => run()} disabled={busy || !prompt.trim() || !address || !network}
        style={{ padding: "8px 16px", borderRadius: 8, cursor: busy ? "wait" : "pointer" }}>
        {busy ? (busyStage || "Running...") : "Run inference"}
      </button>

      {err && (
        <p style={{ marginTop: 12, padding: "8px 12px", border: "1px solid #f5c2c7", background: "#f8d7da", color: "#842029", borderRadius: 6 }}>
          {err}
        </p>
      )}

      {result && (
        <div style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>Answer</div>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{result.answer}</pre>
          <div style={{ marginTop: 12, fontSize: 12, color: "#666", display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>elapsed {Math.round(result.elapsedMs / 1000)}s</span>
            <span>job #{result.jobId}</span>
            <a href={\`https://\${network}.lightscan.app/address/\${result.worker}\`} target="_blank" rel="noopener noreferrer">worker</a>
            <a href={\`https://\${network}.lightscan.app/tx/\${result.submitJob}\`} target="_blank" rel="noopener noreferrer">submitJob</a>
            {result.jobCompleted && (
              <a href={\`https://\${network}.lightscan.app/tx/\${result.jobCompleted}\`} target="_blank" rel="noopener noreferrer">jobCompleted</a>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
`;

const NEXTJS_JUDGE_WEB3_PAGE = `// app/judge-web3/page.tsx
// Generated by 'lightnode add judge-web3'. The LightChallenge pattern with
// the user paying: visitor submits criteria + evidence, signs from their own
// wallet, the verdict comes back with on-chain proof. Pattern fits any
// platform where users want a verifiable AI verdict on their own submission
// (challenge completion, NFT trait grading, content moderation, etc.).
//
// Prereqs:
//   - wagmi configured (npx lightnode add wagmi-setup if you don't have it)
//   - the connected wallet has LCAI on the chain it's on
"use client";

import { useEffect, useState } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { siweSignIn, GatewayClient, runInference, estimateJobFee, NETWORKS } from "lightnode-sdk";
import { ConnectButton } from "@/components/connect-button";

type Verdict = {
  passed: boolean;
  confidence: number;
  reason: string;
};

type Result = {
  verdict: Verdict | null;
  raw: string;
  worker: \`0x\${string}\`;
  jobId: string;
  submitJob: \`0x\${string}\`;
  jobCompleted: \`0x\${string}\` | null;
};

const MODEL = "llama3-8b";

export default function JudgeWeb3() {
  const { address, chain } = useAccount();
  const network: "mainnet" | "testnet" | null =
    chain?.id === 9200 ? "mainnet" : chain?.id === 8200 ? "testnet" : null;
  const { data: walletClient } = useWalletClient({ chainId: chain?.id });
  const publicClient = usePublicClient({ chainId: chain?.id });

  const [criteria, setCriteria] = useState("Run a mile under 8 minutes");
  const [evidence, setEvidence] = useState('{"distance_km": 1.61, "time_minutes": 7.4}');
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [feeLcai, setFeeLcai] = useState<number | null>(null);

  useEffect(() => {
    if (!network) { setFeeLcai(null); return; }
    let cancelled = false;
    estimateJobFee(NETWORKS[network], MODEL).then(
      (fee) => { if (!cancelled) setFeeLcai(fee); },
      () => { if (!cancelled) setFeeLcai(null); },
    );
    return () => { cancelled = true; };
  }, [network]);

  /** Parse the verdict defensively; fall back to the first {...} block. */
  function parseVerdict(answer: string): Verdict | null {
    try { return JSON.parse(answer) as Verdict; } catch { /* try regex */ }
    const m = answer.match(/\\{[\\s\\S]*\\}/);
    if (m) {
      try { return JSON.parse(m[0]) as Verdict; } catch { /* keep null */ }
    }
    return null;
  }

  async function run() {
    if (!walletClient || !publicClient || !address || !network) {
      setErr("Connect a wallet on LightChain mainnet (9200) or testnet (8200) first.");
      return;
    }
    if (!criteria.trim() || !evidence.trim()) return;
    // Validate evidence JSON before paying.
    try { JSON.parse(evidence); } catch {
      setErr("Evidence is not valid JSON. Fix it and try again.");
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setBusyStage("Sign in with your wallet (SIWE)...");
      const session = await siweSignIn(walletClient as unknown as Parameters<typeof siweSignIn>[0], network);

      setBusyStage("Approve the createSession transaction in your wallet...");
      const gateway = new GatewayClient({ network, bearer: session.bearer });
      const prompt = \`Criteria: \${criteria.trim()}

Evidence: \${evidence.trim()}

Reply with STRICT JSON only, matching: { "passed": boolean, "confidence": 0-1, "reason": string }\`;

      const r = await runInference({
        prompt: \`You are a careful judge. Reply with STRICT JSON only, no prose.\\n\\n\${prompt}\`,
        gateway,
        wallet: walletClient as unknown as Parameters<typeof runInference>[0]["wallet"],
        publicClient: publicClient as unknown as Parameters<typeof runInference>[0]["publicClient"],
        network: NETWORKS[network],
        model: MODEL,
        jobCompletedTimeoutMs: 120_000,
        maxRetries: 1,
      });
      setResult({
        verdict: parseVerdict(r.answer),
        raw: r.answer,
        worker: r.worker,
        jobId: r.jobId?.toString() ?? "",
        submitJob: r.txs?.submitJob,
        jobCompleted: r.txs?.jobCompleted ?? null,
      });
    } catch (e) {
      const msg = (e as Error).message ?? "judge failed";
      setErr(
        /user rejected|user denied|reject/i.test(msg) ? "You rejected the wallet popup. Try again."
        : /insufficient funds|insufficient balance/i.test(msg)
          ? \`Your wallet has no \${network === "mainnet" ? "LCAI" : "testnet LCAI"}. Top it up before submitting.\`
          : msg.split("\\n")[0]
      );
    } finally {
      setBusy(false);
      setBusyStage("");
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "32px auto", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1>AI Judge (user-pays)</h1>
        <ConnectButton />
      </div>
      <p style={{ color: "#666" }}>
        Each submission signs one inference from your wallet on{" "}
        <code>{network ?? "(connect a wallet)"}</code>. Cost:{" "}
        <code>{feeLcai != null ? \`\${feeLcai} LCAI\` : "(fetching)"}</code> plus gas. Verdict comes back with on-chain proof.
      </p>
      {!address && (
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, margin: "12px 0", display: "flex", alignItems: "center", gap: 12 }}>
          <span>Connect a wallet to submit.</span>
          <ConnectButton />
        </div>
      )}

      <label style={{ display: "block", margin: "12px 0" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888", marginBottom: 4 }}>Criteria</div>
        <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={2}
          style={{ width: "100%", padding: 8, fontFamily: "monospace", fontSize: 12 }} />
      </label>
      <label style={{ display: "block", margin: "12px 0" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888", marginBottom: 4 }}>Evidence (JSON)</div>
        <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={5}
          style={{ width: "100%", padding: 8, fontFamily: "monospace", fontSize: 12 }} />
      </label>
      <button type="button" onClick={() => run()} disabled={busy || !criteria.trim() || !evidence.trim() || !address || !network}
        style={{ padding: "8px 16px", borderRadius: 8, cursor: busy ? "wait" : "pointer" }}>
        {busy ? (busyStage || "Judging...") : "Get AI verdict"}
      </button>

      {err && (
        <p style={{ marginTop: 12, padding: "8px 12px", border: "1px solid #f5c2c7", background: "#f8d7da", color: "#842029", borderRadius: 6 }}>
          {err}
        </p>
      )}

      {result && (
        <div style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>Verdict</div>
          {result.verdict ? (
            <div>
              <div style={{ fontSize: 24, fontWeight: 600, color: result.verdict.passed ? "#2e7d32" : "#c62828" }}>
                {result.verdict.passed ? "PASSED" : "FAILED"}
                <span style={{ marginLeft: 12, fontSize: 14, color: "#666" }}>
                  confidence {Math.round(result.verdict.confidence * 100)}%
                </span>
              </div>
              <p style={{ marginTop: 8, color: "#444" }}>{result.verdict.reason}</p>
            </div>
          ) : (
            <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "monospace", fontSize: 12, color: "#666" }}>
              {result.raw}
            </pre>
          )}
          <div style={{ marginTop: 12, fontSize: 12, color: "#666", display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>job #{result.jobId}</span>
            <a href={\`https://\${network}.lightscan.app/address/\${result.worker}\`} target="_blank" rel="noopener noreferrer">worker</a>
            <a href={\`https://\${network}.lightscan.app/tx/\${result.submitJob}\`} target="_blank" rel="noopener noreferrer">submitJob</a>
            {result.jobCompleted && (
              <a href={\`https://\${network}.lightscan.app/tx/\${result.jobCompleted}\`} target="_blank" rel="noopener noreferrer">jobCompleted</a>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
`;

const NODE_CHAT_REPL = `// chat-repl.ts
// Generated by 'lightnode add chat'. Interactive chat REPL in your terminal.
//   npm install lightnode-sdk viem ws
//   tsx chat-repl.ts
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import WS from "ws";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LightNode, runInference, GatewayClient, consumerGatewayUrl, type NetworkId } from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "testnet") as NetworkId;
const MODEL = process.env.MODEL ?? "llama3-8b";
const PRIVATE_KEY = process.env.PRIVATE_KEY as \`0x\${string}\` | undefined;
if (!PRIVATE_KEY?.startsWith("0x") || PRIVATE_KEY.length !== 66) { console.error("set PRIVATE_KEY in .env"); process.exit(1); }

const ln = new LightNode(NETWORK);
const acct = privateKeyToAccount(PRIVATE_KEY);
const chain = { id: ln.network.chainId, name: ln.network.label, nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: [ln.network.rpc] } } };
const pub = createPublicClient({ transport: http(ln.network.rpc), chain });
const wal = createWalletClient({ account: acct, transport: http(ln.network.rpc), chain });

// One SIWE handshake per process; the JWT is reused across all turns.
const ch = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/challenge?address=\${acct.address}\`)).json() as { message?: string };
if (!ch.message) throw new Error("auth challenge failed");
const sig = await wal.signMessage({ message: ch.message });
const verify = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/verify\`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: ch.message, signature: sig }) })).json() as { token?: string };
if (!verify.token) throw new Error("auth verify failed");
const gateway = new GatewayClient({ network: NETWORK, bearer: verify.token });

const rl = readline.createInterface({ input, output });
const turns: { role: "user" | "assistant"; text: string }[] = [];
console.log(\`▶ chat on \${NETWORK}, model=\${MODEL}. Ctrl+C to exit.\\n\`);

while (true) {
  const user = (await rl.question("> ")).trim();
  if (!user) continue;
  turns.push({ role: "user", text: user });
  const prompt = turns.map((t) => (t.role === "user" ? \`User: \${t.text}\` : \`Assistant: \${t.text}\`)).join("\\n") + "\\nAssistant:";
  try {
    process.stdout.write("  ");
    const { answer } = await runInference({
      prompt, gateway, wallet: wal, publicClient: pub, network: ln.network,
      model: MODEL, WebSocket: WS,
      onChunk: (chunk) => process.stdout.write(chunk),
    });
    process.stdout.write("\\n\\n");
    turns.push({ role: "assistant", text: answer });
  } catch (e) {
    console.log(\`  (error: \${(e as Error).message})\`);
  }
}
`;

// ---------------------------------------------------------------------------
// `lightnode add agent` - drop in a scheduled/loop inference scaffold. Good
// for daily summarizers, monitoring agents, cron jobs that run inference on a
// fixed cadence. For Next.js: a /api/agent route that Vercel Cron (or any
// cron-style trigger) can hit on schedule. For Node: a standalone script that
// runs inference on an interval until you kill it.
// ---------------------------------------------------------------------------

const NEXTJS_AGENT_ROUTE = `// app/api/agent/route.ts
// Generated by 'lightnode add agent'.
//
// Set up Vercel Cron in vercel.json:
//   { "crons": [{ "path": "/api/agent", "schedule": "0 9 * * *" }] }
// That hits this route every day at 09:00 UTC.
//
// Auth your cron call: Vercel Cron sends a Bearer token in the Authorization
// header that you can verify here against CRON_SECRET. See:
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
import { NextResponse } from "next/server";
import WS from "ws";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LightNode, GatewayClient, runInference, consumerGatewayUrl, type NetworkId } from "lightnode-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NETWORK = (process.env.NETWORK ?? "testnet") as NetworkId;
const MODEL = process.env.MODEL ?? "llama3-8b";
const TASK_PROMPT = process.env.AGENT_TASK ?? "Summarize today's news in 3 bullet points.";

export async function GET(req: Request) {
  // Verify Vercel Cron sent this. Set CRON_SECRET in your Vercel env vars; the
  // platform automatically injects it as the Bearer token on cron-fired requests.
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== \`Bearer \${process.env.CRON_SECRET}\`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.PRIVATE_KEY?.startsWith("0x")) {
    return NextResponse.json({ error: "PRIVATE_KEY not configured" }, { status: 500 });
  }

  const ln = new LightNode(NETWORK);
  const acct = privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`);
  const chain = { id: ln.network.chainId, name: ln.network.label, nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: [ln.network.rpc] } } };
  const publicClient = createPublicClient({ transport: http(ln.network.rpc), chain });
  const wallet = createWalletClient({ account: acct, transport: http(ln.network.rpc), chain });

  // SIWE -> JWT (one handshake per agent run).
  const ch = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/challenge?address=\${acct.address}\`)).json() as { message?: string };
  if (!ch.message) return NextResponse.json({ error: "auth challenge failed" }, { status: 502 });
  const sig = await wallet.signMessage({ message: ch.message });
  const verify = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/verify\`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: ch.message, signature: sig }) })).json() as { token?: string };
  if (!verify.token) return NextResponse.json({ error: "auth verify failed" }, { status: 502 });
  const gateway = new GatewayClient({ network: NETWORK, bearer: verify.token });

  // ---- your agent's logic ------------------------------------------------
  // Replace this block with whatever your scheduled task should do. By default
  // it just runs a single inference call with the AGENT_TASK prompt and stores
  // the result; you might fetch upstream data first, run multiple turns, post
  // results to Slack/Discord/a DB, etc.
  try {
    const result = await runInference({
      prompt: TASK_PROMPT,
      gateway, wallet, publicClient, network: ln.network,
      model: MODEL, WebSocket: WS, maxRetries: 2,
    });
    // TODO: persist result.answer somewhere durable (DB, S3, send to Slack, etc.).
    return NextResponse.json({
      ok: true,
      answer: result.answer,
      txs: result.txs,
      jobId: result.jobId.toString(),
      ranAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
`;

const NEXTJS_AGENT_VERCEL_JSON = `{
  "crons": [
    {
      "path": "/api/agent",
      "schedule": "0 9 * * *"
    }
  ]
}
`;

const NODE_AGENT_SCRIPT = `// agent.ts
// Generated by 'lightnode add agent'. A long-running script that runs inference
// on a fixed cadence. Use it under pm2, systemd, a Docker container - anywhere
// you'd run a daemon.
//   npm install lightnode-sdk viem ws
//   AGENT_INTERVAL_MS=3600000 tsx agent.ts
import WS from "ws";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LightNode, GatewayClient, runInference, consumerGatewayUrl, isStalledWorker, type NetworkId } from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "testnet") as NetworkId;
const MODEL = process.env.MODEL ?? "llama3-8b";
const TASK_PROMPT = process.env.AGENT_TASK ?? "Summarize today's news in 3 bullet points.";
const INTERVAL_MS = Number(process.env.AGENT_INTERVAL_MS ?? 24 * 60 * 60 * 1000); // default daily
const PRIVATE_KEY = process.env.PRIVATE_KEY as \`0x\${string}\` | undefined;
if (!PRIVATE_KEY?.startsWith("0x") || PRIVATE_KEY.length !== 66) { console.error("set PRIVATE_KEY in .env"); process.exit(1); }

const ln = new LightNode(NETWORK);
const acct = privateKeyToAccount(PRIVATE_KEY);
const chain = { id: ln.network.chainId, name: ln.network.label, nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: [ln.network.rpc] } } };
const publicClient = createPublicClient({ transport: http(ln.network.rpc), chain });
const wallet = createWalletClient({ account: acct, transport: http(ln.network.rpc), chain });

// One SIWE handshake per process; refreshed lazily when the JWT expires.
async function freshGateway() {
  const ch = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/challenge?address=\${acct.address}\`)).json() as { message?: string };
  if (!ch.message) throw new Error("auth challenge failed");
  const sig = await wallet.signMessage({ message: ch.message });
  const verify = await (await fetch(\`\${consumerGatewayUrl(NETWORK)}/api/auth/verify\`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: ch.message, signature: sig }) })).json() as { token?: string };
  if (!verify.token) throw new Error("auth verify failed");
  return new GatewayClient({ network: NETWORK, bearer: verify.token });
}

let gateway = await freshGateway();
console.log(\`▶ agent ready on \${NETWORK}, interval=\${(INTERVAL_MS / 1000 / 60).toFixed(1)} min, task=\${TASK_PROMPT.slice(0, 60)}…\\n\`);

async function tick() {
  console.log(\`[\${new Date().toISOString()}] tick\`);
  try {
    const result = await runInference({
      prompt: TASK_PROMPT,
      gateway, wallet, publicClient, network: ln.network,
      model: MODEL, WebSocket: WS, maxRetries: 2,
    });
    // ---- your agent's output sink: write to a DB, post to Slack, etc. ----
    console.log(\`[\${new Date().toISOString()}] answer:\\n\${result.answer}\\n  (createSession=\${result.txs.createSession.slice(0, 14)}…, jobCompleted=\${result.txs.jobCompleted.slice(0, 14)}…)\\n\`);
  } catch (e) {
    if (isStalledWorker(e)) console.error(\`[\${new Date().toISOString()}] all workers stalled this round; protocol refunds, skipping\`);
    else if ((e as Error).message.includes("auth")) { console.warn("JWT expired; re-authing"); gateway = await freshGateway(); }
    else console.error(\`[\${new Date().toISOString()}] tick failed:\`, (e as Error).message);
  }
}

await tick(); // run once immediately
setInterval(tick, INTERVAL_MS);

// Keep alive forever.
process.on("SIGINT", () => { console.log("\\n▶ agent stopped"); process.exit(0); });
`;

export function addAgent(opts: AddOpts = {}): { written: WrittenFile[]; install: string; template: Template; network: Network } {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "testnet";
  const template: Template = opts.template && opts.template !== "auto" ? opts.template : detectTemplate(cwd);
  const force = !!opts.force;
  const written: WrittenFile[] = [];

  if (template === "nextjs-api") {
    written.push(writeFile(path.join(cwd, "app/api/agent/route.ts"), NEXTJS_AGENT_ROUTE, force));
    // Only add vercel.json if there isn't one; merging is too fragile to do
    // blindly here (we'd risk clobbering the user's existing config).
    if (!fs.existsSync(path.join(cwd, "vercel.json"))) {
      written.push(writeFile(path.join(cwd, "vercel.json"), NEXTJS_AGENT_VERCEL_JSON, force));
    }
  } else {
    written.push(writeFile(path.join(cwd, "agent.ts"), NODE_AGENT_SCRIPT, force));
  }
  written.push(writeFile(path.join(cwd, ".env.example"), ENV_EXAMPLE(network), force));

  return { written, install: installLine(template), template, network };
}

export function addChat(opts: AddOpts = {}): { written: WrittenFile[]; install: string; template: Template; network: Network } {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "testnet";
  const template: Template = opts.template && opts.template !== "auto" ? opts.template : detectTemplate(cwd);
  const force = !!opts.force;
  const written: WrittenFile[] = [];

  if (template === "nextjs-api") {
    // 'add chat' is self-contained: it writes the chat page, the streaming
    // inference route, the hosting guide, AND the Docker setup so the dev
    // can run the whole stack locally (or anywhere Docker runs) with one
    // command. No external host signup, no function-timeout fights.
    written.push(writeFile(path.join(cwd, "app/chat/page.tsx"), NEXTJS_CHAT_PAGE, force));
    written.push(writeFile(path.join(cwd, "app/api/inference/route.ts"), NEXTJS_INFERENCE_STREAM_ROUTE, force));
    written.push(writeFile(path.join(cwd, "LIGHTNODE-HOSTING.md"), HOSTING_GUIDE, force));
    written.push(writeFile(path.join(cwd, "Dockerfile"), NEXTJS_DOCKERFILE, force));
    written.push(writeFile(path.join(cwd, "docker-compose.yml"), NEXTJS_DOCKER_COMPOSE, force));
    written.push(writeFile(path.join(cwd, ".dockerignore"), DOCKERIGNORE, force));
  } else {
    written.push(writeFile(path.join(cwd, "chat-repl.ts"), NODE_CHAT_REPL, force));
  }
  written.push(writeFile(path.join(cwd, ".env.example"), ENV_EXAMPLE(network), force));

  return { written, install: installLine(template), template, network };
}

/**
 * `lightnode add chat-web3` - the user-pays counterpart to addChat.
 *
 * Architecture:
 *   - Each visitor's own wallet signs SIWE + createSession per turn.
 *   - The dev's app holds zero funds; cost is borne by each user (0.02 LCAI
 *     per llama3-8b turn on mainnet).
 *   - No backend, no PRIVATE_KEY, no server-side hot wallet.
 *
 * Fit:
 *   - Web3 dApps where users already have a wallet (NFT, meme coin, on-chain
 *     games, LightChallenge-style challenge platforms).
 *   - For SaaS chatbots where users do NOT have a wallet, use `add chat`
 *     instead (dev pays, server-side route).
 */
export function addChatWeb3(opts: AddOpts = {}): {
  written: WrittenFile[];
  install: string;
  template: Template;
  network: Network;
  needsWagmi: boolean;
} {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "mainnet";
  // chat-web3 is browser-only. If the project is not Next.js (or another
  // React framework we'd detect), fall back to nextjs-api anyway and warn
  // the user in the CLI's next-steps that the file expects a Next.js
  // setup with wagmi.
  const detected = detectTemplate(cwd);
  const template: Template = opts.template && opts.template !== "auto" ? opts.template : detected;
  const force = !!opts.force;
  const written: WrittenFile[] = [];

  // Detect whether the project already has wagmi; if not, the next-steps
  // output prints the install line.
  const pkg = readPackageJson(cwd);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const hasWagmi = Boolean(deps["wagmi"]);

  written.push(writeFile(path.join(cwd, "app/chat-web3/page.tsx"), NEXTJS_CHAT_WEB3_PAGE, force));

  return {
    written,
    install: `npm install lightnode-sdk viem` + (hasWagmi ? "" : " wagmi @tanstack/react-query"),
    template,
    network,
    needsWagmi: !hasWagmi,
  };
}

/**
 * `lightnode add inference-web3` - the user-pays counterpart to addInference.
 *
 * Browser-only React component. Each visitor signs SIWE + createSession from
 * their own wallet. No backend, no PRIVATE_KEY, no per-call cost for the dev.
 *
 * Fits any one-shot inference UI: classifier, NFT trait generator, content
 * moderation, evaluator. For multi-turn chat use addChatWeb3; for the
 * dedicated judge pattern use addJudgeWeb3.
 */
export function addInferenceWeb3(opts: AddOpts = {}): {
  written: WrittenFile[]; install: string; template: Template; network: Network; needsWagmi: boolean;
} {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "mainnet";
  const detected = detectTemplate(cwd);
  const template: Template = opts.template && opts.template !== "auto" ? opts.template : detected;
  const force = !!opts.force;
  const written: WrittenFile[] = [];
  const pkg = readPackageJson(cwd);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const hasWagmi = Boolean(deps["wagmi"]);

  written.push(writeFile(path.join(cwd, "app/inference-web3/page.tsx"), NEXTJS_INFERENCE_WEB3_PAGE, force));

  return {
    written,
    install: `npm install lightnode-sdk viem` + (hasWagmi ? "" : " wagmi @tanstack/react-query"),
    template, network, needsWagmi: !hasWagmi,
  };
}

/**
 * `lightnode add judge-web3` - the user-pays counterpart to addJudge.
 *
 * The LightChallenge pattern with the user paying: visitor submits criteria
 * + evidence, signs from their own wallet, the structured pass/fail/confidence
 * verdict comes back with on-chain proof. Fit: challenge completion grading,
 * NFT trait verification, content moderation, automated scoring - any flow
 * where the END USER wants a verifiable AI verdict on their own submission.
 */
export function addJudgeWeb3(opts: AddOpts = {}): {
  written: WrittenFile[]; install: string; template: Template; network: Network; needsWagmi: boolean;
} {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "mainnet";
  const detected = detectTemplate(cwd);
  const template: Template = opts.template && opts.template !== "auto" ? opts.template : detected;
  const force = !!opts.force;
  const written: WrittenFile[] = [];
  const pkg = readPackageJson(cwd);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const hasWagmi = Boolean(deps["wagmi"]);

  written.push(writeFile(path.join(cwd, "app/judge-web3/page.tsx"), NEXTJS_JUDGE_WEB3_PAGE, force));

  return {
    written,
    install: `npm install lightnode-sdk viem` + (hasWagmi ? "" : " wagmi @tanstack/react-query"),
    template, network, needsWagmi: !hasWagmi,
  };
}

const WAGMI_CONFIG_FILE = `// lib/wagmi.ts
// Generated by 'lightnode add wagmi-setup'. Minimal wagmi setup for
// LightChain mainnet (9200) + testnet (8200). Use this as a starting
// point; swap in RainbowKit / Reown AppKit / ConnectKit if you want a
// richer connect UI.
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import type { Chain } from "viem";

export const lightchainMainnet: Chain = {
  id: 9200,
  name: "LightChain",
  nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.lightchain.ai"] } },
  blockExplorers: { default: { name: "Lightscan", url: "https://mainnet.lightscan.app" } },
};

export const lightchainTestnet: Chain = {
  id: 8200,
  name: "LightChain Testnet",
  nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.lightchain.ai"] } },
  blockExplorers: { default: { name: "Lightscan", url: "https://testnet.lightscan.app" } },
};

export const wagmiConfig = createConfig({
  chains: [lightchainMainnet, lightchainTestnet],
  // \`injected\` covers MetaMask, Rabby, OKX, Phantom EVM, and any browser
  // wallet that follows EIP-1193. Add walletConnect() / coinbaseWallet()
  // here if you want explicit support for those.
  connectors: [injected()],
  transports: {
    [lightchainMainnet.id]: http(),
    [lightchainTestnet.id]: http(),
  },
});
`;

const WAGMI_PROVIDERS_FILE = `// app/providers.tsx
// Generated by 'lightnode add wagmi-setup'. Wraps the app with the
// wagmi + react-query providers needed for any wagmi hook to work.
//
// Import this from your root layout:
//
//   // app/layout.tsx
//   import { Providers } from "./providers";
//   export default function RootLayout({ children }: { children: React.ReactNode }) {
//     return (
//       <html lang="en">
//         <body><Providers>{children}</Providers></body>
//       </html>
//     );
//   }
"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import type { ReactNode } from "react";

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
`;

const WAGMI_CONNECT_BUTTON = `// components/connect-button.tsx
// Generated by 'lightnode add wagmi-setup'. Minimal Connect/Disconnect
// button using wagmi's useConnect / useAccount hooks. Swap in
// RainbowKit's ConnectButton or Reown's <w3m-button /> for a richer UI.
"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

const LIGHTCHAIN_IDS = new Set<number>([9200, 8200]);

function shortAddress(addr: string): string {
  return \`\${addr.slice(0, 6)}...\${addr.slice(-4)}\`;
}

export function ConnectButton() {
  const { address, chain, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  if (!isConnected) {
    const connector = connectors[0];
    return (
      <button
        type="button"
        onClick={() => connect({ connector })}
        disabled={isPending}
        style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer" }}
      >
        {isPending ? "Connecting..." : "Connect wallet"}
      </button>
    );
  }

  if (chain && !LIGHTCHAIN_IDS.has(chain.id)) {
    return (
      <button
        type="button"
        onClick={() => switchChain({ chainId: 9200 })}
        disabled={switching}
        style={{ padding: "8px 16px", borderRadius: 8, background: "#fee", cursor: "pointer" }}
      >
        {switching ? "Switching..." : "Switch to LightChain"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => disconnect()}
      style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontFamily: "monospace" }}
    >
      {address ? shortAddress(address) : "(unknown)"} ({chain?.name}) - disconnect
    </button>
  );
}
`;

export function addWagmiSetup(opts: AddOpts = {}): { written: WrittenFile[]; install: string; template: Template; network: Network } {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "mainnet";
  const template: Template = opts.template && opts.template !== "auto" ? opts.template : detectTemplate(cwd);
  const force = !!opts.force;
  const written: WrittenFile[] = [];

  written.push(writeFile(path.join(cwd, "lib/wagmi.ts"), WAGMI_CONFIG_FILE, force));
  written.push(writeFile(path.join(cwd, "app/providers.tsx"), WAGMI_PROVIDERS_FILE, force));
  written.push(writeFile(path.join(cwd, "components/connect-button.tsx"), WAGMI_CONNECT_BUTTON, force));

  return {
    written,
    install: `npm install wagmi viem @tanstack/react-query`,
    template,
    network,
  };
}

// ---------------------------------------------------------------------------
// Auto-wire app/layout.tsx so wagmi's <Providers> wraps the tree. Without this
// step every wagmi hook throws "must be used within WagmiProvider" and the
// generated -web3 pages render blank. Idempotent: a layout already wrapped
// with <Providers> is left untouched.
// ---------------------------------------------------------------------------

export interface LayoutPatch {
  path: string;
  patched: boolean;
  reason?: string;
}

function findLayoutFile(cwd: string): string | null {
  const candidates = ["app/layout.tsx", "app/layout.jsx", "src/app/layout.tsx", "src/app/layout.jsx"];
  for (const rel of candidates) {
    const abs = path.join(cwd, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function withProvidersImport(source: string): string {
  if (/from\s+["']\.\/providers["']/.test(source)) return source;
  const importLine = `import { Providers } from "./providers";`;
  const lines = source.split("\n");
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s/.test(lines[i])) lastImport = i;
  }
  if (lastImport === -1) return `${importLine}\n${source}`;
  return [...lines.slice(0, lastImport + 1), importLine, ...lines.slice(lastImport + 1)].join("\n");
}

function withWrappedChildren(source: string): string | null {
  if (/<Providers>/.test(source)) return source;
  if (!source.includes("{children}")) return null;
  return source.replace("{children}", "<Providers>{children}</Providers>");
}

/**
 * Patch the project's root layout to import and wrap children in <Providers>.
 * Returns what happened so the CLI can report it; never throws.
 */
export function patchLayoutWithProviders(cwd: string = process.cwd()): LayoutPatch {
  const abs = findLayoutFile(cwd);
  if (!abs) return { path: "app/layout.tsx", patched: false, reason: "no layout file found" };
  const rel = path.relative(cwd, abs) || abs;

  let source: string;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch (e) {
    return { path: rel, patched: false, reason: `could not read layout (${(e as Error).message})` };
  }

  if (/<Providers>/.test(source) && /from\s+["']\.\/providers["']/.test(source)) {
    return { path: rel, patched: false, reason: "already wrapped with <Providers>" };
  }

  const wrapped = withWrappedChildren(withProvidersImport(source));
  if (wrapped === null) {
    return { path: rel, patched: false, reason: "no {children} found - wrap with <Providers> manually" };
  }

  try {
    fs.writeFileSync(abs, wrapped);
  } catch (e) {
    return { path: rel, patched: false, reason: `could not write layout (${(e as Error).message})` };
  }
  return { path: rel, patched: true };
}

const NEXTJS_JUDGE_ROUTE = `// app/api/judge/route.ts
// Generated by 'lightnode add judge'. See https://lightnode.app/build
// The LightChallenge-style evaluator: post evidence + criteria, get a
// pass/fail verdict + confidence + reason, plus an on-chain receipt
// (submitJob + jobCompleted tx) anyone can verify.
import { NextResponse } from "next/server";
import { runInferenceWithKey } from "lightnode-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NETWORK = (process.env.NETWORK ?? "testnet") as "mainnet" | "testnet";
const MODEL = process.env.MODEL ?? "llama3-8b";

interface JudgeRequest {
  criteria: string;     // what the user has to satisfy
  evidence: unknown;    // anything serialisable (the proof to grade)
  // Optional: extend the rubric the model uses. Defaults to passed/confidence/reason.
  schema?: string;
}

interface Verdict {
  passed: boolean;
  confidence: number;
  reason: string;
}

const DEFAULT_SCHEMA = '{ "passed": boolean, "confidence": 0-1, "reason": string }';

export async function POST(req: Request) {
  if (!process.env.PRIVATE_KEY?.startsWith("0x")) {
    return NextResponse.json({ error: "PRIVATE_KEY not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<JudgeRequest>;
  if (!body.criteria?.trim()) return NextResponse.json({ error: "criteria is required" }, { status: 400 });
  if (body.evidence === undefined) return NextResponse.json({ error: "evidence is required" }, { status: 400 });

  const schema = body.schema?.trim() || DEFAULT_SCHEMA;
  const prompt = \`Criteria: \${body.criteria.trim()}

Evidence: \${JSON.stringify(body.evidence)}

Reply with STRICT JSON only, matching: \${schema}\`;

  try {
    const { answer, worker, txs, jobId } = await runInferenceWithKey({
      network: NETWORK,
      privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
      model: MODEL,
      system: "You are a careful judge. Reply with STRICT JSON only, no prose.",
      prompt,
    });
    // Parse the verdict defensively. If the model adds prose, extract the
    // first {...} block. Surface the raw answer either way so callers can
    // audit when the parser falls back.
    let verdict: Verdict | null = null;
    try {
      verdict = JSON.parse(answer) as Verdict;
    } catch {
      const m = answer.match(/\{[\s\\S]*\}/);
      if (m) {
        try { verdict = JSON.parse(m[0]) as Verdict; } catch { /* keep null */ }
      }
    }
    return NextResponse.json({
      verdict,
      raw: answer,
      worker,
      jobId: jobId.toString(),
      txs: {
        createSession: txs.createSession,
        submitJob: txs.submitJob,
        jobCompleted: txs.jobCompleted,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
`;

const NODE_JUDGE_SCRIPT = `// judge.ts
// Generated by 'lightnode add judge'. Run with: tsx judge.ts '<criteria>' '<evidence>'
// Example:
//   tsx judge.ts 'Run a mile under 8 minutes' '{"distance_km":1.61,"time_minutes":7.4}'
import { runInferenceWithKey, LightNode } from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "testnet") as "mainnet" | "testnet";
const MODEL = process.env.MODEL ?? "llama3-8b";
const PRIVATE_KEY = process.env.PRIVATE_KEY as \`0x\${string}\` | undefined;
if (!PRIVATE_KEY) { console.error("PRIVATE_KEY not set. Put one in .env (testnet faucet: https://lightfaucet.ai)"); process.exit(1); }
const KEY = PRIVATE_KEY as \`0x\${string}\`;

const [criteria, evidenceJson] = process.argv.slice(2);
if (!criteria || !evidenceJson) {
  console.error("usage: tsx judge.ts '<criteria>' '<evidence-json>'");
  process.exit(2);
}
const evidence = JSON.parse(evidenceJson);

const ln = new LightNode(NETWORK);
const { answer, worker, txs, jobId } = await runInferenceWithKey({
  network: NETWORK,
  privateKey: KEY,
  model: MODEL,
  system: "You are a careful judge. Reply with STRICT JSON only, no prose.",
  prompt: \`Criteria: \${criteria}

Evidence: \${JSON.stringify(evidence)}

Reply with STRICT JSON only: { "passed": boolean, "confidence": 0-1, "reason": string }\`,
});

console.log("\\nraw answer  :", answer);
let verdict: { passed: boolean; confidence: number; reason: string } | null = null;
try { verdict = JSON.parse(answer); } catch {
  const m = answer.match(/\\\{[\\\s\\S]*\\\}/);
  if (m) { try { verdict = JSON.parse(m[0]); } catch { /* keep null */ } }
}
console.log("verdict     :", verdict);
console.log("job id      :", jobId.toString());
console.log("worker      :", worker);
console.log("submitJob tx:", ln.explorerTxUrl(txs.submitJob));
if (txs.jobCompleted) console.log("completed tx:", ln.explorerTxUrl(txs.jobCompleted));
`;

export function addJudge(opts: AddOpts = {}): { written: WrittenFile[]; install: string; template: Template; network: Network } {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "testnet";
  const template: Template = opts.template && opts.template !== "auto" ? opts.template : detectTemplate(cwd);
  const force = !!opts.force;
  const written: WrittenFile[] = [];

  if (template === "nextjs-api") {
    written.push(writeFile(path.join(cwd, "app/api/judge/route.ts"), NEXTJS_JUDGE_ROUTE, force));
    written.push(writeFile(path.join(cwd, "LIGHTNODE-HOSTING.md"), HOSTING_GUIDE, force));
    written.push(writeFile(path.join(cwd, "Dockerfile"), NEXTJS_DOCKERFILE, force));
    written.push(writeFile(path.join(cwd, "docker-compose.yml"), NEXTJS_DOCKER_COMPOSE, force));
    written.push(writeFile(path.join(cwd, ".dockerignore"), DOCKERIGNORE, force));
  } else {
    written.push(writeFile(path.join(cwd, "judge.ts"), NODE_JUDGE_SCRIPT, force));
  }
  written.push(writeFile(path.join(cwd, ".env.example"), ENV_EXAMPLE(network), force));

  return { written, install: installLine(template), template, network };
}

export function addNftMint(opts: AddOpts = {}): { written: WrittenFile[]; install: string; template: Template; network: Network } {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "testnet";
  const template: Template = opts.template && opts.template !== "auto" ? opts.template : detectTemplate(cwd);
  const force = !!opts.force;
  const written: WrittenFile[] = [];

  if (template === "nextjs-api") {
    written.push(writeFile(path.join(cwd, "app/api/nft-metadata/route.ts"), NEXTJS_NFT_METADATA_ROUTE, force));
    written.push(writeFile(path.join(cwd, "app/nft-mint/page.tsx"), NEXTJS_NFT_MINT_CLIENT, force));
  } else {
    written.push(writeFile(path.join(cwd, "nft-metadata.ts"), NODE_NFT_METADATA_SCRIPT, force));
  }
  written.push(writeFile(path.join(cwd, ".env.example"), ENV_EXAMPLE(network), force));

  return {
    written,
    install: installLine(template),
    template,
    network,
  };
}
