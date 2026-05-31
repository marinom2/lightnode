"use client";

/**
 * Interactive ecosystem cards on /build. Each card is a real, exported
 * SDK module - and now each card can be EXPANDED INLINE to see live data
 * (or a runnable demo) plus deep-links to the npm package, the GitHub
 * source file, and the matching example.
 *
 * The user kept asking "I can't click on them to start using them" - this
 * is the fix. One card per module, one Try button per card, each Try
 * surfaces a different live experience:
 *   - Bridge: live quote both directions + addresses table
 *   - DAO: live list of recent LCAIGovernor proposals + drill-down
 *   - Multi-turn chat: code snippet + example link
 *   - Worker preflight: sample verdict + run-locally CLI
 *   - Dispute / refund: re-uses the CLI runner (job command)
 *   - On-chain models: explainer + code snippet (no public deployment yet)
 *
 * Card-level links: npm (the published package surface), GitHub (the
 * specific source file the module lives in), Examples (the runnable
 * standalone example in lightnode-examples).
 */

import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Boxes,
  Check,
  ChevronDown,
  Coins,
  Copy,
  Database,
  ExternalLink,
  Github,
  Loader2,
  PackageOpen,
  PlayCircle,
  ShieldCheck,
  Terminal,
  Workflow,
} from "lucide-react";
import { NETWORKS } from "lightnode-sdk";
import sdk from "@stackblitz/sdk";
import { humanizeError } from "@/lib/humanize-error";
import { MODULES, type ModuleDef, type ModuleId } from "@/lib/sdk-modules-data";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export { MODULES };
export type { ModuleDef, ModuleId };


function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore
        }
      }}
      aria-label="Copy snippet"
      className="absolute right-2 top-2 rounded-md border border-bdr-soft bg-card/80 p-1.5 text-content-soft transition-colors hover:text-content-primary"
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function CodeBox({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="max-h-[280px] overflow-auto rounded-lg border border-bdr-soft code-surface p-3 font-mono text-[11px] leading-relaxed text-content-default">
        <code>{code}</code>
      </pre>
      <CopyButton value={code} />
    </div>
  );
}

export function DocLinks({ m }: { m: ModuleDef }) {
  // Bridge has its own multi-template StackBlitz launcher inside BridgeRecipe;
  // every other module gets a single Open-in-StackBlitz badge here.
  const sandboxBody = m.sandboxBody ?? m.snippet;
  const showStackBlitz = m.id !== "bridge";
  const linkCls =
    "inline-flex items-center gap-1.5 rounded-full border border-[rgba(112,100,233,0.20)] bg-[#14152C] px-3 py-1.5 text-xs text-[#7376AA] transition-colors hover:border-[rgba(112,100,233,0.40)] hover:text-[#CCCEEF]";
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <a href={`https://www.npmjs.com/package/lightnode-sdk${m.npm}`} target="_blank" rel="noopener noreferrer" className={linkCls}>
        <PackageOpen className="size-3" /> npm <ExternalLink className="size-3" />
      </a>
      <a href={m.github} target="_blank" rel="noopener noreferrer" className={linkCls}>
        <Github className="size-3" /> Source <ExternalLink className="size-3" />
      </a>
      {m.example ? (
        <a href={m.example} target="_blank" rel="noopener noreferrer" className={linkCls}>
          <Terminal className="size-3" /> Example <ExternalLink className="size-3" />
        </a>
      ) : null}
      {showStackBlitz ? (
        <button
          type="button"
          onClick={() =>
            openSnippetInStackBlitz({
              title: m.title,
              snippet: sandboxBody,
              needsPrivateKey: m.sandboxNeedsKey ?? false,
            })
          }
          className="inline-flex items-center gap-1.5 rounded-full bg-[#7064E9] px-3 py-1.5 text-xs font-medium text-[#CCCEEF] transition-opacity hover:opacity-90"
          aria-label={`Open ${m.title} in StackBlitz`}
        >
          <PlayCircle className="size-3" /> Open in StackBlitz
        </button>
      ) : null}
    </div>
  );
}

// --- Bridge live widget ----------------------------------------------------

type DirQuote =
  | { ok: true; feeWei: string; feeEth?: number; feeLcai?: number }
  | { ok: false; error: string };

interface BridgeQuoteResp {
  ethereumToLightChain: DirQuote;
  lightChainToEthereum: DirQuote;
  route: {
    ethereum: { router: string; underlying: string | null; mailbox: string; explorer: string; chainId: number; label: string };
    "lightchain-mainnet": { router: string; underlying: string | null; mailbox: string; explorer: string; chainId: number; label: string };
  };
  fetchedAt?: number;
  error?: string;
}

function BridgeLive() {
  const [data, setData] = useState<BridgeQuoteResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/bridge-quote", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: BridgeQuoteResp) => {
        if (!alive) return;
        if (j.error) setErr(j.error);
        else setData(j);
      })
      .catch((e) => alive && setErr(humanizeError(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-content-soft">
        <Loader2 className="size-3.5 animate-spin" /> Loading live bridge quote…
      </p>
    );
  }
  if (err || !data) {
    return (
      <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-content-default">
        Couldn&apos;t reach the bridge quote endpoint right now. {err ?? ""}
      </p>
    );
  }
  const ethToLc = data.ethereumToLightChain;
  const lcToEth = data.lightChainToEthereum;
  const renderQuote = (q: DirQuote, unit: "ETH" | "LCAI") => {
    if (!q.ok) {
      return <div className="text-[11px] leading-relaxed text-warning">Live quote unavailable: {q.error.slice(0, 60)}</div>;
    }
    const v = unit === "ETH" ? q.feeEth ?? 0 : q.feeLcai ?? 0;
    if (v === 0) {
      return (
        <>
          <div className="font-mono text-sm text-content-default">0 {unit}</div>
          <div className="text-[10px] text-content-soft">Pre-paid relayer (Hyperlane IGP); you only pay source-chain gas</div>
        </>
      );
    }
    return (
      <>
        <div className="font-mono text-sm text-content-default">{v.toFixed(6)} {unit}</div>
        <div className="text-[10px] text-content-soft">Hyperlane interchain gas payment</div>
      </>
    );
  };
  // Quick-glance summary of the two live quotes (used inside the collapsed details).
  const quoteSummary = (q: DirQuote, unit: "ETH" | "LCAI") => {
    if (!q.ok) return <span className="text-warning">unavailable</span>;
    const v = unit === "ETH" ? q.feeEth ?? 0 : q.feeLcai ?? 0;
    return <span className="font-mono text-content-default">{v === 0 ? `0 ${unit}` : `${v.toFixed(6)} ${unit}`}</span>;
  };
  return (
    <div className="space-y-4">
      {/* The new bridge form is the main thing the visitor sees. */}
      <BridgeRecipe />

      {/* Everything below this is reference material - collapsed by default. */}
      <details className="rounded-2xl border border-bdr-soft bg-surface-base-faint">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-xs font-semibold text-content-primary">
          <span>Route details + why builders use this</span>
          <ChevronDown className="ml-auto size-3.5 text-content-soft transition-transform [details[open]>summary>&]:rotate-180" />
        </summary>
        <div className="space-y-3 border-t border-bdr-soft px-4 py-3 text-xs">
          {/* Live IGP fee quotes both directions - compact one-liners now */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-bdr-soft bg-card/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-content-soft">Ethereum {"->"} LightChain IGP fee</div>
              <div className="mt-0.5">{quoteSummary(ethToLc, "ETH")}</div>
            </div>
            <div className="rounded-lg border border-bdr-soft bg-card/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-content-soft">LightChain {"->"} Ethereum IGP fee</div>
              <div className="mt-0.5">{quoteSummary(lcToEth, "LCAI")}</div>
            </div>
          </div>

          {/* Confirmed route addresses table */}
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-content-soft">Confirmed route addresses</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-content-soft">
                  <tr>
                    <th className="pb-1 text-left font-medium">Side</th>
                    <th className="pb-1 text-left font-medium">Router</th>
                    <th className="pb-1 text-left font-medium">Underlying</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-content-default">
                  <tr>
                    <td className="pr-2 text-content-soft">Ethereum</td>
                    <td>
                      <a href={`${data.route.ethereum.explorer}/address/${data.route.ethereum.router}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        {data.route.ethereum.router.slice(0, 8)}…{data.route.ethereum.router.slice(-6)}
                      </a>
                    </td>
                    <td>
                      {data.route.ethereum.underlying ? (
                        <a href={`${data.route.ethereum.explorer}/address/${data.route.ethereum.underlying}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {data.route.ethereum.underlying.slice(0, 8)}…{data.route.ethereum.underlying.slice(-6)}
                        </a>
                      ) : (
                        "(native)"
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="pr-2 text-content-soft">LightChain</td>
                    <td>
                      <a href={`${data.route["lightchain-mainnet"].explorer}/address/${data.route["lightchain-mainnet"].router}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        {data.route["lightchain-mainnet"].router.slice(0, 8)}…{data.route["lightchain-mainnet"].router.slice(-6)}
                      </a>
                    </td>
                    <td className="text-content-soft">(native LCAI)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Why builders use this */}
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-content-soft">Why builders use this</div>
            <ul className="space-y-1 text-[11px] leading-relaxed text-content-default">
              <li className="flex items-start gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                <span>Top up your server-side LCAI wallet from Ethereum so it can pay for inference jobs.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                <span>Let users pay in ETH (via Uniswap swap to LCAI ERC-20, then bridge) without holding LCAI first.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                <span>Move earnings off LightChain into ETH/USDC by bridging LCAI back to Ethereum and swapping.</span>
              </li>
            </ul>
          </div>

          {/* Two external alternatives - smaller now */}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button asChild size="sm" variant="outline" className="w-full">
              <a
                href="https://app.uniswap.org/swap?chain=ethereum&inputCurrency=ETH&outputCurrency=0x9cA8530CA349c966Fe9ef903Df17a75B8A778927"
                target="_blank"
                rel="noopener noreferrer"
              >
                Uniswap (ETH to LCAI) <ExternalLink />
              </a>
            </Button>
            <Button asChild size="sm" variant="outline" className="w-full">
              <a href="https://bridge.lightchain.ai" target="_blank" rel="noopener noreferrer">
                Official LCAI Bridge <ExternalLink />
              </a>
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}

function CopyButtonRow({ code }: { code: string }) {
  return <CodeBox code={code} />;
}

// --- Bridge recipe: interactive amount + project-template chooser ---------
// The user asked two questions on this widget:
//   1. "How do we fund it and set amount when there is no option?"
//      -> Amount field below, scales the snippet's parseEther("X").
//   2. "And how this we connect to particular project?"
//      -> Template chooser switches the snippet between a one-shot Node
//         script, a Next.js App Router API route, and a React + wagmi
//         user-pays component. Same SDK, three integration shapes.

type BridgeTemplate = "node" | "nextjs" | "react";

const BRIDGE_TEMPLATES: { id: BridgeTemplate; label: string; line: string }[] = [
  { id: "node", label: "Node / CLI", line: "One-shot script with a PRIVATE_KEY env var." },
  { id: "nextjs", label: "Next.js API", line: "App Router route - server pays, user POSTs amount + recipient." },
  { id: "react", label: "React + wagmi", line: "User-pays component - the user's wallet signs both txs." },
];

interface BridgeSnippet {
  file: string;
  body: string;
  /** Bash commands to actually run this snippet, top to bottom. */
  setup: string;
  /** One-line reminder so the visitor does not paste the body into a shell. */
  fileHint: string;
}

function bridgeSnippet(tmpl: BridgeTemplate, amount: string, direction: BridgeDirection = "eth-to-lc"): BridgeSnippet {
  const safe = amount.trim() || "100";
  const ethToLc = direction === "eth-to-lc";
  // Source/destination chain keys + viem helpers driven by direction so the
  // snippet matches whatever the visitor selected in the form above.
  const fromKey = ethToLc ? "ethereum" : "lightchain-mainnet";
  const toKey = ethToLc ? "lightchain-mainnet" : "ethereum";
  const srcRouteVar = ethToLc ? "BRIDGE_ROUTE.ethereum" : "BRIDGE_ROUTE['lightchain-mainnet']";
  const srcPubVar = ethToLc ? "ethPub" : "lcPub";
  const srcWalVar = ethToLc ? "ethWal" : "lcWal";
  const arrivesNote = ethToLc ? "Hyperlane delivers native LCAI on chain 9200 in ~30 to 60 min."
                              : "Hyperlane delivers LCAI ERC-20 to your address on Ethereum in ~30 to 60 min.";
  const approveNote = ethToLc ? "// one-time (only required on the ERC-20 side)" : "// no-op on native side";

  if (tmpl === "nextjs") {
    return {
      file: "app/api/bridge/route.ts",
      fileHint: "Save in your Next.js project at app/api/bridge/route.ts",
      body: `// Server-pays: your hot wallet bridges on behalf of the user.
import { Bridge, BRIDGE_ROUTE } from "lightnode-sdk";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`);
const ${srcPubVar} = createPublicClient({ transport: http(${srcRouteVar}.rpc) });
const ${srcWalVar} = createWalletClient({ account, transport: http(${srcRouteVar}.rpc) });
const bridge      = new Bridge(${srcPubVar}, ${srcWalVar});

export async function POST(req: Request) {
  const { amount = "${safe}", recipient } = await req.json();
  const fee = await bridge.quoteFee("${fromKey}", "${toKey}");
  await bridge.approve(); ${approveNote}
  const result = await bridge.transfer({
    from: "${fromKey}",
    to:   "${toKey}",
    amount: parseEther(String(amount)),
    recipient,
    fee,
  });
  return Response.json({ ok: true, txHash: result.txHash });
}`,
      setup: `# In your existing Next.js project:
npm install lightnode-sdk viem

# Add PRIVATE_KEY to .env.local (a server key holding ${ethToLc ? "LCAI ERC-20 on Ethereum" : "native LCAI on LightChain"}):
echo 'PRIVATE_KEY=0xYOUR_KEY_HERE' >> .env.local

# Restart your dev server, then call the route:
curl -X POST http://localhost:3000/api/bridge \\
  -H 'content-type: application/json' \\
  -d '{"amount":"${safe}","recipient":"0x${ethToLc ? "LIGHTCHAIN" : "ETHEREUM"}_RECIPIENT"}'`,
    };
  }
  if (tmpl === "react") {
    const chainIdLit = ethToLc ? 1 : 9200;
    return {
      file: "components/BridgeButton.tsx",
      fileHint: "Save in your React/Next.js project at components/BridgeButton.tsx",
      body: `// User-pays component - the user's wallet signs and pays.
"use client";
import { Bridge, BRIDGE_ROUTE } from "lightnode-sdk";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { parseEther } from "viem";

export function BridgeButton({ amount = "${safe}" }: { amount?: string }) {
  const { address } = useAccount();
  const srcPub = usePublicClient({ chainId: ${chainIdLit} });
  const { data: srcWal } = useWalletClient({ chainId: ${chainIdLit} });

  async function run() {
    if (!srcPub || !srcWal || !address) return;
    const bridge = new Bridge(srcPub, srcWal);
    const fee = await bridge.quoteFee("${fromKey}", "${toKey}");
    await bridge.approve(); ${approveNote}
    await bridge.transfer({
      from: "${fromKey}",
      to:   "${toKey}",
      amount: parseEther(amount),
      recipient: address,
      fee,
    });
  }
  return <button onClick={run}>Bridge {amount} LCAI ${ethToLc ? "to LightChain" : "to Ethereum"}</button>;
}`,
      setup: `# Assumes you already have wagmi + Reown / RainbowKit / Web3Modal set up.
# (If not, see /onboard for the worker UI which shows the same wallet integration.)
npm install lightnode-sdk

# Make sure the user is on ${ethToLc ? "Ethereum mainnet (chainId 1)" : "LightChain mainnet (chainId 9200)"} when they click the button.
# Drop the component anywhere in your app:
# import { BridgeButton } from "@/components/BridgeButton";
# <BridgeButton amount="${safe}" />`,
    };
  }
  // node
  return {
    file: "bridge.ts",
    fileHint: "This is TypeScript - save it as bridge.ts in a folder, then run it with Node",
    body: `// One-shot Node script. The setup commands are below this snippet.
import { Bridge, BRIDGE_ROUTE } from "lightnode-sdk";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`);
const ${srcPubVar} = createPublicClient({ transport: http(${srcRouteVar}.rpc) });
const ${srcWalVar} = createWalletClient({ account, transport: http(${srcRouteVar}.rpc) });

const bridge = new Bridge(${srcPubVar}, ${srcWalVar});
const fee = await bridge.quoteFee("${fromKey}", "${toKey}"); // ${ethToLc ? "0 ETH" : "0 LCAI"} (pre-paid IGP)
await bridge.approve(); ${approveNote}
await bridge.transfer({
  from: "${fromKey}",
  to:   "${toKey}",
  amount:    parseEther("${safe}"),
  recipient: account.address,
  fee,
});
console.log("Bridged. ${arrivesNote}");`,
    setup: `# 1. Create a folder + install deps:
mkdir my-bridge && cd my-bridge
npm init -y
npm install lightnode-sdk viem tsx

# 2. Save the snippet above as bridge.ts in this folder.

# 3. Put your funded ${ethToLc ? "Ethereum" : "LightChain"} private key in .env (this key must already
#    hold ${ethToLc ? "LCAI ERC-20 on Ethereum - swap ETH on Uniswap first" : "native LCAI on LightChain"}):
echo 'PRIVATE_KEY=0xYOUR_KEY_HERE' > .env

# 4. Run it:
npx tsx --env-file=.env bridge.ts`,
  };
}

type BridgeDirection = "eth-to-lc" | "lc-to-eth";

interface BridgePreviewResp {
  ok?: boolean;
  error?: string;
  direction?: BridgeDirection;
  amountLcai?: string;
  amountWei?: string;
  igpFee?: { ok: boolean; wei?: string | null; eth?: number | null; lcai?: number | null; note?: string; error?: string };
  estimatedSourceGas?: string;
  estimatedRelayMinutes?: string;
  arrives?: string;
  route?: unknown;
  projectedCall?: unknown;
  note?: string;
}

/**
 * Build the file map for "Open in StackBlitz". Uses the `node` template
 * (a full WebContainer with npm + tsx + Next.js dev server, depending on
 * what package.json declares).
 */
function bridgeStackBlitzFiles(snippet: BridgeSnippet, tmpl: BridgeTemplate): Record<string, string> {
  if (tmpl === "node") {
    return {
      "bridge.ts": snippet.body,
      "package.json": JSON.stringify(
        {
          name: "lightnode-bridge-example",
          version: "0.0.0",
          private: true,
          type: "module",
          scripts: { start: "tsx --env-file=.env bridge.ts" },
          dependencies: { "lightnode-sdk": "^0.6.1", viem: "^2.21.0" },
          devDependencies: { tsx: "^4.19.0" },
        },
        null,
        2,
      ),
      ".env": "# Replace with a funded Ethereum private key that holds LCAI ERC-20.\nPRIVATE_KEY=0xYOUR_KEY_HERE\n",
      "README.md":
        "# Bridge example (lightnode-sdk)\n\n1. Set PRIVATE_KEY in `.env`\n2. Click the green Start button (runs `npm start`)\n",
    };
  }
  if (tmpl === "nextjs") {
    return {
      "app/api/bridge/route.ts": snippet.body,
      "app/page.tsx": `export default function Page() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 40 }}>
      <h1>LightNode Bridge - Next.js API example</h1>
      <p>POST <code>/api/bridge</code> with {"{ amount, recipient }"} to trigger the bridge.</p>
      <pre style={{ background: "#111", color: "#0f0", padding: 12 }}>
{\`curl -X POST http://localhost:3000/api/bridge \\\\
  -H 'content-type: application/json' \\\\
  -d '{"amount":"100","recipient":"0xLIGHTCHAIN_RECIPIENT"}'\`}
      </pre>
    </main>
  );
}`,
      "app/layout.tsx": `export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}`,
      "next.config.mjs": "export default { reactStrictMode: true };",
      "package.json": JSON.stringify(
        {
          name: "lightnode-bridge-nextjs-example",
          version: "0.0.0",
          private: true,
          scripts: { dev: "next dev", build: "next build", start: "next start" },
          dependencies: {
            next: "^14.2.0",
            react: "^18.3.0",
            "react-dom": "^18.3.0",
            "lightnode-sdk": "^0.6.1",
            viem: "^2.21.0",
          },
          devDependencies: { typescript: "^5.4.0", "@types/react": "^18.3.0", "@types/node": "^20.0.0" },
        },
        null,
        2,
      ),
      ".env.local": "# Replace with a funded Ethereum private key that holds LCAI ERC-20.\nPRIVATE_KEY=0xYOUR_KEY_HERE\n",
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            incremental: true,
            plugins: [{ name: "next" }],
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
        },
        null,
        2,
      ),
      "README.md":
        "# Bridge example - Next.js API route (lightnode-sdk)\n\n1. Set PRIVATE_KEY in `.env.local`\n2. `npm run dev`\n3. POST `/api/bridge` with `{ amount, recipient }`\n",
    };
  }
  // react
  return {
    "src/components/BridgeButton.tsx": snippet.body,
    "src/App.tsx": `import { BridgeButton } from "./components/BridgeButton";
export default function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 40 }}>
      <h1>LightNode Bridge - React + wagmi example</h1>
      <p>Wire your wagmi provider in main.tsx, then drop in the button:</p>
      <BridgeButton />
    </main>
  );
}`,
    "src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
// Wire wagmi here when you add your own RPC + WalletConnect projectId.`,
    "index.html": `<!doctype html>
<html><body><div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body></html>`,
    "package.json": JSON.stringify(
      {
        name: "lightnode-bridge-react-example",
        version: "0.0.0",
        private: true,
        type: "module",
        scripts: { dev: "vite", build: "vite build" },
        dependencies: {
          react: "^18.3.0",
          "react-dom": "^18.3.0",
          wagmi: "^2.0.0",
          viem: "^2.21.0",
          "lightnode-sdk": "^0.6.1",
        },
        devDependencies: { vite: "^5.0.0", "@vitejs/plugin-react": "^4.0.0", typescript: "^5.4.0" },
      },
      null,
      2,
    ),
    "tsconfig.json": JSON.stringify(
      { compilerOptions: { target: "ES2020", jsx: "react-jsx", module: "ESNext", moduleResolution: "bundler", strict: true } },
      null,
      2,
    ),
    "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()] });`,
    "README.md":
      "# Bridge example - React + wagmi (lightnode-sdk)\n\n1. Add your wagmi config in src/main.tsx\n2. `npm run dev`\n",
  };
}

function openInStackBlitz(snippet: BridgeSnippet, tmpl: BridgeTemplate) {
  sdk.openProject(
    {
      title: `LightNode Bridge - ${tmpl}`,
      description: `Bridge LCAI from Ethereum to LightChain using lightnode-sdk (${tmpl} template)`,
      template: "node",
      files: bridgeStackBlitzFiles(snippet, tmpl),
    },
    { openFile: snippet.file },
  );
}

/**
 * Open ANY card's snippet in a one-file Node sandbox on StackBlitz. Used by
 * the cards that don't have multi-template integration shapes (DAO,
 * Conversation, preflight, dispute, models). Visitor lands in a real
 * WebContainer with the snippet as index.ts, deps installed, .env stub,
 * and "npm start" wired to run it.
 */
function openSnippetInStackBlitz(opts: {
  /** Module display name, e.g. "DAO SDK", used in the project title. */
  title: string;
  /** Plain TypeScript body of the snippet (no leading slashes, no markdown). */
  snippet: string;
  /** Whether this snippet calls anything that needs a wallet (PRIVATE_KEY env). */
  needsPrivateKey?: boolean;
}) {
  const pkg = {
    name: `lightnode-${opts.title.toLowerCase().replace(/\s+sdk\b/, "").replace(/\W+/g, "-")}-example`,
    version: "0.0.0",
    private: true,
    type: "module" as const,
    scripts: { start: opts.needsPrivateKey ? "tsx --env-file=.env index.ts" : "tsx index.ts" },
    dependencies: { "lightnode-sdk": "^0.6.2", viem: "^2.21.0" },
    devDependencies: { tsx: "^4.19.0" },
  };
  const files: Record<string, string> = {
    "index.ts": opts.snippet,
    "package.json": JSON.stringify(pkg, null, 2),
    "README.md": `# ${opts.title} example (lightnode-sdk)\n\n${
      opts.needsPrivateKey
        ? "1. Put a funded private key in `.env`:\n   ```\n   PRIVATE_KEY=0xYOUR_KEY\n   ```\n2. Click the green Start button - it runs `npm start`.\n"
        : "Click the green Start button - it runs `npm start`. No env vars needed; this snippet is read-only.\n"
    }`,
  };
  if (opts.needsPrivateKey) {
    files[".env"] = "# Replace with a funded EVM private key.\nPRIVATE_KEY=0xYOUR_KEY_HERE\n";
  }
  sdk.openProject(
    {
      title: `LightNode - ${opts.title}`,
      description: `Try ${opts.title} from lightnode-sdk in a runnable StackBlitz WebContainer.`,
      template: "node",
      files,
    },
    { openFile: "index.ts" },
  );
}

function BridgeRecipe() {
  const [amount, setAmount] = useState<string>("100");
  const [direction, setDirection] = useState<BridgeDirection>("eth-to-lc");
  const [recipient, setRecipient] = useState<string>("");
  const [tmpl, setTmpl] = useState<BridgeTemplate>("node");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BridgePreviewResp | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const numericAmt = Number(amount) || 0;
  const snippet = bridgeSnippet(tmpl, amount, direction);

  async function runPreview() {
    setBusy(true);
    setPreviewErr(null);
    setPreview(null);
    try {
      const res = await fetch("/api/bridge-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, direction, recipient: recipient || undefined }),
      });
      const text = await res.text();
      let json: BridgePreviewResp;
      try {
        json = JSON.parse(text) as BridgePreviewResp;
      } catch {
        setPreviewErr("The server returned an unexpected response. Try again.");
        return;
      }
      if (!res.ok || json.error) {
        setPreviewErr(json.error ?? "Preview failed.");
        return;
      }
      setPreview(json);
    } catch (e) {
      setPreviewErr(humanizeError(e, { action: "the bridge preview" }));
    } finally {
      setBusy(false);
    }
  }

  const fromChain = direction === "eth-to-lc"
    ? { label: "Ethereum", sub: "LCAI ERC-20", color: "from-sky-500 to-indigo-500" }
    : { label: "LightChain", sub: "native LCAI", color: "from-fuchsia-500 to-violet-500" };
  const toChain = direction === "eth-to-lc"
    ? { label: "LightChain", sub: "native LCAI", color: "from-fuchsia-500 to-violet-500" }
    : { label: "Ethereum", sub: "LCAI ERC-20", color: "from-sky-500 to-indigo-500" };
  const swapDirection = () => setDirection((d) => (d === "eth-to-lc" ? "lc-to-eth" : "eth-to-lc"));
  const feeShort = direction === "eth-to-lc" ? "0 ETH" : "0 LCAI";
  const sourceGas = direction === "eth-to-lc" ? "~$0.50-2 in ETH" : "<0.01 LCAI";

  return (
    <div className="space-y-4">
      {/* The main bridge swap card.
          Style tokens lifted directly from lightchain-protocol/bridge-ui:
            outer border:  rgba(112,100,233,0.24)
            inner border:  rgba(112,100,233,0.20)
            backgrounds:   #14152C (darker2), #070710 (dark), #1A1B38 (dark2)
            text:          #CCCEEF body, #7376AA muted
            accent:        #7064E9
            Continue gradient: 94deg, #dd00ac -> #7130c3 -> #410093 */}
      <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-[rgba(112,100,233,0.24)] shadow-[0_4px_18px_rgba(0,0,0,0.2)]">
        <div className="relative z-[2] rounded-t-xl bg-[#14152C] px-3 py-6">
          <h3 className="text-center text-2xl font-semibold leading-[1.3] text-[#CCCEEF]">LCAI Bridge</h3>
          <p className="mt-1 text-center text-[11px] uppercase tracking-wide text-[#7376AA]">
            Interactive preview - no spend, dry run
          </p>
        </div>
        <div className="bg-[#070710] px-4 py-6 sm:p-6">
          {/* Chain row */}
          <div className="relative grid grid-cols-2 gap-[33px] rounded-xl border border-[rgba(112,100,233,0.20)] bg-[rgba(204,206,239,0.02)] p-2.5">
            <ChainPill chain={fromChain} side="from" />
            <ChainPill chain={toChain} side="to" />
            <div className="absolute left-1/2 top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 rounded-md border-4 border-[#070710] sm:border-[6px]">
              <button
                type="button"
                onClick={swapDirection}
                className="flex size-8 items-center justify-center bg-[#1A1B38] transition-colors hover:bg-[#14152C] sm:size-[44px]"
                aria-label="Swap direction"
                title="Swap direction"
              >
                <ArrowLeftRight className="size-4 text-[#7064E9]" />
              </button>
            </div>
          </div>

          {/* Amount panel */}
          <div className="mt-4 rounded-lg border border-[rgba(112,100,233,0.20)] bg-[#14152C] p-4">
            <div className="flex items-center justify-between gap-2">
              <input
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-0 flex-1 border-none bg-transparent text-xl font-normal text-[#CCCEEF] outline-none placeholder:text-[#7376AA] sm:text-2xl"
                aria-label="Amount of LCAI to bridge"
              />
              <button
                type="button"
                onClick={() => setAmount("100")}
                className="flex h-6 min-w-[52px] items-center justify-center rounded-full bg-[#7064E9] px-3 text-xs font-semibold leading-none text-[#CCCEEF] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs leading-[18px] text-[#7376AA]">
              <span>LCAI</span>
              <span>
                Source-chain gas: <span className="text-[#CCCEEF]">{sourceGas}</span>
              </span>
            </div>
          </div>

          {/* Recipient */}
          <label className="mt-4 block">
            <span className="mb-1.5 block pl-0.5 text-sm text-[#7376AA]">
              Recipient (optional, destination address)
            </span>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-lg border border-[rgba(112,100,233,0.20)] bg-[#14152C] px-3 py-2.5 font-mono text-xs text-[#CCCEEF] outline-none transition-colors placeholder:text-[#7376AA] focus:border-[rgba(112,100,233,0.40)]"
              aria-label="Recipient address on the destination chain"
            />
          </label>

          {/* Fees + arrival */}
          <div className="mt-4 space-y-2 rounded-lg border border-[rgba(112,100,233,0.20)] bg-[#14152C] px-3 py-3 text-xs text-[#CCCEEF]">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[#7376AA]">
                <Coins className="size-3" />
                Hyperlane IGP fee
              </span>
              <span>
                <span className="font-semibold text-[#CCCEEF]">{feeShort}</span>{" "}
                <span className="text-[#7376AA]">(pre-paid)</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#7376AA]">Estimated arrival</span>
              <span className="text-[#CCCEEF]">~30 to 60 min</span>
            </div>
          </div>

          {/* Continue button - LCAI brand gradient (94deg, magenta -> purple -> deep) */}
          <button
            type="button"
            onClick={runPreview}
            disabled={busy || numericAmt <= 0}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-base font-semibold text-[#CCCEEF] shadow-[0_4px_12px_rgba(0,0,0,0.25)] transition-all duration-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background:
                "linear-gradient(94deg, #dd00ac 10.66%, #7130c3 53.03%, #410093 96.34%)",
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
            {busy ? "Running" : numericAmt > 0 ? `Preview bridging ${numericAmt} LCAI` : "Continue"}
          </button>
        </div>
      </div>

      {/* Result panel - mirrors CLI Runner shape */}
      {previewErr ? (
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-xs text-content-default">{previewErr}</div>
      ) : preview ? (
        <details open className="rounded-xl border border-bdr-soft bg-card/60">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-xs font-semibold text-content-primary">
            <span>Preview JSON</span>
            <span className="text-[10px] font-normal uppercase tracking-wide text-content-soft">
              same shape the SDK returns
            </span>
            <ChevronDown className="ml-auto size-3.5 text-content-soft transition-transform [details[open]>summary>&]:rotate-180" />
          </summary>
          <pre className="overflow-x-auto rounded-b-xl code-surface px-4 py-3 font-mono text-[11px] leading-relaxed text-content-default">
{JSON.stringify(preview, null, 2)}
          </pre>
        </details>
      ) : null}

      {/* Integration section */}
      <div className="rounded-2xl border border-bdr-soft bg-surface-base-faint p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm font-semibold text-content-primary">Use this in your project</span>
          <span className="ml-auto text-[10px] uppercase tracking-wide text-content-soft">pick your stack</span>
        </div>

        {/* Template chooser */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {BRIDGE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTmpl(t.id)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                tmpl === t.id
                  ? "border-primary/60 bg-primary/10 text-content-primary"
                  : "border-bdr-soft bg-card text-content-soft hover:text-content-primary"
              }`}
              aria-pressed={tmpl === t.id}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mb-2 text-[11px] text-content-soft">{BRIDGE_TEMPLATES.find((t) => t.id === tmpl)?.line}</p>

        {/* File hint + Open in StackBlitz */}
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-md bg-card px-2 py-1 text-[11px] text-content-default">
            <span className="text-content-soft">{snippet.fileHint}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openInStackBlitz(snippet, tmpl)}
            className="ml-auto"
          >
            <PlayCircle />
            Open in StackBlitz
          </Button>
        </div>

        {/* The actual TypeScript code (now honors `direction`) */}
        <CodeBox code={snippet.body} />

        {/* Setup commands so the user is not left wondering how to run it */}
        <div className="mt-3 mb-1.5 inline-flex items-center gap-2 rounded-md bg-card px-2 py-1 text-[11px] text-content-default">
          <Terminal className="size-3" />
          <span className="text-content-soft">Run these in your terminal (these ARE shell commands):</span>
        </div>
        <CodeBox code={snippet.setup} />
      </div>
    </div>
  );
}

/**
 * One side of the bridge swap card: a token-style pill that shows which
 * chain + which LCAI representation is on this side. Tuned to feel like
 * a swap dropdown without actually being one (direction is driven by the
 * center swap button).
 */
function ChainPill({ chain, side }: { chain: { label: string; sub: string; color: string }; side: "from" | "to" }) {
  const padding = side === "from" ? "pr-2 sm:pr-8" : "flex-row-reverse pl-2 sm:pl-8";
  return (
    <div className={`flex items-center gap-3 ${padding}`}>
      <div className={`grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br ${chain.color} text-white shadow-[0_4px_12px_-2px_rgba(0,0,0,0.4)]`}>
        <Coins className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold leading-tight text-[#CCCEEF]">{chain.label}</div>
        <div className="truncate text-xs text-[#7376AA]">{chain.sub}</div>
      </div>
    </div>
  );
}

// --- DAO live widget -------------------------------------------------------

interface DaoProposal {
  id: string;
  title: string;
  descriptionPreview: string;
  proposer: string;
  state: number;
  stateLabel: string;
  votesFor: string;
  votesAgainst: string;
  votesAbstain: string;
}

interface DaoListResp {
  addresses: { governor: string; explorer: string };
  proposals: DaoProposal[];
  error?: string;
}

const STATE_TONE: Record<string, "brand" | "success" | "warning" | "muted"> = {
  active: "brand",
  succeeded: "success",
  queued: "success",
  executed: "success",
  pending: "warning",
  defeated: "muted",
  canceled: "muted",
  expired: "muted",
};

function lcai(wei: string): string {
  try {
    const n = Number(BigInt(wei)) / 1e18;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    if (n >= 1) return n.toFixed(0);
    return n.toFixed(2);
  } catch {
    return "0";
  }
}

type DaoChainKey = "ethereum" | "lightchain";

function DaoLive() {
  const [chain, setChain] = useState<DaoChainKey>("ethereum");
  const [data, setData] = useState<DaoListResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    setErr(null);
    setOpenId(null);
    fetch(`/api/dao-proposals?chain=${chain}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: DaoListResp) => {
        if (!alive) return;
        if (j.error) setErr(j.error);
        else setData(j);
      })
      .catch((e) => alive && setErr(humanizeError(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [chain]);
  const chainToggle = (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-content-soft">Governor on</span>
      <div className="inline-flex rounded-md border border-bdr-soft bg-surface-base-faint p-0.5">
        {(["ethereum", "lightchain"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setChain(k)}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
              chain === k ? "bg-card text-content-primary shadow" : "text-content-soft hover:text-content-primary",
            )}
          >
            {k === "ethereum" ? "Ethereum" : "LightChain"}
          </button>
        ))}
      </div>
    </div>
  );

  const intro = (
    <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3 text-[11px] leading-relaxed text-content-default">
      {chain === "ethereum" ? (
        <>
          <p className="mb-1">
            <span className="font-medium text-content-primary">LCAIGovernor</span> on Ethereum mainnet. Token holders
            wrap LCAI ERC-20 into <code className="font-mono">LCAI-Ballots</code> (IVotes) at{" "}
            <a href="https://ballots.lightchain.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              ballots.lightchain.ai
            </a>{" "}
            to vote / propose. Proposal threshold: <span className="font-medium">140,000 LCAI</span> wrapped. 24h
            voting delay, ~14d voting period.
          </p>
        </>
      ) : (
        <>
          <p className="mb-1">
            <span className="font-medium text-content-primary">LightChainGovernor</span> on LightChain mainnet (chain
            9200). Uses the <code className="font-mono">NativeVotes</code> precompile so native LCAI itself acts as the
            voting token, no wrapping needed. Live at{" "}
            <a href="https://dao.lightchain.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              dao.lightchain.ai
            </a>.
          </p>
        </>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {chainToggle}
        {intro}
        <p className="flex items-center gap-2 text-xs text-content-soft">
          <Loader2 className="size-3.5 animate-spin" /> Reading governor on {chain === "ethereum" ? "Ethereum" : "LightChain mainnet"}…
        </p>
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className="space-y-3">
        {chainToggle}
        {intro}
        <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-content-default">
          Couldn&apos;t reach the Governor right now. {err ?? ""}
        </p>
      </div>
    );
  }
  if (data.proposals.length === 0) {
    return (
      <div className="space-y-3">
        {chainToggle}
        {intro}
        <p className="rounded-md border border-bdr-soft bg-surface-base-faint px-3 py-2 text-xs text-content-soft">
          No proposals indexed in the recent window. Governor at{" "}
          <a href={`${data.addresses.explorer}/address/${data.addresses.governor}`} className="font-mono text-primary hover:underline" target="_blank" rel="noopener noreferrer">
            {data.addresses.governor.slice(0, 10)}…{data.addresses.governor.slice(-6)}
          </a>
          .
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {chainToggle}
      {intro}
      <p className="text-[11px] text-content-soft">Click a row to expand.</p>
      {data.proposals.map((p) => {
        const isOpen = openId === p.id;
        return (
          <div key={p.id} className="rounded-xl border border-bdr-soft bg-surface-base-faint">
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : p.id)}
              className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-card/60"
            >
              <Badge tone={STATE_TONE[p.stateLabel] ?? "muted"}>{p.stateLabel}</Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-content-primary">{p.title}</div>
                <div className="font-mono text-[10px] text-content-soft">id {p.id.slice(0, 12)}…</div>
              </div>
              <div className="text-right font-mono text-[10px] text-content-soft">
                For {lcai(p.votesFor)} | Against {lcai(p.votesAgainst)}
              </div>
              <ChevronDown className={cn("size-4 text-content-soft transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen ? (
              <div className="space-y-2 border-t border-bdr-soft px-3 py-3 text-[11px]">
                <p className="leading-relaxed text-content-default">{p.descriptionPreview}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-content-soft">
                  <span>proposer <code className="font-mono text-content-default">{p.proposer.slice(0, 8)}…{p.proposer.slice(-4)}</code></span>
                  <span>For <code className="font-mono text-content-default">{lcai(p.votesFor)}</code></span>
                  <span>Against <code className="font-mono text-content-default">{lcai(p.votesAgainst)}</code></span>
                  <span>Abstain <code className="font-mono text-content-default">{lcai(p.votesAbstain)}</code></span>
                </div>
                <a href={`https://dao.lightchain.ai/proposal/${p.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Open in DAO UI <ExternalLink className="size-3" />
                </a>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// --- Preflight & generic widgets ------------------------------------------

function PreflightSample() {
  const sample = `{
  "verdict": "ok",
  "elapsedSec": 9.4,
  "worker": "0xabc...",
  "summary": "OK in 9.4s. Worker 0xabc... replied with 14 chars.",
  "txs": {
    "createSession": "0x...",
    "submitJob":     "0x...",
    "jobCompleted":  "0x..."
  }
}`;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-content-soft">
        Preflight runs against the live network with YOUR private key, so it can&apos;t fire from the browser. Sample
        output:
      </p>
      <CodeBox code={sample} />
      <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3 text-[11px] text-content-default">
        Run it locally:{" "}
        <code className="font-mono">PRIVATE_KEY=0x... npx lightnode worker preflight --net testnet</code>
      </div>
    </div>
  );
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface ChatDemoResponse {
  answer?: string;
  jobId?: string;
  worker?: string;
  remaining?: number;
  error?: string;
  runLocally?: boolean;
  howTo?: string;
}

function ChatSample() {
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [howTo, setHowTo] = useState<string | null>(null);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setErr(null);
    setHowTo(null);
    const next: ChatTurn = { role: "user", content: text };
    const newHistory = [...history, next];
    setHistory(newHistory);
    setDraft("");
    try {
      const res = await fetch("/api/chat-demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      // Vercel Hobby tier caps functions at 10s and returns an HTML error
      // body (not JSON) when the inference exceeds that. Parse defensively
      // so the widget tells the user something useful instead of crashing
      // on JSON.parse.
      const raw = await res.text();
      let json: ChatDemoResponse = {};
      try {
        json = JSON.parse(raw) as ChatDemoResponse;
      } catch {
        const looksLikeTimeout = /FUNCTION_INVOCATION_TIMEOUT/i.test(raw);
        setErr(
          looksLikeTimeout
            ? "The worker took longer than this demo allows (10s server budget). Try again - the next inference usually lands in 5-8s. For unlimited tries, open the playground or run the example locally."
            : `Demo failed (${res.status}). Try again, or run the example locally.`,
        );
        setHistory(history);
        return;
      }
      if (!res.ok || !json.answer) {
        setErr(json.error ?? `Demo failed (${res.status})`);
        if (json.howTo) setHowTo(json.howTo);
        setHistory(history);
        return;
      }
      setHistory((h) => [...h, { role: "assistant", content: json.answer ?? "" }]);
    } catch (e) {
      setErr(humanizeError(e));
      setHistory(history);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-content-soft">
        Type a message. The server fires one real encrypted testnet inference per turn (free LCAI from the faucet),
        rate-limited to 3 per hour per IP so the demo stays available. For your own keys + mainnet, use the runnable
        example.
      </p>

      {history.length > 0 ? (
        <div className="max-h-[260px] space-y-2 overflow-y-auto rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
          {history.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed",
                  m.role === "user" ? "bg-primary/15 text-content-primary" : "bg-card text-content-default",
                )}
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending ? (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-card px-3 py-2">
                <Loader2 className="size-3.5 animate-spin text-content-soft" />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Try: Reply with a one-sentence fun fact."
          className="flex-1 resize-none rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 text-xs text-content-primary outline-none transition-colors focus:border-primary/60"
        />
        <Button size="sm" onClick={() => void send()} disabled={!draft.trim() || sending}>
          {sending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
          Send
        </Button>
      </div>

      {err ? (
        <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-content-default">
          {err}
        </p>
      ) : null}
      {howTo ? <CodeBox code={howTo} /> : null}

      {history.length > 0 ? (
        <button
          type="button"
          onClick={() => setHistory([])}
          className="text-[11px] text-content-soft hover:text-content-primary"
        >
          Clear conversation
        </button>
      ) : null}
    </div>
  );
}

interface JobStatusResp {
  id?: string;
  raw?: string;
  category?: string;
  worker?: string | null;
  model?: string | null;
  submittedAt?: number | null;
  completedAt?: number | null;
  workerShareLcai?: number;
  refundable?: boolean;
  jobId?: string;
  status?: string;
  error?: string;
}

function DisputeSample() {
  type Net = "mainnet" | "testnet";
  const [net, setNet] = useState<Net>("mainnet");
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JobStatusResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function lookup() {
    if (!jobId.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/sdk-demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "job", net, arg: jobId.trim() }),
      });
      const json = (await res.json()) as JobStatusResp;
      if (!res.ok) setErr(json.error ?? `Lookup failed (${res.status})`);
      else setResult(json);
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  const cat = result?.category ?? result?.status ?? "";
  const catTone =
    cat === "completed" ? "text-success" :
    cat === "stalled" || cat === "disputed" ? "text-warning" :
    cat === "in-flight" || cat === "submitted" ? "text-primary" :
    "text-content-soft";

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-content-soft">
        Paste a real job id from{" "}
        <a href="https://mainnet.lightscan.app" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          lightscan
        </a>{" "}
        to see <code className="font-mono text-content-default">ln.getJobStatus(jobId)</code>&apos;s classification.
        The job-id is the numeric id from a JobSubmitted event (or a job&apos;s detail page).
      </p>

      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-content-soft">network</span>
        <div className="inline-flex rounded-md border border-bdr-soft bg-surface-base-faint p-0.5">
          {(["mainnet", "testnet"] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNet(n)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                net === n ? "bg-card text-content-primary shadow" : "text-content-soft hover:text-content-primary",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <input
          type="text"
          value={jobId}
          onChange={(e) => setJobId(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void lookup();
            }
          }}
          placeholder="job id (e.g. 1234)"
          className="flex-1 rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-xs text-content-primary outline-none transition-colors focus:border-primary/60"
        />
        <Button size="sm" onClick={() => void lookup()} disabled={!jobId.trim() || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}
          Look up
        </Button>
      </div>

      {err ? (
        <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-content-default">{err}</p>
      ) : null}

      {result ? (
        <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
          {result.category ? (
            <>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-content-soft">job</span>
                <code className="font-mono text-[11px] text-content-default">#{result.id}</code>
                <span className={cn("ml-auto text-[11px] font-medium uppercase tracking-wide", catTone)}>
                  {result.category}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <dt className="text-content-soft">raw state</dt>
                <dd className="text-right font-mono text-content-default">{result.raw ?? "-"}</dd>
                <dt className="text-content-soft">refundable</dt>
                <dd className={cn("text-right font-mono font-semibold", result.refundable ? "text-warning" : "text-content-soft")}>
                  {result.refundable ? "true" : "false"}
                </dd>
                <dt className="text-content-soft">worker</dt>
                <dd className="text-right font-mono text-content-default">
                  {result.worker ? `${result.worker.slice(0, 8)}…${result.worker.slice(-6)}` : "-"}
                </dd>
                <dt className="text-content-soft">model</dt>
                <dd className="text-right font-mono text-content-default">
                  {result.model ? `${result.model.slice(0, 10)}…` : "-"}
                </dd>
                <dt className="text-content-soft">worker share</dt>
                <dd className="text-right font-mono text-content-default">
                  {(result.workerShareLcai ?? 0).toFixed(4)} LCAI
                </dd>
                <dt className="text-content-soft">submitted at</dt>
                <dd className="text-right font-mono text-content-default">
                  {result.submittedAt ? new Date(result.submittedAt * 1000).toISOString().slice(0, 16).replace("T", " ") : "-"}
                </dd>
                <dt className="text-content-soft">completed at</dt>
                <dd className="text-right font-mono text-content-default">
                  {result.completedAt ? new Date(result.completedAt * 1000).toISOString().slice(0, 16).replace("T", " ") : "-"}
                </dd>
              </dl>
            </>
          ) : (
            <p className="text-[11px] text-content-soft">
              Job <code className="font-mono">#{result.jobId}</code> not indexed yet (state:{" "}
              <code className="font-mono">{result.status}</code>).
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ModelsExplainer() {
  type Net = "mainnet" | "testnet";
  interface ModelRow {
    name: string;
    fee?: string;
    max_output_tokens?: number;
    is_whitelisted?: boolean;
    is_enabled?: boolean;
  }
  const [net, setNet] = useState<Net>("mainnet");
  const [rows, setRows] = useState<ModelRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRows(null);
    setErr(null);
    fetch("/api/sdk-demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "models", net }),
    })
      .then((r) => r.json())
      .then((j: ModelRow[] | { error?: string }) => {
        if (!alive) return;
        if (Array.isArray(j)) setRows(j);
        else setErr((j as { error?: string }).error ?? "fetch failed");
      })
      .catch((e) => alive && setErr(humanizeError(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [net]);

  const lcai = (wei?: string) => {
    if (!wei) return "-";
    try {
      return (Number(BigInt(wei)) / 1e18).toFixed(3) + " LCAI";
    } catch {
      return "-";
    }
  };

  return (
    <div className="space-y-3 text-[11px] leading-relaxed text-content-default">
      <p className="text-content-soft">
        The official LightChain model registry is the{" "}
        <code className="font-mono text-content-default">AIConfig</code> contract. The read-only{" "}
        <code className="font-mono text-content-default">LightNode</code> client wraps it -{" "}
        <code className="font-mono text-content-default">ln.getModels()</code> is what built the table below right
        now:
      </p>

      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-content-soft">network</span>
        <div className="inline-flex rounded-md border border-bdr-soft bg-surface-base-faint p-0.5">
          {(["mainnet", "testnet"] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNet(n)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                net === n ? "bg-card text-content-primary shadow" : "text-content-soft hover:text-content-primary",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-content-soft">
          <span className="size-1.5 animate-pulse rounded-full bg-success" />
          Whitelisted on {net} via ln.getModels()
        </div>
        {loading ? (
          <p className="flex items-center gap-2 text-[11px] text-content-soft">
            <Loader2 className="size-3.5 animate-spin" /> Reading AIConfig…
          </p>
        ) : err ? (
          <p className="rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 text-[11px] text-content-default">
            {err}
          </p>
        ) : !rows || rows.length === 0 ? (
          <p className="text-[11px] text-content-soft">No models registered.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="text-content-soft">
              <tr>
                <th className="pb-1 text-left font-medium">Model</th>
                <th className="pb-1 text-right font-medium">Fee per job</th>
                <th className="pb-1 text-right font-medium">Max output</th>
                <th className="pb-1 text-right font-medium">Live</th>
              </tr>
            </thead>
            <tbody className="font-mono text-content-default">
              {rows.map((m) => (
                <tr key={m.name} className="border-t border-bdr-soft/40">
                  <td className="py-1">{m.name}</td>
                  <td className="py-1 text-right">{lcai(m.fee)}</td>
                  <td className="py-1 text-right">{m.max_output_tokens?.toLocaleString() ?? "-"}</td>
                  <td className="py-1 text-right">
                    {m.is_whitelisted && m.is_enabled ? (
                      <span className="text-success">yes</span>
                    ) : (
                      <span className="text-content-soft">off</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-content-soft">
          AIConfig (model registry) addresses
        </div>
        <ul className="space-y-1.5">
          {(["mainnet", "testnet"] as const).map((n) => {
            const cfg = NETWORKS[n];
            const addr = cfg.aiConfig;
            return (
              <li key={n} className="flex items-start gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                <span>
                  <span className="text-content-soft">{cfg.label} (chain {cfg.chainId}):</span>{" "}
                  <a
                    href={`${cfg.explorer}/address/${addr}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline"
                  >
                    {addr.slice(0, 10)}…{addr.slice(-6)}
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[10px] text-content-soft">
          For the live whitelist, you can also call the chain&apos;s custom{" "}
          <code className="font-mono">lcai_listSupportedModels</code> RPC method directly.
        </p>
      </div>

      <p className="text-content-soft">
        Try it now: use the &quot;Run a CLI command&quot; widget above, pick{" "}
        <code className="font-mono text-content-default">lightnode models</code>, hit Run.
      </p>
    </div>
  );
}

export function Widget({ id }: { id: ModuleId }) {
  if (id === "bridge") return <BridgeLive />;
  if (id === "dao") return <DaoLive />;
  if (id === "preflight") return <PreflightSample />;
  if (id === "chat") return <ChatSample />;
  if (id === "dispute") return <DisputeSample />;
  return <ModelsExplainer />;
}

// --- The module grid -------------------------------------------------------

export function SDKModules() {
  const [openId, setOpenId] = useState<ModuleId | null>(null);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {MODULES.map((m) => {
        const isOpen = openId === m.id;
        return (
          <Card key={m.id} className="overflow-hidden">
            <div className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <m.icon className="size-4 text-primary" />
                <span className="text-sm font-semibold text-content-primary">{m.title}</span>
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-success" title="Shipped in lightnode-sdk@0.6.x">
                  <span className="size-1.5 rounded-full bg-success" /> in 0.6.x
                </span>
              </div>
              <p className="text-xs leading-relaxed text-content-soft">{m.blurb}</p>
              <CodeBox code={m.snippet} />
              <DocLinks m={m} />
              <Button
                size="sm"
                variant={isOpen ? "outline" : "default"}
                className="mt-3 w-full"
                onClick={() => setOpenId(isOpen ? null : m.id)}
              >
                {m.triable ? (
                  isOpen ? (
                    <>
                      Hide <ChevronDown className="rotate-180" />
                    </>
                  ) : (
                    <>
                      Try it live <ArrowRight />
                    </>
                  )
                ) : isOpen ? (
                  <>
                    Hide details <ChevronDown className="rotate-180" />
                  </>
                ) : (
                  <>
                    See how to use it <ArrowRight />
                  </>
                )}
              </Button>
            </div>
            {isOpen ? (
              <div className="border-t border-bdr-soft bg-surface-base-subtle p-4">
                <Widget id={m.id} />
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
