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

// Default grounding sent ahead of every turn. The underlying models (llama3)
// have no training knowledge of this specific project, so without grounding a
// small model confidently invents details (e.g. "Lightchain is a Litecoin
// fork" or "an IoT blockchain"). This identity + anti-hallucination prompt
// stops the worst drift; edit it to add your real facts. The SDK does NOT have
// a separate `system` channel - this text is prepended to the prompt itself.
const CHAT_SYSTEM_PROMPT = `You are a helpful, general-purpose AI assistant. Answer whatever the user asks - recipes, code, math, writing, general knowledge, anything - exactly like a normal assistant. Never refuse a request just because it is not about Lightchain.

You happen to run on Lightchain AI, so you also know these facts for the specific case where someone asks about the project itself: Lightchain AI is a decentralized AI inference network where open models (such as llama3-8b and llama3-70b) run across independent worker nodes, and every request is paid for on-chain with the network's native token, LCAI. When the user asks about "Lightchain", "LightChain", or "Lightchain AI", that is what they mean - it is NOT Litecoin and NOT an IoT blockchain. Do not bring this up unless asked.

If you are unsure of a specific fact, say so rather than inventing it. Keep answers clear and concise.`;

const NEXTJS_CHAT_PAGE = `// app/chat/page.tsx
// Generated by 'lightnode add chat'. Server-paid: your funded PRIVATE_KEY (in
// .env) pays each turn; the streaming /api/inference route runs the inference.
"use client";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { LcaiMark } from "@/components/lcai-mark";

type Turn = { role: "user" | "assistant"; text: string; streaming?: boolean; jobCompleted?: string };

export default function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth", block: "nearest" });
  }, [turns, busy]);

  async function send() {
    const next = draft.trim();
    if (!next || busy) return;
    setBusy(true);
    setErr(null);
    const history: Turn[] = [...turns, { role: "user", text: next }];
    setTurns([...history, { role: "assistant", text: "", streaming: true }]);
    setDraft("");
    const patch = (p: Partial<Turn>) =>
      setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, ...p } : t)));
    try {
      const prompt = history.map((t) => (t.role === "user" ? "User: " : "Assistant: ") + t.text).join("\\n") + "\\nAssistant:";
      const r = await fetch("/api/inference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, stream: true }),
      });
      if (!r.ok || !r.body) {
        const raw = await r.text().catch(() => "");
        if (/PRIVATE_KEY/i.test(raw)) throw new Error("No PRIVATE_KEY yet. Put a funded mainnet key in .env, then restart 'npm run dev'.");
        throw new Error("route returned " + r.status + (raw ? ": " + raw.slice(0, 160) : ""));
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let assembled = "";
      let jobCompleted: string | undefined;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        // The route appends one JSON line of metadata after a NUL delimiter.
        const nulIdx = text.indexOf("\\u0000");
        if (nulIdx === -1) {
          assembled += text;
          patch({ text: assembled });
        } else {
          assembled += text.slice(0, nulIdx);
          try { jobCompleted = (JSON.parse(text.slice(nulIdx + 1)) as { jobCompleted?: string }).jobCompleted; } catch { /* ignore */ }
          patch({ text: assembled, jobCompleted });
        }
      }
      patch({ streaming: false, jobCompleted });
    } catch (e) {
      setTurns(history); // drop the empty assistant bubble; show the error below
      setDraft(next);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-6">
      <header className="border-b border-border pb-4">
        <h1 className="font-semibold text-foreground">Chat</h1>
        <p className="text-xs text-muted-foreground">Server-paid - your funded wallet covers each turn (~0.02 LCAI on mainnet, free on testnet).</p>
      </header>

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto py-6">
        {turns.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <LcaiMark className="size-12" />
            <h2 className="text-3xl font-medium tracking-tight text-foreground">
              Start talking with <span className="text-gradient">AI Chat</span>
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Your server signs each turn with the PRIVATE_KEY in .env, so visitors never need a wallet.
            </p>
          </div>
        ) : (
          turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-surface-base-faint px-4 py-2.5 text-sm text-foreground">
                  {t.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <LcaiMark className="mt-0.5 size-7 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {t.text ? (
                    t.streaming ? (
                      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{t.text}</div>
                    ) : (
                      <div className="max-w-none text-sm leading-relaxed text-foreground [&_*:first-child]:mt-0 [&_*:last-child]:mb-0">
                        <Streamdown>{t.text}</Streamdown>
                      </div>
                    )
                  ) : (
                    <div className="animate-pulse-dot pt-1 text-sm text-muted-foreground">Thinking...</div>
                  )}
                  {t.jobCompleted ? (
                    <div className="text-[11px] text-muted-foreground">committed on-chain · <code className="font-mono">{t.jobCompleted.slice(0, 12)}…</code></div>
                  ) : null}
                </div>
              </div>
            )
          )
        )}
        <div ref={endRef} />
      </div>

      {err ? (
        <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="flex items-start gap-2">
          <LcaiMark className="mt-2 size-5 shrink-0" />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="Send a message..."
            className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => send()}
            disabled={busy || !draft.trim()}
            className="flex size-9 items-center justify-center rounded-full bg-gradient-primary text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-none disabled:bg-muted disabled:text-muted-foreground"
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Each call is signed server-side with the PRIVATE_KEY in <code className="font-mono">.env</code>. See <code className="font-mono">LIGHTNODE-HOSTING.md</code> for a host that handles 60-90s calls.
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

// Grounding prepended to every turn so the model stops guessing what this
// project is. Edit it to add your real facts. (The SDK has no separate
// 'system' channel, so we fold it into the prompt below.)
const DEFAULT_SYSTEM = ${JSON.stringify(CHAT_SYSTEM_PROMPT)};

export async function POST(req: Request) {
  if (!process.env.PRIVATE_KEY?.startsWith("0x")) {
    return NextResponse.json({ error: "PRIVATE_KEY not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { prompt?: string; system?: string; stream?: boolean };
  const userPrompt = body.prompt?.trim();
  if (!userPrompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  // The SDK encrypts only the prompt - there is no separate 'system' channel -
  // so fold the grounding (or a caller override) into the front of the prompt.
  const system = body.system?.trim() || DEFAULT_SYSTEM;
  const prompt = system ? \`\${system}\\n\\n\${userPrompt}\` : userPrompt;

  const args = {
    network: NETWORK,
    privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
    model: MODEL,
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

import { useEffect, useRef, useState } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { siweSignIn, GatewayClient, LightChatSession, estimateJobFee, modelId, NETWORKS } from "lightnode-sdk";
import { Streamdown } from "streamdown";
import { ConnectButton } from "@/components/connect-button";
import { LcaiMark } from "@/components/lcai-mark";

type Turn = {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  worker?: string | null;
  jobId?: string | null;
  submitTx?: \`0x\${string}\` | null;
  jobCompletedTx?: \`0x\${string}\` | null;
  sources?: { position: number; title: string; url: string; description: string }[];
};

// Models live on LightChain mainnet. The visitor picks one per the dropdown.
const MODELS = ["llama3-8b", "llama3-70b"] as const;
type ModelId = (typeof MODELS)[number];

// Grounding prepended to every turn. The models have no training knowledge of
// this specific project, so without it a small model invents details (e.g.
// "Lightchain is a Litecoin fork"). Edit this to add your real facts.
const CHAT_SYSTEM_PROMPT = ${JSON.stringify(CHAT_SYSTEM_PROMPT)};

export default function ChatWeb3() {
  const { address, chain } = useAccount();
  const network: "mainnet" | "testnet" | null =
    chain?.id === 9200 ? "mainnet" : chain?.id === 8200 ? "testnet" : null;
  const { data: walletClient } = useWalletClient({ chainId: chain?.id });
  const publicClient = usePublicClient({ chainId: chain?.id });

  const [model, setModel] = useState<ModelId>("llama3-8b");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [feeLcai, setFeeLcai] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Reused across turns so follow-ups skip SIWE + createSession.
  const sessionRef = useRef<LightChatSession | null>(null);
  const sessionKeyRef = useRef<string>("");
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [searchCapable, setSearchCapable] = useState(false);
  const searchEnabledRef = useRef(false);
  searchEnabledRef.current = searchEnabled && searchCapable;

  // Read the on-chain fee for the connected network so we can show the
  // visitor the real cost per turn before they click Send.
  useEffect(() => {
    if (!network) { setFeeLcai(null); return; }
    let cancelled = false;
    estimateJobFee(NETWORKS[network], model).then(
      (fee) => { if (!cancelled) setFeeLcai(fee); },
      () => { if (!cancelled) setFeeLcai(null); },
    );
    return () => { cancelled = true; };
  }, [network, model]);

  // Gate the Web Search toggle on the model advertising the "search" capability.
  // (On networks where the capabilities endpoint isn't deployed this 404s and the
  // toggle stays locked - the honest state until a search-capable worker is up.)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const gw = new GatewayClient({ network: network ?? "mainnet" });
        const caps = await gw.getModelCapabilities(modelId(model));
        if (!cancelled) setSearchCapable(Array.isArray(caps?.capabilities) && caps.capabilities.includes("search"));
      } catch {
        if (!cancelled) setSearchCapable(false);
      }
    })();
    return () => { cancelled = true; };
  }, [network, model]);

  // Keep the latest turn in view. Instant while streaming (smooth scrolling on
  // every chunk competes for the main thread); smooth once idle.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth", block: "nearest" });
  }, [turns, busy]);

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

  /** Patch the trailing assistant turn (the streaming placeholder) in place. */
  function patchLastAssistant(patch: Partial<Turn>) {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), { ...last, ...patch }];
    });
  }

  /**
   * Open a session on the first turn (or after expiry / a model or wallet
   * change), then reuse it so every follow-up turn skips SIWE + createSession.
   */
  async function ensureSession(): Promise<LightChatSession> {
    if (!walletClient || !publicClient || !address || !network) throw new Error("connect a wallet first");
    // A search session must bind to a search-capable worker, so it keys separately.
    const wantSearch = searchEnabledRef.current;
    const key = \`\${address}:\${network}:\${model}:\${wantSearch}\`;
    const existing = sessionRef.current;
    if (existing && !existing.expired && sessionKeyRef.current === key) return existing;
    setBusyStage("Sign in with your wallet (SIWE)...");
    const siwe = await siweSignIn(walletClient as unknown as Parameters<typeof siweSignIn>[0], network);
    setBusyStage("Approve createSession in your wallet (one-time per session)...");
    const gateway = new GatewayClient({ network, bearer: siwe.bearer });
    const chat = await LightChatSession.open({
      gateway,
      wallet: walletClient as unknown as Parameters<typeof LightChatSession.open>[0]["wallet"],
      publicClient: publicClient as unknown as Parameters<typeof LightChatSession.open>[0]["publicClient"],
      network: NETWORKS[network],
      model,
      ...(wantSearch ? { requiredCapabilities: ["search"] } : {}),
    });
    sessionRef.current = chat;
    sessionKeyRef.current = key;
    return chat;
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
    // Optimistic user bubble + an empty assistant turn we stream tokens into.
    setTurns([...history, { role: "user", text: next }, { role: "assistant", text: "", streaming: true }]);
    setInput("");
    try {
      const prompt = composePrompt(history, next, CHAT_SYSTEM_PROMPT);
      const onChunk = (_chunk: string, totalSoFar: string) => {
        setBusyStage("");
        patchLastAssistant({ text: totalSoFar });
      };
      const onStage = (s: string) => setBusyStage(s);
      const sendOpts = { onChunk, onStage, searchEnabled: searchEnabledRef.current };

      const chat = await ensureSession();
      const result = await chat.send(prompt, sendOpts).catch(async () => {
        // Session expired or the worker stopped serving - reopen once and retry.
        sessionRef.current = null;
        patchLastAssistant({ text: "" });
        setBusyStage("Re-opening session...");
        const fresh = await ensureSession();
        return fresh.send(prompt, sendOpts);
      });

      patchLastAssistant({
        text: result.answer,
        streaming: false,
        worker: result.worker,
        jobId: result.jobId?.toString() ?? null,
        submitTx: result.txs?.submitJob ?? null,
        jobCompletedTx: result.txs?.jobCompleted ?? null,
        sources: result.sources,
      });
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
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-6">
      <header className="flex items-center justify-between gap-3 pb-6">
        <div className="min-w-0">
          <h1 className="font-semibold text-foreground">Chat</h1>
          <p className="truncate text-xs text-muted-foreground">
            {network ? (
              <>Signed from your wallet on {network} · {feeLcai != null ? feeLcai + " LCAI" : "..."}/turn + gas</>
            ) : (
              "Connect a wallet on LightChain to start"
            )}
          </p>
        </div>
        <ConnectButton />
      </header>

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto pb-6">
        {turns.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <LcaiMark className="size-12" />
            <h2 className="text-3xl font-medium tracking-tight text-foreground">
              Start talking with <span className="text-gradient">AI Chat</span>
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Connect your wallet and send a message. Each turn is signed and paid from your
              own wallet, no backend required.
            </p>
            {!address && (
              <div className="mt-2">
                <ConnectButton />
              </div>
            )}
          </div>
        ) : (
          turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-surface-base-faint px-4 py-2.5 text-sm text-foreground">
                  {t.text}
                </div>
              </div>
            ) : (
              <div key={i} className="group flex gap-3">
                <LcaiMark className="mt-0.5 size-7 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {t.text ? (
                    t.streaming ? (
                      // While streaming, render plain text (cheap) - markdown is
                      // parsed once when the turn finalizes, below.
                      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{t.text}</div>
                    ) : (
                      <div className="max-w-none text-sm leading-relaxed text-foreground [&_*:first-child]:mt-0 [&_*:last-child]:mb-0">
                        <Streamdown>{t.text}</Streamdown>
                      </div>
                    )
                  ) : (
                    <div className="animate-pulse-dot pt-1 text-sm text-muted-foreground">
                      {busyStage || "Thinking..."}
                    </div>
                  )}
                  {t.sources && t.sources.length > 0 && (
                    <div className="mt-1 border-t border-border pt-3">
                      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sources</div>
                      <div className="grid gap-2">
                        {t.sources.map((s) => (
                          <a key={s.position + "-" + s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="grid grid-cols-[1.5rem_1fr] gap-2 rounded-lg bg-surface-base-faint px-2.5 py-2 transition-colors hover:bg-card">
                            <span className="flex size-5 items-center justify-center rounded-md bg-card text-[11px] font-medium text-muted-foreground">{s.position}</span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground hover:underline">{s.title || s.url}</span>
                              <span className="block truncate text-xs text-muted-foreground">{s.description || s.url}</span>
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {t.submitTx && (
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(t.text)}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        aria-label="Copy"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Copy
                      </button>
                      {t.worker && (
                        <a className="hover:text-foreground hover:underline" href={\`https://\${network}.lightscan.app/address/\${t.worker}\`} target="_blank" rel="noopener noreferrer">worker</a>
                      )}
                      {t.jobId && <span>job #{t.jobId}</span>}
                      {t.submitTx && (
                        <a className="hover:text-foreground hover:underline" href={\`https://\${network}.lightscan.app/tx/\${t.submitTx}\`} target="_blank" rel="noopener noreferrer">submitJob</a>
                      )}
                      {t.jobCompletedTx && (
                        <a className="hover:text-foreground hover:underline" href={\`https://\${network}.lightscan.app/tx/\${t.jobCompletedTx}\`} target="_blank" rel="noopener noreferrer">completed</a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          )
        )}
        <div ref={endRef} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="flex items-start gap-2">
          <LcaiMark className="mt-2 size-5 shrink-0" />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!busy && input.trim()) send(); }
            }}
            rows={1}
            placeholder="Send a message..."
            className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as ModelId)}
              disabled={busy}
              title="Model (both live on LightChain mainnet)"
              className="cursor-pointer rounded-lg bg-muted-foreground/10 px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted-foreground/15 focus:ring-1 focus:ring-primary disabled:opacity-50"
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <div
              className="flex items-center gap-2"
              title={searchCapable ? "Let the worker search the web for this turn" : "No web-search-capable worker is online for this model right now."}
            >
              <button
                type="button"
                role="switch"
                aria-checked={searchEnabled && searchCapable}
                disabled={!searchCapable || busy}
                onClick={() => setSearchEnabled((v) => !v)}
                className={"relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 " + (searchEnabled && searchCapable ? "bg-primary" : "bg-muted-foreground/30")}
              >
                <span className={"inline-block size-4 rounded-full bg-white shadow transition-transform " + (searchEnabled && searchCapable ? "translate-x-4" : "translate-x-0.5")} />
              </button>
              <span className="text-xs text-muted-foreground">Web Search</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => send()}
            disabled={busy || !input.trim() || !address || !network}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-primary text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-none disabled:bg-muted disabled:text-muted-foreground"
            aria-label={busy ? "Working" : "Send"}
          >
            {busy ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            )}
          </button>
        </div>
        {err && (
          <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </p>
        )}
      </div>
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
import { Streamdown } from "streamdown";
import { ConnectButton } from "@/components/connect-button";
import { LcaiMark } from "@/components/lcai-mark";

type Result = {
  answer: string;
  worker: \`0x\${string}\`;
  jobId: string;
  submitJob: \`0x\${string}\`;
  jobCompleted: \`0x\${string}\` | null;
  elapsedMs: number;
};

const MODELS = ["llama3-8b", "llama3-70b"] as const;
type ModelId = (typeof MODELS)[number];

export default function InferenceWeb3() {
  const { address, chain } = useAccount();
  const network: "mainnet" | "testnet" | null =
    chain?.id === 9200 ? "mainnet" : chain?.id === 8200 ? "testnet" : null;
  const { data: walletClient } = useWalletClient({ chainId: chain?.id });
  const publicClient = usePublicClient({ chainId: chain?.id });

  const [model, setModel] = useState<ModelId>("llama3-8b");
  const [system, setSystem] = useState("You are a concise assistant. Reply in one or two short sentences.");
  const [prompt, setPrompt] = useState("Reply with the single word OK.");
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [stream, setStream] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [feeLcai, setFeeLcai] = useState<number | null>(null);

  useEffect(() => {
    if (!network) { setFeeLcai(null); return; }
    let cancelled = false;
    estimateJobFee(NETWORKS[network], model).then(
      (fee) => { if (!cancelled) setFeeLcai(fee); },
      () => { if (!cancelled) setFeeLcai(null); },
    );
    return () => { cancelled = true; };
  }, [network, model]);

  async function run() {
    if (!walletClient || !publicClient || !address || !network) {
      setErr("Connect a wallet on LightChain mainnet (9200) or testnet (8200) first.");
      return;
    }
    if (!prompt.trim()) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    setStream("");
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
        model,
        jobCompletedTimeoutMs: 120_000,
        maxRetries: 1,
        // Stream the answer live as decrypted chunks arrive.
        onChunk: (_chunk, totalSoFar) => { setBusyStage(""); setStream(totalSoFar); },
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
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-6">
      <header className="flex items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">Inference</h1>
          <p className="truncate text-xs text-muted-foreground">
            {network ? (
              <>Signed from your wallet on {network} · {feeLcai != null ? feeLcai + " LCAI" : "..."}/call + gas</>
            ) : (
              "Connect a wallet on LightChain to start"
            )}
          </p>
        </div>
        <ConnectButton />
      </header>

      <div className="flex flex-col gap-4 py-6">
        {!address && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            <span>Connect a wallet to run inference.</span>
            <ConnectButton />
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">System prompt</span>
          <textarea value={system} onChange={(e) => setSystem(e.target.value)} rows={2}
            className="resize-none rounded-xl border border-border bg-card px-3 py-2 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-primary" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Prompt</span>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5}
            className="resize-none rounded-xl border border-border bg-card px-3 py-2 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-primary" />
        </label>

        <div className="flex items-center gap-3">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as ModelId)}
            disabled={busy}
            title="Model (both live on LightChain mainnet)"
            className="rounded-xl border border-border bg-card px-2 py-2 text-xs font-medium text-muted-foreground outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button type="button" onClick={() => run()} disabled={busy || !prompt.trim() || !address || !network}
            className="rounded-xl bg-gradient-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? (busyStage || "Running...") : "Run inference"}
          </button>
        </div>

        {err && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </p>
        )}

        {(busy || result) && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex gap-3">
              <LcaiMark className="mt-0.5 size-7 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {result ? (
                  <div className="max-w-none text-sm leading-relaxed text-foreground [&_*:first-child]:mt-0 [&_*:last-child]:mb-0">
                    <Streamdown>{result.answer}</Streamdown>
                  </div>
                ) : stream ? (
                  // Plain text while streaming; markdown is parsed once on completion.
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{stream}</div>
                ) : (
                  <div className="animate-pulse-dot pt-1 text-sm text-muted-foreground">
                    {busyStage || "Writing on chain..."}
                  </div>
                )}
                {result && (
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>elapsed {Math.round(result.elapsedMs / 1000)}s</span>
                    <span>job #{result.jobId}</span>
                    <a className="hover:text-foreground hover:underline" href={\`https://\${network}.lightscan.app/address/\${result.worker}\`} target="_blank" rel="noopener noreferrer">worker</a>
                    <a className="hover:text-foreground hover:underline" href={\`https://\${network}.lightscan.app/tx/\${result.submitJob}\`} target="_blank" rel="noopener noreferrer">submitJob</a>
                    {result.jobCompleted && (
                      <a className="hover:text-foreground hover:underline" href={\`https://\${network}.lightscan.app/tx/\${result.jobCompleted}\`} target="_blank" rel="noopener noreferrer">jobCompleted</a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
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
import { Streamdown } from "streamdown";
import { ConnectButton } from "@/components/connect-button";
import { LcaiMark } from "@/components/lcai-mark";

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

const MODELS = ["llama3-8b", "llama3-70b"] as const;
type ModelId = (typeof MODELS)[number];

export default function JudgeWeb3() {
  const { address, chain } = useAccount();
  const network: "mainnet" | "testnet" | null =
    chain?.id === 9200 ? "mainnet" : chain?.id === 8200 ? "testnet" : null;
  const { data: walletClient } = useWalletClient({ chainId: chain?.id });
  const publicClient = usePublicClient({ chainId: chain?.id });

  const [model, setModel] = useState<ModelId>("llama3-8b");
  const [criteria, setCriteria] = useState("Run a mile under 8 minutes");
  const [evidence, setEvidence] = useState('{"distance_km": 1.61, "time_minutes": 7.4}');
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [stream, setStream] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [feeLcai, setFeeLcai] = useState<number | null>(null);

  useEffect(() => {
    if (!network) { setFeeLcai(null); return; }
    let cancelled = false;
    estimateJobFee(NETWORKS[network], model).then(
      (fee) => { if (!cancelled) setFeeLcai(fee); },
      () => { if (!cancelled) setFeeLcai(null); },
    );
    return () => { cancelled = true; };
  }, [network, model]);

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
    setStream("");
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
        model,
        jobCompletedTimeoutMs: 120_000,
        maxRetries: 1,
        // Show the model's raw output streaming in while it generates the verdict.
        onChunk: (_chunk, totalSoFar) => { setBusyStage(""); setStream(totalSoFar); },
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
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-6">
      <header className="flex items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">AI Judge</h1>
          <p className="truncate text-xs text-muted-foreground">
            {network ? (
              <>Signed from your wallet on {network} · {feeLcai != null ? feeLcai + " LCAI" : "..."} + gas · verdict has on-chain proof</>
            ) : (
              "Connect a wallet on LightChain to start"
            )}
          </p>
        </div>
        <ConnectButton />
      </header>

      <div className="flex flex-col gap-4 py-6">
        {!address && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            <span>Connect a wallet to submit.</span>
            <ConnectButton />
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Criteria</span>
          <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={2}
            className="resize-none rounded-xl border border-border bg-card px-3 py-2 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-primary" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Evidence (JSON)</span>
          <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={5}
            className="resize-none rounded-xl border border-border bg-card px-3 py-2 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-primary" />
        </label>

        <div className="flex items-center gap-3">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as ModelId)}
            disabled={busy}
            title="Model (both live on LightChain mainnet)"
            className="rounded-xl border border-border bg-card px-2 py-2 text-xs font-medium text-muted-foreground outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button type="button" onClick={() => run()} disabled={busy || !criteria.trim() || !evidence.trim() || !address || !network}
            className="rounded-xl bg-gradient-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? (busyStage || "Judging...") : "Get AI verdict"}
          </button>
        </div>

        {err && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </p>
        )}

        {(busy || result) && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex gap-3">
              <LcaiMark className="mt-0.5 size-7 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {result ? (
                  result.verdict ? (
                    <div>
                      <div className={"flex items-baseline gap-3 text-2xl font-semibold " + (result.verdict.passed ? "text-success" : "text-destructive")}>
                        {result.verdict.passed ? "PASSED" : "FAILED"}
                        <span className="text-sm font-normal text-muted-foreground">
                          confidence {Math.round(result.verdict.confidence * 100)}%
                        </span>
                      </div>
                      <div className="mt-2 max-w-none text-sm leading-relaxed text-foreground [&_*:first-child]:mt-0 [&_*:last-child]:mb-0">
                        <Streamdown>{result.verdict.reason}</Streamdown>
                      </div>
                    </div>
                  ) : (
                    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{result.raw}</pre>
                  )
                ) : stream ? (
                  <pre className="m-0 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{stream}</pre>
                ) : (
                  <div className="animate-pulse-dot pt-1 text-sm text-muted-foreground">
                    {busyStage || "Writing on chain..."}
                  </div>
                )}
                {result && (
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>job #{result.jobId}</span>
                    <a className="hover:text-foreground hover:underline" href={\`https://\${network}.lightscan.app/address/\${result.worker}\`} target="_blank" rel="noopener noreferrer">worker</a>
                    <a className="hover:text-foreground hover:underline" href={\`https://\${network}.lightscan.app/tx/\${result.submitJob}\`} target="_blank" rel="noopener noreferrer">submitJob</a>
                    {result.jobCompleted && (
                      <a className="hover:text-foreground hover:underline" href={\`https://\${network}.lightscan.app/tx/\${result.jobCompleted}\`} target="_blank" rel="noopener noreferrer">jobCompleted</a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
`;

const NODE_CHAT_REPL = `// chat-repl.ts
// Generated by 'lightnode add chat'. Interactive multi-turn chat in your terminal.
//   cp .env.example .env     (put a funded PRIVATE_KEY in it)
//   npx tsx chat-repl.ts
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runInferenceWithKey, type NetworkId } from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "mainnet") as NetworkId;
const MODEL = process.env.MODEL ?? "llama3-8b";
const SYSTEM = "You are a concise assistant. Reply in one or two short sentences.";
const PRIVATE_KEY = process.env.PRIVATE_KEY as \`0x\${string}\` | undefined;
if (!PRIVATE_KEY?.startsWith("0x") || PRIVATE_KEY.length !== 66) {
  console.error("Set a funded PRIVATE_KEY in .env (see .env.example).");
  process.exit(1);
}

const rl = readline.createInterface({ input, output });
const turns: { role: "user" | "assistant"; text: string }[] = [];
console.log(\`Chat on \${NETWORK} (\${MODEL}). Your funded key pays each turn. Ctrl+C to exit.\\n\`);

while (true) {
  const user = (await rl.question("you > ")).trim();
  if (!user) continue;
  turns.push({ role: "user", text: user });
  const prompt = SYSTEM + "\\n\\n" + turns.map((t) => (t.role === "user" ? "User: " : "Assistant: ") + t.text).join("\\n\\n") + "\\n\\nAssistant:";
  try {
    process.stdout.write("ai  > ");
    // runInferenceWithKey builds the viem clients, runs SIWE, and auto-loads
    // 'ws' in Node - no manual client wiring (and no type casts) needed.
    const { answer } = await runInferenceWithKey({
      network: NETWORK,
      privateKey: PRIVATE_KEY,
      model: MODEL,
      prompt,
      onChunk: (chunk) => process.stdout.write(chunk),
    });
    process.stdout.write("\\n\\n");
    turns.push({ role: "assistant", text: answer });
  } catch (e) {
    console.log("  (error: " + (e as Error).message + ")\\n");
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

// 'add worker-operator': a code-first operator console for running a worker
// from a laptop / server / cron - no Docker, no worker image. It wraps the
// WorkerOperator surface (status, live config, stuck-job recovery, settle,
// withdraw, profitability) the daemon and the read-only SDK don't expose.
const WORKER_OPS_SCRIPT = `// worker-ops.ts
// Generated by 'lightnode add worker-operator'. Run on-chain worker operations
// from code - no Docker, no worker image needed. https://lightnode.app/build
//
//   npx tsx worker-ops.ts status                 # registration, stake, claimable, gas, to-do
//   npx tsx worker-ops.ts settle                 # release completed jobs past their window + withdraw
//   npx tsx worker-ops.ts clearstuck [--yes]     # claimTimeout acked-but-stuck jobs (mainnet: realizes a slash)
//   npx tsx worker-ops.ts withdraw               # pull the claimable balance into the wallet
//   npx tsx worker-ops.ts deregister [--yes]     # clear stuck + settle + withdraw + deregister, in one go
//   npx tsx worker-ops.ts profitability          # per-job worker fee net of gas, from the live fee split
//
// PRIVATE_KEY in .env MUST be the worker's OWN key: it signs the operator txs
// and pays their gas. NETWORK selects testnet/mainnet; MODEL is used by
// 'profitability'. Reads (status/profitability) don't move funds; the write
// commands do, and the mainnet-slashing ones are gated behind --yes.
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  LightNode,
  WorkerOperator,
  NETWORKS,
  isWorkerOpError,
  type MinimalPublicClient,
  type MinimalWalletClient,
} from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "testnet") as "testnet" | "mainnet";
const KEY = process.env.PRIVATE_KEY as \`0x\${string}\` | undefined;
if (!KEY || !KEY.startsWith("0x") || KEY.length !== 66) {
  console.error("Set PRIVATE_KEY in .env to the worker's own 0x-prefixed key (testnet faucet: https://lightfaucet.ai).");
  process.exit(1);
}

const cfg = NETWORKS[NETWORK];
const account = privateKeyToAccount(KEY);
const chain = {
  id: cfg.chainId,
  name: cfg.label,
  nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
};
const publicClient = createPublicClient({ transport: http(cfg.rpc), chain });
const walletClient = createWalletClient({ account, transport: http(cfg.rpc), chain });

const op = new WorkerOperator(NETWORK, {
  publicClient: publicClient as unknown as MinimalPublicClient,
  walletClient: walletClient as unknown as MinimalWalletClient,
  workerAddress: account.address,
});
const ln = new LightNode(NETWORK);

// On-chain there is no enumerator of a worker's jobs, so candidate IDs come from
// the public indexer (recent jobs are enough for settle / clearstuck).
async function jobIds(): Promise<bigint[]> {
  const jobs = await ln.getWorkerJobs(account.address, 100);
  return jobs.map((j) => BigInt(j.id));
}

const cmd = process.argv[2] ?? "status";
const yes = process.argv.includes("--yes");

async function requireYesOnMainnet(what: string): Promise<void> {
  if (NETWORK !== "mainnet" || yes) return;
  const c = await op.config();
  console.error(\`\${what} on mainnet realizes a \${c.slashBps.completionTimeout / 100}% slash per stuck job. Re-run with --yes to confirm.\`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (cmd === "status") {
    const [status, conf, actions] = await Promise.all([op.status(), op.config(), ln.getWorkerActions(account.address)]);
    console.log(JSON.stringify({
      address: account.address,
      registered: status.registered,
      stakeLcai: status.stakeLcai,
      minStakeLcai: conf.minStakeLcai,
      belowFloor: status.belowFloor,
      claimableLcai: status.claimableLcai,
      outOfGas: actions.outOfGas,
      walletGasLcai: actions.walletGasLcai,
      todo: actions.actions.map((a) => a.title),
    }, null, 2));
    return;
  }
  if (cmd === "settle") {
    const r = await op.releaseAll(await jobIds());
    let withdrawTx: string | undefined;
    if ((await op.status()).claimableWei > 0n) withdrawTx = await op.withdraw();
    console.log(JSON.stringify({
      settled: r.done.map((d) => ({ jobId: d.jobId.toString(), tx: d.tx })),
      skipped: r.skipped.map((s) => ({ jobId: s.jobId.toString(), reason: s.reason })),
      withdrawTx: withdrawTx ?? null,
    }, null, 2));
    return;
  }
  if (cmd === "clearstuck") {
    await requireYesOnMainnet("clearstuck");
    const r = await op.clearStuck(await jobIds());
    console.log(JSON.stringify({
      cleared: r.done.map((d) => ({ jobId: d.jobId.toString(), tx: d.tx })),
      skipped: r.skipped.map((s) => ({ jobId: s.jobId.toString(), reason: s.reason })),
    }, null, 2));
    return;
  }
  if (cmd === "withdraw") {
    const before = (await op.status()).claimableLcai;
    if (before <= 0) {
      console.log(JSON.stringify({ withdrawnLcai: 0, note: "nothing claimable in the JobRegistry" }, null, 2));
      return;
    }
    const tx = await op.withdraw();
    console.log(JSON.stringify({ withdrawnLcai: before, tx }, null, 2));
    return;
  }
  if (cmd === "deregister") {
    await requireYesOnMainnet("deregister");
    const r = await op.unstickAndDeregister(await jobIds());
    console.log(JSON.stringify({
      cleared: r.cleared.map((c) => c.jobId.toString()),
      released: r.released.map((c) => c.jobId.toString()),
      withdrawTx: r.withdrawTx ?? null,
      deregisterTx: r.deregisterTx,
    }, null, 2));
    return;
  }
  if (cmd === "profitability") {
    const p = await op.profitability({ modelTag: process.env.MODEL ?? "llama3-8b" });
    console.log(JSON.stringify(p, null, 2));
    return;
  }
  console.error(\`unknown command "\${cmd}". Try: status | settle | clearstuck | withdraw | deregister | profitability\`);
  process.exit(1);
}

main().catch((e) => {
  if (isWorkerOpError(e)) {
    console.error("operator error:", e.message);
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});
`;

const WORKER_OPS_ENV = (net: Network) => `# The WORKER's OWN private key - it signs the operator txs and pays their gas.
# NOT a consumer key. Testnet is free (faucet at https://lightfaucet.ai).
PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000

NETWORK=${net}
MODEL=llama3-8b
`;

const WORKER_OPS_README = `# Worker operator console

Generated by \`lightnode add worker-operator\`. A code-first way to run the
on-chain operations a LightChain worker needs - **no Docker, no worker image**.
It wraps the SDK's \`WorkerOperator\`, which exposes operations the worker daemon
and the read-only SDK do not: stuck-job recovery, Docker-free settle/exit, live
protocol config, and net profitability.

## Setup

\`\`\`bash
npm install lightnode-sdk viem ws && npm install -D @types/node @types/ws tsx
cp .env.example .env   # then put the WORKER's own funded key in PRIVATE_KEY
\`\`\`

## Commands

\`\`\`bash
npx tsx worker-ops.ts status         # registration, stake vs floor, claimable, gas, prioritized to-do
npx tsx worker-ops.ts settle         # release completed jobs past their dispute window, then withdraw
npx tsx worker-ops.ts clearstuck     # claimTimeout acked-but-stuck jobs (add --yes on mainnet: realizes a slash)
npx tsx worker-ops.ts withdraw       # pull the claimable balance into the wallet
npx tsx worker-ops.ts deregister     # clear stuck + settle + withdraw + deregister (add --yes on mainnet)
npx tsx worker-ops.ts profitability  # per-job worker fee net of gas, from the live AIConfig fee split
\`\`\`

\`status\` and \`profitability\` are read-only. The write commands move funds; the
ones that can realize a **mainnet slash** (\`clearstuck\`, \`deregister\`) refuse to
run on mainnet without \`--yes\`.

## Automate it

\`status\` prints a JSON \`todo\` list and an \`outOfGas\` flag - drop it in cron and
alert when the to-do is non-empty or gas is low, so a worker never sits on
stuck jobs or unclaimed earnings it doesn't know about. See
https://lightnode.app/build for the full method reference.
`;

/**
 * \`lightnode add worker-operator\` - scaffold a runnable operator console
 * (worker-ops.ts + .env.example + README) that drives the WorkerOperator surface
 * from code. Always a Node script: operator tooling is run with \`npx tsx\`, not
 * mounted in a web framework, so it ignores the nextjs/hono template split.
 */
export function addWorkerOperator(opts: AddOpts = {}): { written: WrittenFile[]; install: string; template: Template; network: Network } {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "testnet";
  const force = !!opts.force;
  const written: WrittenFile[] = [];
  written.push(writeFile(path.join(cwd, "worker-ops.ts"), WORKER_OPS_SCRIPT, force));
  written.push(writeFile(path.join(cwd, "WORKER-OPS-README.md"), WORKER_OPS_README, force));
  written.push(writeFile(path.join(cwd, ".env.example"), WORKER_OPS_ENV(network), force));
  // Always the node toolchain (tsx + @types) - this is a standalone script.
  return { written, install: installLine("node"), template: "node", network };
}

// ---------------------------------------------------------------------------
// `lightnode add batch` - run many prompts as parallel encrypted inferences.
// ---------------------------------------------------------------------------

const BATCH_SCRIPT = `// batch.ts
// Generated by 'lightnode add batch'. Run many prompts as parallel encrypted
// inferences against the LightChain worker pool - capped concurrency, results in
// submission order, a stalled slot fails on its own. Each slot is one
// createSession + submitJob (user-paid: free on testnet, real LCAI on mainnet).
//   npm install lightnode-sdk viem ws
//   tsx batch.ts
import WS from "ws";
import { runInferenceBatch, type NetworkId } from "lightnode-sdk";

const NETWORK = (process.env.NETWORK ?? "testnet") as NetworkId;
const PRIVATE_KEY = process.env.PRIVATE_KEY as \`0x\${string}\` | undefined;
if (!PRIVATE_KEY?.startsWith("0x") || PRIVATE_KEY.length !== 66) { console.error("set PRIVATE_KEY in .env"); process.exit(1); }

const prompts = [
  "Summarize LightChain AI in one sentence.",
  "Name one risk of centralized inference.",
];

const results = await runInferenceBatch({
  network: NETWORK,
  privateKey: PRIVATE_KEY,
  WebSocket: WS,
  concurrency: 4,
  prompts,
  onSlotComplete: ({ index, result, error }) => console.log("slot " + index + ":", error ? error.message : result?.answer),
});

console.log("\\n--- all results, submission order ---");
for (const r of results) console.log(r.index, r.error ? "ERROR: " + r.error.message : r.result?.answer);
`;

const BATCH_ENV = (net: Network) => `# A funded 0x private key holding LCAI on the selected network. Each batch slot
# spends one inference fee (free on testnet; real LCAI on mainnet).
PRIVATE_KEY=0xyourkey
NETWORK=${net}
`;

export function addBatch(opts: AddOpts = {}): { written: WrittenFile[]; install: string; template: Template; network: Network } {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "testnet";
  const force = !!opts.force;
  const written: WrittenFile[] = [];
  written.push(writeFile(path.join(cwd, "batch.ts"), BATCH_SCRIPT, force));
  written.push(writeFile(path.join(cwd, ".env.example"), BATCH_ENV(network), force));
  return { written, install: installLine("node"), template: "node", network };
}

// ---------------------------------------------------------------------------
// `lightnode add bridge` - move LCAI across the Hyperlane Warp Route.
// ---------------------------------------------------------------------------

const BRIDGE_SCRIPT = `// bridge.ts
// Generated by 'lightnode add bridge'. Move LCAI across the Hyperlane Warp Route
// between Ethereum (LCAI ERC-20) and LightChain (native LCAI). Signs with your
// own funded key on the SOURCE chain. Mainnet-only.
//   npm install lightnode-sdk viem
//   BRIDGE_DIRECTION=lc-to-eth BRIDGE_AMOUNT=1 tsx bridge.ts
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BRIDGE_ROUTE, quoteBridgeFee, bridgeAllowance, approveBridge, bridgeTransfer } from "lightnode-sdk";

const PRIVATE_KEY = process.env.PRIVATE_KEY as \`0x\${string}\` | undefined;
if (!PRIVATE_KEY?.startsWith("0x") || PRIVATE_KEY.length !== 66) { console.error("set PRIVATE_KEY in .env"); process.exit(1); }

const DIRECTION = (process.env.BRIDGE_DIRECTION ?? "lc-to-eth") as "eth-to-lc" | "lc-to-eth";
const AMOUNT = process.env.BRIDGE_AMOUNT ?? "1"; // LCAI

const [from, to] = DIRECTION === "eth-to-lc"
  ? (["ethereum", "lightchain-mainnet"] as const)
  : (["lightchain-mainnet", "ethereum"] as const);
const src = BRIDGE_ROUTE[from];
const account = privateKeyToAccount(PRIVATE_KEY);
const chain = { id: src.chainId, name: src.label, nativeCurrency: { name: "Ether", symbol: src.underlying ? "ETH" : "LCAI", decimals: 18 }, rpcUrls: { default: { http: [src.rpc] } } };
const pub = createPublicClient({ transport: http(src.rpc), chain });
const wallet = createWalletClient({ account, transport: http(src.rpc), chain });

const amount = parseEther(AMOUNT);
const fee = await quoteBridgeFee(pub, from, to);
console.log("Bridging " + AMOUNT + " LCAI " + from + " -> " + to + ". Hyperlane fee: " + (Number(fee) / 1e18));

// Ethereum side holds an ERC-20: approve the router once before the first transfer.
if (src.underlying) {
  const allowance = await bridgeAllowance(pub, account.address);
  if (allowance < amount) {
    console.log("Approving LCAI...");
    const approveTx = await approveBridge(wallet, amount);
    await pub.waitForTransactionReceipt({ hash: approveTx });
  }
}

const tx = await bridgeTransfer(wallet, { from, to, amount, recipient: account.address, fee });
console.log("Submitted: " + src.explorer + "/tx/" + tx);
console.log("Your LCAI lands on the destination after the Hyperlane relay (~30-60 min).");
`;

const BRIDGE_ENV = `# A funded 0x key. For lc-to-eth it holds native LCAI on LightChain mainnet; for
# eth-to-lc it holds LCAI ERC-20 on Ethereum (plus ETH for gas). Bridge is mainnet-only.
PRIVATE_KEY=0xyourkey
BRIDGE_DIRECTION=lc-to-eth
BRIDGE_AMOUNT=1
`;

export function addBridge(opts: AddOpts = {}): { written: WrittenFile[]; install: string; template: Template; network: Network } {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network ?? "mainnet"; // the bridge route is mainnet-only
  const force = !!opts.force;
  const written: WrittenFile[] = [];
  written.push(writeFile(path.join(cwd, "bridge.ts"), BRIDGE_SCRIPT, force));
  written.push(writeFile(path.join(cwd, ".env.example"), BRIDGE_ENV, force));
  return { written, install: installLine("node"), template: "node", network };
}

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
    written.push(writeFile(path.join(cwd, "components/lcai-mark.tsx"), LCAI_MARK_FILE, force));
    written.push(writeFile(path.join(cwd, "app/api/inference/route.ts"), NEXTJS_INFERENCE_STREAM_ROUTE, force));
    written.push(writeFile(path.join(cwd, "LIGHTNODE-HOSTING.md"), HOSTING_GUIDE, force));
    written.push(writeFile(path.join(cwd, "Dockerfile"), NEXTJS_DOCKERFILE, force));
    written.push(writeFile(path.join(cwd, "docker-compose.yml"), NEXTJS_DOCKER_COMPOSE, force));
    written.push(writeFile(path.join(cwd, ".dockerignore"), DOCKERIGNORE, force));
  } else {
    written.push(writeFile(path.join(cwd, "chat-repl.ts"), NODE_CHAT_REPL, force));
  }
  written.push(writeFile(path.join(cwd, ".env.example"), ENV_EXAMPLE(network), force));

  // The nextjs chat page renders markdown with streamdown; the node REPL doesn't.
  const install = template === "nextjs-api" ? installLine(template) + " streamdown" : installLine(template);
  return { written, install, template, network };
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
    // streamdown renders the assistant answers as markdown (bold, lists, code).
    install: `npm install lightnode-sdk viem streamdown` + (hasWagmi ? "" : " wagmi @tanstack/react-query"),
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
    install: `npm install lightnode-sdk viem streamdown` + (hasWagmi ? "" : " wagmi @tanstack/react-query"),
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
    install: `npm install lightnode-sdk viem streamdown` + (hasWagmi ? "" : " wagmi @tanstack/react-query"),
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
        className="bg-gradient-btn inline-flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-sm font-medium tracking-wide text-white transition hover:brightness-110 disabled:opacity-60"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          <path d="M21 12h-6a2 2 0 0 0 0 4h6v-4Z" />
        </svg>
        {isPending ? "Connecting..." : "Connect Wallet"}
      </button>
    );
  }

  if (chain && !LIGHTCHAIN_IDS.has(chain.id)) {
    return (
      <button
        type="button"
        onClick={() => switchChain({ chainId: 9200 })}
        disabled={switching}
        className="rounded-[10px] border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/20 disabled:opacity-60"
      >
        {switching ? "Switching..." : "Switch to LightChain"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => disconnect()}
      className="group inline-flex items-center gap-2 rounded-[10px] border border-border bg-card px-4 py-2 font-mono text-sm text-foreground transition hover:border-primary"
      title={\`\${chain?.name} - click to disconnect\`}
    >
      <span className="size-2 rounded-full bg-success" />
      {address ? shortAddress(address) : "(unknown)"}
      <span className="text-muted-foreground group-hover:text-foreground">disconnect</span>
    </button>
  );
}
`;

const LCAI_MARK_FILE = `// components/lcai-mark.tsx
// Generated by 'lightnode add wagmi-setup'. The LightChain atom mark (gradient
// logo). The viewBox frames the atom only - no wordmark. Used as the assistant
// avatar / glyph in the generated chat + inference pages.
export function LcaiMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="854.3951253356933 398.23541259765625 186.60832495117188 198.4013696411746"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g transform="translate(856.3148789999999, 398.23539999999997) scale(0.6266964564006055)">
        <linearGradient gradientTransform="matrix(1 0 0 1 0 -244)" gradientUnits="userSpaceOnUse" id="lcai-mark-grad" x1="-0.0000002" x2="298.8796082" y1="401.5" y2="401.5">
          <stop offset="0" stopColor="rgb(48, 5, 250)" />
          <stop offset="1" stopColor="rgb(255, 18, 251)" />
        </linearGradient>
        <path
          fill="url(#lcai-mark-grad)"
          d="M280.0912476,168.2428284c0.0187378-0.036911,0.0380554-0.0726929,0.0562134-0.1096191c16.2681885-32.6010895,17.265564-64.3445282,2.8092651-89.3834915c-12.8778992-22.3064003-36.5042877-36.642292-67.219101-41.070858C196.544342,13.2930756,172.316452,0,146.5589905,0c-22.3245773,0-43.5001221,9.986846-61.2456131,28.5235424C59.731987,30.5614643,38.6132431,40.6585007,24.5028381,57.9581261C6.2308226,80.3639221,2.1413448,111.8585815,12.9886856,146.6407318c0.0119276,0.0391846,0.0255585,0.0778198,0.0380545,0.1170044c-0.0181751,0.0363464-0.0380545,0.0727081-0.0562305,0.1090546c-16.2681713,32.6010895-17.2655487,64.3445282-2.8092442,89.3834991c12.8778811,22.3069611,36.5042725,36.6422882,67.2190933,41.0714264C96.5736389,301.7069092,120.8015289,315,146.5589905,315c22.3296814,0,43.5103455-9.991394,61.2581024-28.5365906c25.5706024-2.0402222,46.6916199-12.125885,60.7980499-29.4215393c18.2720032-22.4057922,22.3614807-53.9004517,11.5141602-88.6826019C280.1173706,168.3206482,280.1037292,168.2814484,280.0912476,168.2428284z M271.8764954,85.1474762c10.6303711,18.4145813,11.1694031,41.5411453,1.7635803,66.0655212c-3.7219849-8.3783264-8.2141418-16.6447449-13.4100647-24.7055588l-4.6642761,17.0429001c4.3473511,7.8126068,7.9301758,15.6831512,10.7121582,23.4855347c-4.3819885,8.0193481-9.6506042,15.8308258-15.7041626,23.3338776c1.5176544-10.6928558,2.3207703-21.6884308,2.3207703-32.8691864c0-29.667511-5.4985657-60.093277-17.7237091-87.3391113c-2.6733246-5.9579468-5.6783905-11.7689896-9.0385132-17.369133C246.8721771,58.2199669,262.7427673,69.3285828,271.8764954,85.1474762z M53.0189972,157.5005646c0-17.7983093,2.0930176-34.8525772,5.9098625-50.615242c11.8929939-11.332962,25.6574974-21.6162949,40.8601341-30.3939056c17.8886261-10.3276367,36.5854874-17.8778381,55.0960617-22.4290848c17.2502136,7.3440208,34.5396118,17.6932373,50.7930145,30.9488297c11.4465637,9.3348007,21.5856323,19.4636459,30.3081512,30.0235825c2.6712189,13.4345093,4.1127625,27.6942902,4.1127625,42.4658203c0,17.79776-2.0930176,34.852005-5.9092865,50.6141052c-11.8930054,11.3329773-25.6575012,21.6163025-40.8607025,30.3939209c-17.8818207,10.3236542-36.5724335,17.8908844-55.0767517,22.4427032c-17.2558975-7.3440094-34.5521164-17.7017517-50.811203-30.9624481h-0.0011368c-11.4465637-9.3348083-21.5856247-19.4636536-30.3081436-30.0235901C54.460537,186.531311,53.0189972,172.27211,53.0189972,157.5005646z M197.5405884,36.2367516c-8.420929-0.1454048-17.0355225,0.3947487-25.7472534,1.5812645l10.6093597,11.7066994c4.158783-0.3368149,8.2834625-0.5191383,12.357605-0.5191383c2.894455,0,5.7661743,0.0851974,8.6072235,0.2578659c1.8720703,0.1141663,3.7151794,0.2686577,5.5338593,0.456089c7.9432373,11.0063782,14.6692963,24.0733986,19.8174896,38.6586342c-4.7466278-4.5887375-9.7346497-9.0269547-14.9538574-13.283989c-5.9595642-4.8602829-12.1525574-9.4351349-18.5579681-13.6909294c-6.3523102-4.2205162-12.9407349-7.9979477-19.6017914-11.7028999c-4.8133698-2.6772537-9.9029083-5.0026283-14.9892578-7.1101379c-1.8141327-0.7520103-3.3374634-1.3887177-4.6540527-1.9288712c-15.6155548-6.2455406-31.4423981-10.2702694-46.9034653-11.8191586c-1.6102371-0.1607399-3.2039948-0.2845592-4.789238-0.3907719c12.707489-10.0067272,27.0797272-15.6558857,42.2897491-15.6558857C165.352417,12.7955227,182.865036,21.4209137,197.5405884,36.2367516z M34.4186859,66.0450745c9.6119766-11.7850838,23.0726089-19.3455086,38.8551559-22.8698425c-0.9178619,1.2932968-1.8266373,2.6036339-2.717804,3.9503212c-7.5609894,11.4329338-13.7923317,24.314785-18.6122322,38.2065163l15.7944679-5.6764221c6.2233963-15.0276947,14.1956024-28.1611671,23.4639511-38.7228127c1.3574829-0.0494118,2.7212067-0.0846291,4.0997009-0.0846291c12.3808975,0,25.5910492,1.9907799,39.0925751,5.8922577c-13.8752594,4.7176666-27.6653214,10.9700241-41.0032654,18.6707382c-9.0180283,5.2061462-17.6032944,11.0505371-25.9167862,17.3136139c-6.0140381,4.5307617-12.0375252,9.2800751-17.314682,14.6695099c-0.9797707,0.965004-1.8680954,1.8391342-2.6734962,2.6308975c-0.0170364,0.0653229-0.0329399,0.1312103-0.0505486,0.1965256c-9.7846451,9.6653671-18.3208618,20.0276489-25.3808918,30.852272C16.8799381,106.224762,20.5229797,83.083992,34.4186859,66.0450745z M21.2414799,229.8525238c-10.630372-18.4140167-11.1693878-41.5405731-1.763588-66.0655212c4.1763802,9.4012604,9.3228741,18.6616516,15.3446293,27.6482849l4.0724411-17.6199799c-4.9550858-8.587326-8.9911728-17.2598572-12.054306-25.851181c4.381422-8.0193481,9.650032-15.8308258,15.7035942-23.3338776c-1.5176506,10.6934204-2.3207779,21.6895752-2.3207779,32.8703156c0,7.742981,0.3608093,15.5649719,1.0776787,23.2746582c2.6225128,28.2041779,11.0045586,56.9674835,25.6845512,81.4324493C46.2463646,256.7800293,30.3752155,245.6719818,21.2414799,229.8525238z M95.5614929,278.7479248c0.9189987,0.0158997,1.8345871,0.0408936,2.7575607,0.0408936c7.9733429,0,16.1102676-0.612854,24.3289871-1.7931213l-10.7837296-11.6033325c-7.5093002,0.662262-14.9044418,0.7838135-22.1138535,0.3441772c-1.8720703-0.1135864-3.7151718-0.2680664-5.5338593-0.4555054c-7.9438095-11.0069427-14.6698608-24.0739594-19.8180618-38.6603394c4.7472,4.5893097,9.7357941,9.0280914,14.9555588,13.2851257h-0.0011292c11.9242325,9.7244415,24.5255051,18.0942383,37.4562073,24.9662781c-0.021019,0.0028381-0.0420303,0.0050964-0.0630493,0.0073547c5.3225708,2.7774658,11.9242401,6.0115356,18.2651978,8.5464478c2.2242279,0.8894653,4.0071259,1.6102295,5.4679718,2.2071838c14.5341187,5.5088806,29.2147827,9.0860291,43.5802155,10.5247192c1.6107941,0.1613159,3.2039948,0.2845764,4.7897949,0.3907776c-12.7080536,10.0067444-27.0802917,15.6558838-42.2903137,15.6558838C127.7593155,302.2044678,110.240448,293.5728455,95.5614929,278.7479248z M258.6993103,248.9549255c-9.6131287,11.7862244-23.0743256,19.3534546-38.8602753,22.8778076c0.9195557-1.2955933,1.8305969-2.6087646,2.7229004-3.9582825c7.3122253-11.0557861,13.3947449-23.4577026,18.1470642-36.8263245l-15.8035583,5.4151459c-6.1529694,14.5613861-13.9542084,27.3091888-22.9919586,37.6073151c-13.5583191,0.4913025-28.2117157-1.4767761-43.229187-5.8201294c13.8883209-4.7193909,27.6931458-10.9535522,41.04245-18.6616669c9.6801453-5.5883789,18.8150177-11.7680359,27.3148804-18.427063c-0.0124969,0.0312347-0.0238647,0.0630493-0.0363464,0.0942841c4.5438538-3.6339569,9.8499603-8.1062622,14.4875336-12.6194458c3.7958374-3.6941681,6.0331268-5.820694,7.3400421-7.0401611c8.474884-8.7463684,15.9393005-18.0238037,22.2302856-27.6698608C276.2380371,208.775238,272.5950012,231.9165802,258.6993103,248.9549255z M151.8601074,99.7067947l2.0352783,43.1479874c0.1197662,2.5387726,2.1956635,4.5453033,4.7370453,4.5787506l30.6875916,0.4037781c3.7883453,0.0498505,6.0318604,4.2594757,3.9608765,7.4320374l-40.7515411,62.4279022c-2.6121979,4.0016479-8.8297119,2.1519318-8.8297119-2.6268463v-42.6512451c0-2.6540527-2.151535-4.8055878-4.805603-4.8055878h-32.7028122c-3.7936096,0-6.0953522-4.18367-4.056221-7.3826447c9.1347427-14.3305359,29.4064636-45.9985199,40.9515228-63.0014496C145.6810608,93.4083862,151.6424866,95.0932236,151.8601074,99.7067947z"
        />
      </g>
    </svg>
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
  written.push(writeFile(path.join(cwd, "components/lcai-mark.tsx"), LCAI_MARK_FILE, force));

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

// ---------------------------------------------------------------------------
// Fresh-scaffold wiring: when `add <x>-web3` scaffolds a brand-new Next.js app
// (bare folder), the create-next-app starter page sits at `/` and the generated
// page sits at `/<x>-web3`, so `npm run dev` + localhost:3000 lands on the
// starter, not the chat. This makes the generated page the homepage and ships
// the LightChain theme so the first render is the real thing.
//
// Only ever invoked on a scaffold WE just created, so overwriting page.tsx and
// globals.css is safe - there is no user content to clobber. In an existing app
// none of this runs; the page keeps its dedicated /<x>-web3 route untouched.
// ---------------------------------------------------------------------------

// The LightChain chat theme (Tailwind v4 tokens, light + dark), ported from the
// lightnode app's globals.css. Shipped as the scaffold's app/globals.css so
// installs default to the real look instead of the create-next-app starter.
export const SCAFFOLD_GLOBALS_CSS = `@import "tailwindcss";

/* let Tailwind v4 see streamdown's classes so markdown answers are styled
   (harmless when streamdown isn't installed - the path just matches nothing) */
@source "../node_modules/streamdown/dist";

/* dark mode via .dark class (we default the app to dark) */
@custom-variant dark (&:is(.dark, .dark *));

/* design tokens (light) - ported from lcai-chat-v2 */
:root {
  font-family: var(--font-inter), ui-sans-serif, system-ui, sans-serif;

  --background: #ffffff;
  --primary: #6767e9;
  --primary-600: #5a4fd8;
  --foreground: #09090b;
  --card: #ffffff;
  --card-foreground: #09090b;
  --popover: #ffffff;
  --popover-foreground: hsl(240 10% 3.9%);
  --primary-foreground: #fafafa;
  --secondary: hsl(240 4.8% 95.9%);
  --secondary-foreground: hsl(240 5.9% 10%);
  --muted: hsl(240 4.8% 95.9%);
  --muted-foreground: hsl(240 3.8% 46.1%);
  --accent: hsl(240 4.8% 95.9%);
  --accent-foreground: hsl(240 5.9% 10%);
  --destructive: #ef4d6a;
  --destructive-foreground: hsl(0 0% 98%);
  --success: #15bd77;
  --warning: #eaa53d;
  --border: hsl(240 5.9% 90%);
  --input: hsl(240 5.9% 90%);
  --ring: hsl(240 10% 3.9%);
  --radius: 0.625rem;

  --surface-base-subtle: rgba(34, 35, 42, 0.02);
  --surface-base-faint: rgba(14, 18, 27, 0.04);
  --surface-base-light: rgba(204, 206, 239, 0.16);
  --surface-elevation-light: #ffffff;

  --content-primary: #0f0f14;
  --content-default: #373842;
  --content-soft: #656678;
  --content-extraLight: #9798b6;

  --border-soft: rgba(14, 18, 27, 0.08);
  --border-light: rgba(14, 18, 27, 0.06);
}

/* design tokens (dark) */
.dark {
  --background: #070710;
  --foreground: hsl(0 0% 98%);
  --card: #0f0f14;
  --card-foreground: hsl(0 0% 98%);
  --popover: #0f0f14;
  --popover-foreground: hsl(0 0% 98%);
  --primary: #7064e9;
  --primary-600: #8c71f6;
  --primary-foreground: hsl(0 0% 98%);
  --secondary: hsl(240 3.7% 15.9%);
  --secondary-foreground: hsl(0 0% 98%);
  --muted: hsl(240 3.7% 15.9%);
  --muted-foreground: hsl(240 5% 64.9%);
  --accent: hsl(240 3.7% 15.9%);
  --accent-foreground: hsl(0 0% 98%);
  --destructive: #fb5a76;
  --destructive-foreground: hsl(0 0% 98%);
  --success: #22d68a;
  --warning: #f5be5c;
  --border: hsl(240 3.7% 15.9%);
  --input: hsl(240 3.7% 15.9%);
  --ring: hsl(240 4.9% 83.9%);

  --surface-base-subtle: rgba(204, 206, 239, 0.02);
  --surface-base-faint: rgba(204, 206, 239, 0.04);
  --surface-base-light: rgba(204, 206, 239, 0.08);
  --surface-elevation-light: #0f0f14;

  --content-primary: #cccef0;
  --content-default: #9798b6;
  --content-soft: rgba(154, 156, 207, 0.8);
  --content-extraLight: #9798b6;

  --border-soft: rgba(204, 206, 239, 0.12);
  --border-light: rgba(204, 206, 239, 0.08);
}

/* theme mapping (Tailwind v4 @theme) */
@theme inline {
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-lg: var(--radius);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-600: var(--primary-600);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-surface-base-subtle: var(--surface-base-subtle);
  --color-surface-base-faint: var(--surface-base-faint);
  --color-surface-base-light: var(--surface-base-light);
  --color-surface-elevation-light: var(--surface-elevation-light);
  --color-surface-base-brand-default: #693ee0;
  --color-surface-base-brand-strong: #8c71f6;

  --color-content-primary: var(--content-primary);
  --color-content-default: var(--content-default);
  --color-content-soft: var(--content-soft);
  --color-content-extraLight: var(--content-extraLight);

  --color-bdr-soft: var(--border-soft);
  --color-bdr-light: var(--border-light);

  --color-gradient-primary: linear-gradient(270deg, #7064e9 0%, #dd00ac 100%);
}

@layer base {
  * {
    border-color: var(--border);
  }
  body {
    background-color: var(--background);
    color: var(--foreground);
    overflow-x: hidden;
  }
  html {
    overflow-x: hidden;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    cursor: not-allowed;
  }
  /* visible keyboard focus across interactive elements */
  a:focus-visible,
  button:focus-visible,
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
    border-radius: 6px;
  }
}

/* respect reduced-motion: kill non-essential animation */
@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}

/* ambient app background (gradient mesh behind everything) */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(60% 50% at 50% -6%, rgba(221, 0, 172, 0.10), transparent 60%),
    radial-gradient(55% 45% at 12% -8%, rgba(112, 100, 233, 0.14), transparent 60%),
    radial-gradient(50% 40% at 88% -2%, rgba(112, 100, 233, 0.12), transparent 60%),
    radial-gradient(45% 45% at 50% 115%, rgba(112, 100, 233, 0.07), transparent 60%);
}
.dark body::before {
  background:
    radial-gradient(60% 50% at 50% -6%, rgba(221, 0, 172, 0.12), transparent 60%),
    radial-gradient(55% 45% at 12% -8%, rgba(112, 100, 233, 0.18), transparent 60%),
    radial-gradient(50% 40% at 88% -2%, rgba(112, 100, 233, 0.14), transparent 60%),
    radial-gradient(45% 45% at 50% 118%, rgba(112, 100, 233, 0.10), transparent 60%);
}

/* signature lcai gradient (primary buttons / accents) */
.bg-gradient-primary {
  background-image: var(--color-gradient-primary);
}
/* the lcai-chat connect-button gradient (pink -> purple) */
.bg-gradient-btn {
  background-image: linear-gradient(94deg, #dd00ac 10.66%, #7130c3 53.03%, #410093 96.34%);
  background-size: 200% auto;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.animate-pulse-dot {
  animation: pulse-dot 1.6s ease-in-out infinite;
}
.text-gradient {
  background: linear-gradient(94deg, #dd00ac 10%, #7130c3 53%, #7064e9 96%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* minimal scrollbar */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
`;

/** Map an `add` target to the route folder its page lives in. */
const WEB3_ROUTE_DIR: Record<string, string> = {
  "chat": "chat",
  "chat-web3": "chat-web3",
  "inference-web3": "inference-web3",
  "judge-web3": "judge-web3",
};

export interface ScaffoldWiring {
  written: WrittenFile[];
  /** The route now also served at `/` (e.g. "/chat-web3"), or null if nothing was wired. */
  homepageRoute: string | null;
  /** Whether the `dark` class was added to <html> (dark kept as the default). */
  darkDefault: boolean;
}

/** The app/page.tsx we drop in to make the generated page the homepage. It
 *  re-exports the real page so its documented /<target> route still works. */
function homepageReexport(dir: string, target: string): string {
  return `// app/page.tsx
// Generated by 'lightnode add ${target}'. Makes the ${dir} page the homepage so
// 'npm run dev' + http://localhost:3000 lands on it directly. The page itself
// still lives at app/${dir}/page.tsx and is also served at /${dir}.
export { default } from "./${dir}/page";
`;
}

/** Add the \`dark\` class to the layout's <html> element so dark stays the
 *  default theme. Returns the patched source, or null if <html> was not found
 *  or already carries a \`dark\` class. Handles className as a template literal,
 *  a string literal, or absent. */
function withDarkHtml(source: string): string | null {
  const match = source.match(/<html\b[^>]*>/);
  if (!match) return null;
  const tag = match[0];
  // Already dark? Cover both className={`...dark...`} and className="...dark...".
  if (/className=\{`[^`]*\bdark\b/.test(tag) || /className=(["'])[^"']*\bdark\b/.test(tag)) return null;

  if (/className=\{`/.test(tag)) {
    return source.replace(tag, tag.replace(/className=\{`/, "className={`dark "));
  }
  if (/className=(["'])/.test(tag)) {
    return source.replace(tag, tag.replace(/className=(["'])/, 'className=$1dark '));
  }
  // No className on <html>: add one.
  return source.replace(tag, tag.replace(/<html\b/, '<html className="dark"'));
}

function setDarkDefaultOnLayout(cwd: string): boolean {
  const abs = findLayoutFile(cwd);
  if (!abs) return false;
  let source: string;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch {
    return false;
  }
  const patched = withDarkHtml(source);
  if (patched === null) return false;
  try {
    fs.writeFileSync(abs, patched);
  } catch {
    return false;
  }
  return true;
}

/** One-line description of what each scaffold target gives the dev. */
const SCAFFOLD_README_WHAT: Record<string, string> = {
  "chat-web3":
    "A self-contained, wallet-signed chat you can drop into any project - for example, to give an agent a chat UI.",
  "inference-web3":
    "A self-contained, wallet-signed one-shot inference page you can drop into any project.",
  "judge-web3":
    "A self-contained, wallet-signed pass/fail evaluator page you can drop into any project.",
};

/** A real README for a freshly scaffolded app, replacing the create-next-app
 *  default so the dev knows what they got and how to use it. */
function scaffoldReadme(target: string, dir: string): string {
  if (target === "chat") {
    return `# LightNode chat (server-paid)

Generated by \`lightnode add chat\`. A streaming chatbot where YOUR funded wallet
pays for every visitor's turn - users never touch a wallet (the classic SaaS
chatbot pattern).

## Run it

    cp .env.example .env     # then put a funded mainnet PRIVATE_KEY in it
    npm run dev

Open http://localhost:3000 (the chat is the homepage; also served at /chat).
Mainnet llama3-8b is ~0.02 LCAI per turn. Free testnet LCAI: https://lightfaucet.ai

## Where things live

- \`app/page.tsx\` - re-exports the chat as the homepage
- \`app/chat/page.tsx\` - the streaming chat UI (also at /chat). Edit this.
- \`app/api/inference/route.ts\` - the streaming server route (uses PRIVATE_KEY)
- \`.env.example\` - PRIVATE_KEY (+ NETWORK, MODEL)
- \`Dockerfile\` + \`docker-compose.yml\` - run the whole stack with no function timeout
- \`LIGHTNODE-HOSTING.md\` - deploy notes

## Customize

Change the model or system prompt in \`app/api/inference/route.ts\`. The page is a
normal React client component streaming from your route. Builder docs:
https://lightnode.app/build
`;
  }
  const what = SCAFFOLD_README_WHAT[target] ?? "A self-contained, wallet-signed page.";
  return `# LightNode ${dir}

Generated by \`lightnode add ${target}\`. ${what}
No backend, no database, no API keys: each visitor signs and pays for their own
turns from their own wallet on LightChain.

## Run it

    npm run dev

Open http://localhost:3000 and click **Connect wallet** (LightChain mainnet
9200 or testnet 8200). Free testnet LCAI: https://lightfaucet.ai

## Where things live

- \`app/page.tsx\` - re-exports the page below as the homepage
- \`app/${dir}/page.tsx\` - the UI (also served at /${dir}). Edit this.
- \`app/providers.tsx\` + \`lib/wagmi.ts\` - wagmi + React Query setup
- \`components/connect-button.tsx\` - the Connect wallet button
- \`app/globals.css\` - the theme (light + dark design tokens)

## Customize

It is a normal React client component using \`lightnode-sdk\` wired to the
connected wallet. Change the model or system prompt, restyle it, or call it
from your own agent. Builder docs: https://lightnode.app/build
`;
}

/**
 * Wire a freshly scaffolded Next.js app so the generated -web3 page is the
 * homepage and the LightChain theme + dark default are in place. No-op for any
 * target without a known route folder.
 */
export function wireFreshScaffold(target: string, opts: AddOpts = {}): ScaffoldWiring {
  const cwd = opts.cwd ?? process.cwd();
  const dir = WEB3_ROUTE_DIR[target];
  const written: WrittenFile[] = [];
  if (!dir) return { written, homepageRoute: null, darkDefault: false };

  // 1. Ship the LightChain theme, replacing the create-next-app starter globals.
  written.push(writeFile(path.join(cwd, "app/globals.css"), SCAFFOLD_GLOBALS_CSS, true));

  // 2. Make the generated page the homepage (replaces the starter page.tsx).
  written.push(writeFile(path.join(cwd, "app/page.tsx"), homepageReexport(dir, target), true));

  // 3. Replace create-next-app's default README with one about this scaffold.
  written.push(writeFile(path.join(cwd, "README.md"), scaffoldReadme(target, dir), true));

  // 4. Keep dark as the default theme (matches lightnode.app).
  const darkDefault = setDarkDefaultOnLayout(cwd);

  return { written, homepageRoute: `/${dir}`, darkDefault };
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
