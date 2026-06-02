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

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import {
  ArrowLeft,
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
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { ConnectButton } from "@/components/connect-button";
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
    "inline-flex items-center gap-1.5 rounded-full border border-bdr-soft bg-surface-base-faint px-3 py-1.5 text-xs text-content-soft transition-colors hover:border-bdr-light hover:text-content-primary";
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
          className="group inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_0_18px_-4px_rgba(112,100,233,0.7)] transition-all duration-300 hover:shadow-[0_0_24px_-2px_rgba(221,0,172,0.55)]"
          style={{ background: "linear-gradient(94deg, #7064E9 0%, #9333ea 60%, #dd00ac 100%)" }}
          aria-label={`Open ${m.title} in StackBlitz`}
        >
          <PlayCircle className="size-3 transition-transform group-hover:scale-110" />
          Open in StackBlitz
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
          dependencies: { "lightnode-sdk": "^0.7.2", viem: "^2.21.0" },
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
            "lightnode-sdk": "^0.7.2",
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
          "lightnode-sdk": "^0.7.2",
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
export function openSnippetInStackBlitz(opts: {
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
    dependencies: { "lightnode-sdk": "^0.7.2", viem: "^2.21.0" },
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

// --- Bridge stepper --------------------------------------------------------
// 3-step focused flow. Replaces a single dense form with: direction ->
// amount -> integrate. Reference content (route addresses, exported API)
// lives below the stepper.

type BridgeStep = 1 | 2 | 3;

interface ChainBrand {
  key: "ethereum" | "lightchain";
  label: string;
  sub: string;
  logo: string;
}

const CHAIN_BRAND: Record<ChainBrand["key"], ChainBrand> = {
  ethereum: { key: "ethereum", label: "Ethereum", sub: "LCAI ERC-20", logo: "/logos/eth.svg" },
  lightchain: { key: "lightchain", label: "LightChain", sub: "native LCAI", logo: "/logos/lcai.png" },
};

function ChainAvatar({ logo, label, size = 36 }: { logo: string; label: string; size?: number }) {
  // No background chip - the LCAI orb + Ethereum mark each carry their own
  // transparent canvas, so a dark navy wrapper just adds noise around them.
  return (
    <Image
      src={logo}
      alt={label}
      width={size}
      height={size}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}

function DirectionTile({
  from,
  to,
  selected,
  onClick,
}: {
  from: ChainBrand;
  to: ChainBrand;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-xl border bg-card p-5 text-left transition-all hover:-translate-y-0.5 ${
        selected
          ? "border-primary shadow-[0_0_0_1px_#7064E9_inset]"
          : "border-bdr-soft hover:border-bdr-light"
      }`}
      aria-pressed={selected}
    >
      <ChainAvatar logo={from.logo} label={from.label} size={36} />
      <ArrowRight className="size-4 shrink-0 text-content-soft transition-colors group-hover:text-primary" />
      <ChainAvatar logo={to.logo} label={to.label} size={36} />
      <div className="ml-auto min-w-0 text-right">
        <div className="truncate text-sm font-semibold text-content-primary">{from.label} to {to.label}</div>
        <div className="truncate text-xs text-content-soft">{from.sub} to {to.sub}</div>
      </div>
    </button>
  );
}

function StepDot({ n, current, label }: { n: number; current: BridgeStep; label: string }) {
  const isDone = current > n;
  const isCurrent = current === n;
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        {/* Animated pulse halo on the current step. Pure CSS, GPU-friendly. */}
        {isCurrent ? (
          <span
            aria-hidden
            className="absolute inset-0 -m-1 animate-ping rounded-full bg-primary/40"
            style={{ animationDuration: "2s" }}
          />
        ) : null}
        <div
          className={`relative grid size-8 place-items-center rounded-full text-xs font-semibold transition-all duration-300 ${
            isCurrent
              ? "bg-gradient-to-br from-[#7064E9] to-[#5a4fd6] text-white shadow-[0_0_16px_-2px_rgba(112,100,233,0.5)]"
              : isDone
                ? "bg-primary/25 text-content-primary"
                : "bg-surface-base-faint text-content-soft"
          }`}
        >
          {isDone ? <Check className="size-3.5" /> : n}
        </div>
      </div>
      <span
        className={`hidden text-sm font-medium transition-colors sm:inline ${
          isCurrent ? "text-content-primary" : isDone ? "text-content-primary/70" : "text-content-soft"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

/** Connector line between two step dots. Fills with the brand purple as
 *  progress moves past the previous step. */
function StepConnector({ filled }: { filled: boolean }) {
  return (
    <div className="relative h-px flex-1 overflow-hidden">
      <div className="absolute inset-0 bg-primary/15" />
      <div
        className={`absolute inset-y-0 left-0 bg-gradient-to-r from-[#7064E9] to-[#7064E9]/40 transition-all duration-500 ${
          filled ? "w-full" : "w-0"
        }`}
      />
    </div>
  );
}

/** Pill-style Back button. Bigger affordance than a bare text link, with a
 *  hover state that matches the brand accent. */
function StepBack({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-bdr-soft bg-surface-base-faint px-3 py-1.5 text-xs font-medium text-content-primary transition-all hover:-translate-x-0.5 hover:border-primary/60 hover:bg-primary/10 hover:shadow-[0_0_12px_-4px_rgba(112,100,233,0.8)]"
    >
      <ArrowLeft className="size-3.5" /> Back
    </button>
  );
}

function BridgeRecipe() {
  const [step, setStep] = useState<BridgeStep>(1);
  const [direction, setDirection] = useState<BridgeDirection>("eth-to-lc");
  const [amount, setAmount] = useState<string>("100");
  const [recipient, setRecipient] = useState<string>("");
  const [tmpl, setTmpl] = useState<BridgeTemplate>("node");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BridgePreviewResp | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const numericAmt = Number(amount) || 0;
  const snippet = bridgeSnippet(tmpl, amount, direction);
  const fromChain = direction === "eth-to-lc" ? CHAIN_BRAND.ethereum : CHAIN_BRAND.lightchain;
  const toChain = direction === "eth-to-lc" ? CHAIN_BRAND.lightchain : CHAIN_BRAND.ethereum;
  const sourceUnit = direction === "eth-to-lc" ? "ETH" : "LCAI";
  const sourceGas = direction === "eth-to-lc" ? "~$0.50-2 in ETH" : "<0.01 LCAI";

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

  return (
    <div className="space-y-6">
      {/* Step indicator with animated pulse + gradient progress connectors */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:gap-4">
        <StepDot n={1} current={step} label="Direction" />
        <StepConnector filled={step > 1} />
        <StepDot n={2} current={step} label="Amount" />
        <StepConnector filled={step > 2} />
        <StepDot n={3} current={step} label="Use it" />
      </div>

      {/* Step card */}
      <div className="rounded-xl border border-bdr-soft bg-card p-6 sm:p-8">
        {step === 1 ? (
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Choose direction</h3>
            <p className="mt-1 text-sm text-content-soft">Where is your LCAI now, and where do you want it to go.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <DirectionTile
                from={CHAIN_BRAND.ethereum}
                to={CHAIN_BRAND.lightchain}
                selected={direction === "eth-to-lc"}
                onClick={() => { setDirection("eth-to-lc"); setStep(2); }}
              />
              <DirectionTile
                from={CHAIN_BRAND.lightchain}
                to={CHAIN_BRAND.ethereum}
                selected={direction === "lc-to-eth"}
                onClick={() => { setDirection("lc-to-eth"); setStep(2); }}
              />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <StepBack onClick={() => setStep(1)} />
            <h3 className="text-2xl font-semibold tracking-tight text-content-primary">How much</h3>
            <p className="mt-1 text-sm text-content-soft">
              Bridging <span className="text-content-primary">{fromChain.label}</span> to{" "}
              <span className="text-content-primary">{toChain.label}</span>.
            </p>

            <div className="mt-6 rounded-lg border border-bdr-soft bg-surface-base-faint p-4">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-0 flex-1 border-none bg-transparent text-2xl font-normal text-content-primary outline-none placeholder:text-content-soft sm:text-3xl"
                  aria-label="Amount of LCAI to bridge"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setAmount("100")}
                  className="flex h-7 min-w-[52px] items-center justify-center rounded-full bg-primary px-3 text-xs font-semibold text-content-primary transition-colors hover:opacity-90"
                >
                  Reset
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-content-soft">
                <span>LCAI</span>
                <span>Source-chain gas: <span className="text-content-primary">{sourceGas}</span></span>
              </div>
            </div>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs text-content-soft">Recipient (optional)</span>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x... destination address"
                className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2.5 font-mono text-xs text-content-primary outline-none placeholder:text-content-soft focus:border-bdr-light"
              />
            </label>

            <div className="mt-4 grid gap-1 rounded-lg border border-bdr-soft bg-surface-base-faint p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-content-soft">Hyperlane IGP fee</span>
                <span className="text-content-primary">0 {sourceUnit} <span className="text-content-soft">(pre-paid)</span></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-content-soft">Estimated arrival</span>
                <span className="text-content-primary">~30 to 60 min</span>
              </div>
            </div>

            <button
              type="button"
              onClick={runPreview}
              disabled={busy || numericAmt <= 0}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-base font-semibold text-white shadow-[0_4px_12px_rgba(0,0,0,0.25)] transition-all duration-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "linear-gradient(94deg, #dd00ac 10.66%, #7130c3 53.03%, #410093 96.34%)" }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? "Running preview" : numericAmt > 0 ? `Preview bridging ${numericAmt} LCAI` : "Enter an amount"}
            </button>

            {previewErr ? (
              <p className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-content-default">{previewErr}</p>
            ) : null}

            {preview ? (
              <div className="mt-6 rounded-lg border border-bdr-soft bg-surface-base-faint p-4">
                <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-content-soft">SDK preview</p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-content-soft">Route</span>
                    <span className="text-content-primary">{fromChain.label} -&gt; {toChain.label}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-content-soft">Amount</span>
                    <span className="text-content-primary">{preview.amountLcai} LCAI</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-content-soft">Fee</span>
                    <span className="text-content-primary">0 {sourceUnit} <span className="text-content-soft">(pre-paid IGP)</span></span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-content-soft">Arrives in</span>
                    <span className="text-content-primary">{preview.estimatedRelayMinutes} min</span>
                  </div>
                </div>
                <details className="mt-3 rounded-lg border border-bdr-soft bg-card">
                  <summary className="cursor-pointer px-3 py-2 text-[11px] text-content-soft hover:text-content-primary">
                    Show raw JSON
                  </summary>
                  <pre className="overflow-x-auto border-t border-bdr-soft px-3 py-2 font-mono text-[11px] text-content-primary">
{JSON.stringify(preview, null, 2)}
                  </pre>
                </details>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="group mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-base font-semibold text-white shadow-[0_4px_18px_-4px_rgba(112,100,233,0.6)] transition-all duration-500 active:scale-95"
                  style={{ background: "linear-gradient(94deg, #7064E9 10%, #5a4fd6 60%, #410093 100%)" }}
                >
                  Get the code for your project
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <StepBack onClick={() => setStep(2)} />
            <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Use it in your project</h3>
            <p className="mt-1 text-sm text-content-soft">Pick your stack. We give you a runnable example you can paste in.</p>

            <div className="mt-5 flex flex-wrap gap-2">
              {BRIDGE_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTmpl(t.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    tmpl === t.id
                      ? "border-primary bg-primary/15 text-content-primary"
                      : "border-bdr-soft bg-surface-base-faint text-content-soft hover:text-content-primary"
                  }`}
                  aria-pressed={tmpl === t.id}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-content-soft">{BRIDGE_TEMPLATES.find((t) => t.id === tmpl)?.line}</p>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2.5 text-xs text-content-primary">
              <span className="truncate text-content-soft">{snippet.fileHint}</span>
              <button
                type="button"
                onClick={() => openInStackBlitz(snippet, tmpl)}
                className="group inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold text-white shadow-[0_0_18px_-4px_rgba(112,100,233,0.7)] transition-all duration-300 hover:shadow-[0_0_24px_-2px_rgba(221,0,172,0.55)]"
                style={{ background: "linear-gradient(94deg, #7064E9 0%, #9333ea 60%, #dd00ac 100%)" }}
              >
                <PlayCircle className="size-3.5 transition-transform group-hover:scale-110" />
                Open in StackBlitz
              </button>
            </div>

            <div className="mt-3">
              <CodeBox code={snippet.body} />
            </div>

            <details className="mt-4 rounded-lg border border-bdr-soft bg-surface-base-faint">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-content-soft hover:text-content-primary">
                <Terminal className="size-3" /> Terminal setup commands
              </summary>
              <div className="border-t border-bdr-soft p-3">
                <CodeBox code={snippet.setup} />
              </div>
            </details>
          </div>
        ) : null}
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
  total?: number;
  hasMore?: boolean;
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
  // Pagination: bumped by 'See more'. Reset on chain switch.
  const [limit, setLimit] = useState(6);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    setErr(null);
    setOpenId(null);
    setLimit(6);
    fetch(`/api/dao-proposals?chain=${chain}&limit=6`, { cache: "no-store" })
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

  async function loadMore() {
    const next = Math.min(30, limit + 6);
    setLoadingMore(true);
    setErr(null);
    try {
      const r = await fetch(`/api/dao-proposals?chain=${chain}&limit=${next}`, { cache: "no-store" });
      const j: DaoListResp = await r.json();
      if (j.error) setErr(j.error);
      else {
        setData(j);
        setLimit(next);
      }
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setLoadingMore(false);
    }
  }
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

      {/* See more button: when the API reported more proposals than the
          current page shows, give the visitor a way to keep loading
          (capped at 30 per chain to keep RPC pressure modest). */}
      {data.hasMore || (data.total != null && data.total > data.proposals.length) ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore || limit >= 30}
          className="group inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-bdr-soft bg-surface-base-faint px-4 py-2.5 text-xs font-medium text-content-primary transition-all hover:border-primary/60 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronDown className="size-3.5" />}
          {loadingMore
            ? "Loading more..."
            : limit >= 30
              ? "Page limit reached (30)"
              : `See more proposals${data.total ? ` (${data.proposals.length} of ${data.total})` : ""}`}
        </button>
      ) : null}
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
  if (id === "dao") return <DaoRecipe />;
  if (id === "chat") return <ChatRecipe />;
  if (id === "inference") return <InferenceRecipe />;
  if (id === "operator") return <OperatorRecipe />;
  return null;
}

function OperatorExplainer() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-content-soft">
      <p>
        <code className="font-mono text-content-default">WorkerOperator</code> runs a worker&apos;s on-chain lifecycle
        from code, over plain RPC, with no Docker and no worker image. Reads (<code className="font-mono text-content-default">status</code>,{" "}
        <code className="font-mono text-content-default">config</code>, <code className="font-mono text-content-default">getJob</code>,{" "}
        <code className="font-mono text-content-default">canDeregister</code>) need no key; the rest sign with the worker key.
      </p>
      <ul className="space-y-2 pl-4">
        <li className="list-disc"><span className="text-content-primary">Stuck-job recovery.</span> <code className="font-mono text-content-default">claimTimeout</code> / <code className="font-mono text-content-default">clearStuck</code> / <code className="font-mono text-content-default">unstickAndDeregister</code> time out acknowledged-but-unfinished jobs that block deregister. No other tool exposes this.</li>
        <li className="list-disc"><span className="text-content-primary">Settle + exit.</span> <code className="font-mono text-content-default">releaseAll</code>, <code className="font-mono text-content-default">withdraw</code>, <code className="font-mono text-content-default">deregister</code> from a laptop, server, or CI.</li>
        <li className="list-disc"><span className="text-content-primary">Stake ops.</span> <code className="font-mono text-content-default">topUpStake</code> / <code className="font-mono text-content-default">withdrawStake</code> / <code className="font-mono text-content-default">reinstate</code>.</li>
        <li className="list-disc"><span className="text-content-primary">Readable reverts.</span> <code className="font-mono text-content-default">decodeWorkerError</code> turns the unverified custom errors into a sentence plus the fix.</li>
      </ul>
      <p className="text-xs text-content-soft">
        On mainnet, clearing a stuck job realizes a per-job slash (it is the price of unblocking an exit a stuck job
        would otherwise block forever); testnet has slashing disabled. The read-only snippet below opens in StackBlitz
        with no key required.
      </p>
    </div>
  );
}

// --- DAO stepper: chain -> query + run preview -> use it in your project ---
// Mirrors the Bridge stepper shape (Step 1 = direction, Step 2 = inputs +
// preview, Step 3 = integration code). DAO has chain choice in step 1 since
// the two governors are materially different (LCAIGovernor on Ethereum vs
// LightChainGovernor on chain 9200 via NativeVotes).

type DaoStep = 1 | 2 | 3;
type DaoAction = "list-proposals" | "voting-config";

interface DaoChainBrand {
  key: DaoChainKey;
  label: string;
  sub: string;
  logo: string;
}

const DAO_CHAINS: Record<DaoChainKey, DaoChainBrand> = {
  ethereum: { key: "ethereum", label: "Ethereum", sub: "LCAIGovernor + Ballots wrapper", logo: "/logos/eth.svg" },
  lightchain: { key: "lightchain", label: "LightChain", sub: "LightChainGovernor + NativeVotes precompile", logo: "/logos/lcai.png" },
};

const DAO_ACTIONS: { id: DaoAction; label: string; sub: string }[] = [
  { id: "list-proposals", label: "List recent proposals", sub: "dao.recentProposals({ lookbackBlocks, limit })" },
  { id: "voting-config", label: "Read voting config", sub: "dao.config() - delay / period / threshold" },
];

function DaoChainTile({
  chain,
  selected,
  onClick,
}: {
  chain: DaoChainBrand;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-xl border bg-card p-5 text-left transition-all hover:-translate-y-0.5 ${
        selected
          ? "border-primary shadow-[0_0_0_1px_var(--primary)_inset]"
          : "border-bdr-soft hover:border-bdr-light"
      }`}
      aria-pressed={selected}
    >
      <Image src={chain.logo} alt={chain.label} width={40} height={40} className="shrink-0" style={{ width: 40, height: 40 }} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-content-primary">{chain.label}</div>
        <div className="truncate text-xs text-content-soft">{chain.sub}</div>
      </div>
    </button>
  );
}

interface DaoActionResult {
  action: DaoAction;
  chain: DaoChainKey;
  // List-proposals payload (subset of DaoListResp).
  proposals?: DaoProposal[];
  total?: number;
  // Voting-config payload.
  config?: {
    votingDelayBlocks: string;
    votingPeriodBlocks: string;
    proposalThresholdWei: string;
    votingPeriodSecs: number;
  };
}

/** Basis points to a percent string. 500 -> '5%', 1500 -> '15%'. */
function bpsToPct(bps: number): string {
  if (!Number.isFinite(bps)) return "-";
  const pct = bps / 100;
  // No trailing .0 for whole percents, but keep one decimal for fractional.
  return (Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2)) + "%";
}

/** Seconds to a friendly duration string. 120 -> '2 min', 86400 -> '1 day'. */
function secondsToHuman(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "moments";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) {
    const m = Math.round(sec / 60);
    return `${m} min`;
  }
  if (sec < 86400) {
    const h = Math.round(sec / 3600);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(sec / 86400);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/**
 * Convert a block count to a human-readable duration string. Assumes ~12s
 * per block on Ethereum mainnet (LCAIGovernor) and approximately the same
 * order of magnitude on LightChain. Returns short forms like '1 day',
 * '7 days', '12 hours', '45 minutes'.
 */
function blocksToDays(blocks: string): string {
  const n = Number(blocks);
  if (!Number.isFinite(n) || n <= 0) return "moments";
  const seconds = n * 12;
  if (seconds < 3600) {
    const m = Math.round(seconds / 60);
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  if (seconds < 86400) {
    const h = Math.round(seconds / 3600);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const days = Math.round(seconds / 86400);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Render a unix timestamp as relative-to-now ("2 min ago", "3 days ago").
 * Used in the operator status panel to surface freshness of the indexer's
 * last_seen_at signal.
 */
function relativeTime(sec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - sec;
  if (diff < 60) return `${Math.max(0, diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} hour${Math.round(diff / 3600) === 1 ? "" : "s"} ago`;
  return `${Math.round(diff / 86400)} day${Math.round(diff / 86400) === 1 ? "" : "s"} ago`;
}

type StatTone = "success" | "warning" | "info" | "muted";

/**
 * Compact counter tile: big number, two-line label below. Tone drives the
 * accent (success=green, warning=amber, info=brand purple, muted=gray) so
 * the operator can scan four tiles and spot what needs attention without
 * reading the labels.
 */
function StatTile({ label, sub, value, tone }: { label: string; sub: string; value: string; tone: StatTone }) {
  const accent =
    tone === "success" ? "text-emerald-500 dark:text-emerald-400"
    : tone === "warning" ? "text-amber-500 dark:text-amber-400"
    : tone === "info" ? "text-primary"
    : "text-content-default";
  return (
    <div className="rounded-lg border border-bdr-soft bg-card px-3 py-2.5">
      <div className={`font-mono text-xl font-semibold leading-none ${accent}`}>{value}</div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-content-primary">{label}</div>
      <div className="text-[10px] text-content-soft">{sub}</div>
    </div>
  );
}

function DaoRecipe() {
  const [step, setStep] = useState<DaoStep>(1);
  const [chain, setChain] = useState<DaoChainKey>("ethereum");
  const [action, setAction] = useState<DaoAction>("list-proposals");
  const [limit, setLimit] = useState<number>(5);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DaoActionResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // One row expanded at a time inside the proposal list, like the old DaoLive.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function runPreview() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      if (action === "list-proposals") {
        const res = await fetch(`/api/dao-proposals?chain=${chain}&limit=${limit}`, { cache: "no-store" });
        const j = (await res.json()) as DaoListResp;
        if (!res.ok || j.error) {
          setErr(j.error ?? "Couldn't reach the Governor right now.");
          return;
        }
        setResult({ action, chain, proposals: j.proposals, total: j.total });
      } else {
        const res = await fetch(`/api/dao-config?chain=${chain}`, { cache: "no-store" });
        const j = (await res.json()) as { error?: string; config?: DaoActionResult["config"] };
        if (!res.ok || j.error || !j.config) {
          setErr(j.error ?? "Couldn't read the Governor's voting config.");
          return;
        }
        setResult({ action, chain, config: j.config });
      }
    } catch (e) {
      setErr(humanizeError(e, { action: "the DAO preview" }));
    } finally {
      setBusy(false);
    }
  }

  const snippet = daoSnippet(action, chain, limit);

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:gap-4">
        <StepDot n={1} current={step as BridgeStep} label="Chain" />
        <StepConnector filled={step > 1} />
        <StepDot n={2} current={step as BridgeStep} label="Query" />
        <StepConnector filled={step > 2} />
        <StepDot n={3} current={step as BridgeStep} label="Use it" />
      </div>

      <div className="rounded-xl border border-bdr-soft bg-card p-6 sm:p-8">
        {step === 1 ? (
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Pick a governor</h3>
            <p className="mt-1 text-sm text-content-soft">Both chains run an OZ Governor v5; the wrapping differs.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <DaoChainTile chain={DAO_CHAINS.ethereum} selected={chain === "ethereum"} onClick={() => { setChain("ethereum"); setStep(2); }} />
              <DaoChainTile chain={DAO_CHAINS.lightchain} selected={chain === "lightchain"} onClick={() => { setChain("lightchain"); setStep(2); }} />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <StepBack onClick={() => setStep(1)} />
            <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Pick a query</h3>
            <p className="mt-1 text-sm text-content-soft">
              Reading <span className="text-content-primary">{DAO_CHAINS[chain].label}</span>{" "}
              <span className="text-content-soft">({DAO_CHAINS[chain].sub})</span>.
            </p>

            {/* Action chips */}
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {DAO_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    if (action !== a.id) {
                      setResult(null);
                      setErr(null);
                    }
                    setAction(a.id);
                  }}
                  className={`rounded-xl border bg-surface-base-faint p-4 text-left transition-all hover:border-bdr-light ${
                    action === a.id
                      ? "border-primary shadow-[0_0_0_1px_var(--primary)_inset]"
                      : "border-bdr-soft"
                  }`}
                  aria-pressed={action === a.id}
                >
                  <div className="text-sm font-semibold text-content-primary">{a.label}</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-content-soft">{a.sub}</div>
                </button>
              ))}
            </div>

            {/* Action-specific input(s) */}
            {action === "list-proposals" ? (
              <label className="mt-4 block">
                <span className="mb-1.5 block text-xs text-content-soft">Limit (1-30)</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={limit}
                  onChange={(e) => setLimit(Math.min(30, Math.max(1, Number(e.target.value) || 5)))}
                  className="w-32 rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-sm text-content-primary outline-none focus:border-primary/60"
                />
              </label>
            ) : null}

            <button
              type="button"
              onClick={runPreview}
              disabled={busy}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-base font-semibold text-white shadow-[0_4px_12px_rgba(0,0,0,0.25)] transition-all duration-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "linear-gradient(94deg, #dd00ac 10.66%, #7130c3 53.03%, #410093 96.34%)" }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy
                ? "Running preview"
                : action === "list-proposals"
                  ? `Preview ${limit} recent proposals`
                  : "Read the voting config"}
            </button>

            {err ? (
              <p className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-content-default">{err}</p>
            ) : null}

            {result ? (
              <div className="mt-6 rounded-lg border border-bdr-soft bg-surface-base-faint p-4">
                <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-content-soft">SDK preview</p>
                {result.action === "list-proposals" && result.proposals ? (
                  <>
                    {/* Friendly count line. 'X of Y' is confusing when X === Y,
                        which is what happens when the governor only has X
                        total proposals - clarify rather than letting the user
                        wonder why their limit=30 returned 5. */}
                    <p className="mb-2 text-xs text-content-soft">
                      {result.total != null && result.proposals.length >= result.total ? (
                        <>
                          The governor has <span className="text-content-primary">{result.total}</span> recent proposal
                          {result.total === 1 ? "" : "s"} on {DAO_CHAINS[result.chain].label} - showing them all.
                        </>
                      ) : (
                        <>
                          Showing <span className="text-content-primary">{result.proposals.length}</span> of{" "}
                          <span className="text-content-primary">{result.total ?? "?"}</span> recent proposals on{" "}
                          {DAO_CHAINS[result.chain].label}.
                        </>
                      )}
                    </p>
                    <ul className="space-y-2 text-xs">
                      {result.proposals.map((p) => {
                        const isOpen = expandedId === p.id;
                        return (
                          <li key={p.id} className="overflow-hidden rounded-md border border-bdr-soft bg-card">
                            <button
                              type="button"
                              onClick={() => setExpandedId(isOpen ? null : p.id)}
                              className="flex w-full items-start gap-3 p-2.5 text-left transition-colors hover:bg-surface-base-faint"
                            >
                              <Badge tone={STATE_TONE[p.stateLabel] ?? "muted"}>{p.stateLabel}</Badge>
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-content-primary">{p.title}</div>
                                <div className="font-mono text-[10px] text-content-soft">id {p.id.slice(0, 14)}…</div>
                              </div>
                              <ChevronDown
                                className={cn(
                                  "size-4 shrink-0 text-content-soft transition-transform",
                                  isOpen && "rotate-180",
                                )}
                              />
                            </button>
                            {isOpen ? (
                              <div className="space-y-2 border-t border-bdr-soft px-3 py-3 text-[11px]">
                                <p className="leading-relaxed text-content-default">{p.descriptionPreview}</p>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-content-soft">
                                  <span>
                                    proposer{" "}
                                    <code className="font-mono text-content-default">
                                      {p.proposer.slice(0, 8)}…{p.proposer.slice(-4)}
                                    </code>
                                  </span>
                                  <span>
                                    For <code className="font-mono text-content-default">{lcai(p.votesFor)}</code>
                                  </span>
                                  <span>
                                    Against <code className="font-mono text-content-default">{lcai(p.votesAgainst)}</code>
                                  </span>
                                  <span>
                                    Abstain <code className="font-mono text-content-default">{lcai(p.votesAbstain)}</code>
                                  </span>
                                </div>
                                <a
                                  href={`https://dao.lightchain.ai/proposal/${p.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-primary hover:underline"
                                >
                                  Open in DAO UI <ExternalLink className="size-3" />
                                </a>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : null}
                {result.action === "voting-config" && result.config ? (
                  <dl className="grid gap-1.5 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-content-soft">Voting delay</dt>
                      <dd className="text-right">
                        <span className="font-mono text-content-primary">{result.config.votingDelayBlocks} blocks</span>
                        <span className="ml-1.5 text-content-soft">({blocksToDays(result.config.votingDelayBlocks)})</span>
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-content-soft">Voting period</dt>
                      <dd className="text-right">
                        <span className="font-mono text-content-primary">{result.config.votingPeriodBlocks} blocks</span>
                        <span className="ml-1.5 text-content-soft">({blocksToDays(result.config.votingPeriodBlocks)})</span>
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-content-soft">Proposal threshold</dt>
                      <dd className="text-right">
                        <span className="font-mono text-content-primary">
                          {(Number(BigInt(result.config.proposalThresholdWei)) / 1e18).toLocaleString()} LCAI
                        </span>
                        <span className="ml-1.5 text-content-soft">(wrapped)</span>
                      </dd>
                    </div>
                    <p className="mt-2 text-[11px] text-content-soft">
                      A block on {DAO_CHAINS[result.chain].label} is ~12 seconds, so the delay/period above convert to
                      the day counts shown. The threshold is how much wrapped LCAI a wallet needs to submit a proposal.
                    </p>
                  </dl>
                ) : null}

                <details className="mt-3 rounded-lg border border-bdr-soft bg-card">
                  <summary className="cursor-pointer px-3 py-2 text-[11px] text-content-soft hover:text-content-primary">
                    Show raw JSON
                  </summary>
                  <pre className="overflow-x-auto border-t border-bdr-soft px-3 py-2 font-mono text-[11px] text-content-default">
{JSON.stringify(result, null, 2)}
                  </pre>
                </details>

                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="group mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-base font-semibold text-white shadow-[0_4px_18px_-4px_rgba(112,100,233,0.6)] transition-all duration-500 active:scale-95"
                  style={{ background: "linear-gradient(94deg, #7064E9 10%, #5a4fd6 60%, #410093 100%)" }}
                >
                  Get the code for your project
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <StepBack onClick={() => setStep(2)} />
            <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Use it in your project</h3>
            <p className="mt-1 text-sm text-content-soft">
              The snippet below mirrors the query you just previewed. Paste it into a Node script or open the
              StackBlitz to run it.
            </p>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2.5 text-xs text-content-default">
              <span className="truncate text-content-soft">
                Save in your project at <code className="font-mono text-content-default">index.ts</code>
              </span>
              <button
                type="button"
                onClick={() =>
                  openSnippetInStackBlitz({ title: "DAO SDK", snippet, needsPrivateKey: false })
                }
                className="group inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold text-white shadow-[0_0_18px_-4px_rgba(112,100,233,0.7)] transition-all duration-300 hover:shadow-[0_0_24px_-2px_rgba(221,0,172,0.55)]"
                style={{ background: "linear-gradient(94deg, #7064E9 0%, #9333ea 60%, #dd00ac 100%)" }}
              >
                <PlayCircle className="size-3.5 transition-transform group-hover:scale-110" />
                Open in StackBlitz
              </button>
            </div>

            <div className="mt-3">
              <CodeBox code={snippet} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Build the runnable DAO snippet that matches the chosen action + chain.
 *  Returns a single Node-script body that runs end to end. Read-only;
 *  no PRIVATE_KEY required for either action. */
function daoSnippet(action: DaoAction, chain: DaoChainKey, limit: number): string {
  const chainArg = chain === "lightchain" ? "lightchain-mainnet" : "ethereum";
  const transport = chain === "lightchain"
    ? `http("https://rpc.mainnet.lightchain.ai")`
    : `http("https://ethereum-rpc.publicnode.com")`;
  const viemChain = chain === "lightchain" ? "" : "import { mainnet } from \"viem/chains\";\n";
  const chainOpt = chain === "lightchain" ? "" : ", chain: mainnet";

  if (action === "list-proposals") {
    return `import { DAO } from "lightnode-sdk";
import { createPublicClient, http } from "viem";
${viemChain}
const publicClient = createPublicClient({ transport: ${transport}${chainOpt} });
const dao = new DAO(publicClient, "${chainArg === "lightchain-mainnet" ? "lightchain" : "ethereum"}");

// List the most recent proposals on the governor:
const rows = await dao.recentProposals({ lookbackBlocks: 300_000, limit: ${limit} });
for (const p of rows) {
  console.log(p.id.toString(), p.stateLabel.padEnd(10), p.title);
}`;
  }
  return `import { DAO } from "lightnode-sdk";
import { createPublicClient, http } from "viem";
${viemChain}
const publicClient = createPublicClient({ transport: ${transport}${chainOpt} });
const dao = new DAO(publicClient, "${chainArg === "lightchain-mainnet" ? "lightchain" : "ethereum"}");

// Read the live voting config: delay, period, threshold.
const cfg = await dao.config();
console.log("voting delay  :", cfg.votingDelayBlocks.toString(), "blocks");
console.log("voting period :", cfg.votingPeriodBlocks.toString(), "blocks (~", Math.round(cfg.votingPeriodSecs / 86400), "days)");
console.log("threshold     :", (Number(cfg.proposalThresholdWei) / 1e18).toLocaleString(), "LCAI");`;
}

// Shared network constants previously hosted by the removed Models recipe.
// Several other steppers (operator, chat) still read them, so they keep
// their old shape rather than being inlined per-use.
type ModelsNet = "mainnet" | "testnet";
const MODELS_NETS: { id: ModelsNet; label: string; sub: string }[] = [
  { id: "mainnet", label: "Mainnet", sub: "9200 - production model whitelist" },
  { id: "testnet", label: "Testnet", sub: "8200 - free LCAI from the faucet" },
];

// --- Dispute / refund stepper -----------------------------------------------

type DisputeStep = 1 | 2 | 3;

interface DisputeResultRow {
  jobId?: string;
  category?: string;
  refundable?: boolean;
  worker?: string | null;
  model?: string | null;
  submittedAt?: number | null;
  completedAt?: number | null;
  workerShareLcai?: number;
  raw?: string;
  error?: string;
}

function DisputeRecipe() {
  const [step, setStep] = useState<DisputeStep>(1);
  const [net, setNet] = useState<ModelsNet>("mainnet");
  const [jobId, setJobId] = useState<string>("1234");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DisputeResultRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!jobId.trim()) {
      setErr("Enter a job ID first.");
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/sdk-demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "job", arg: jobId, net }),
      });
      const j = (await res.json()) as DisputeResultRow;
      if (j.error) setErr(j.error);
      else setResult(j);
    } catch (e) {
      setErr(humanizeError(e, { action: "the job lookup" }));
    } finally {
      setBusy(false);
    }
  }

  const snippet = `import { LightNode } from "lightnode-sdk";

const ln = new LightNode("${net}");

// Classify any job: 'submitted' / 'in-flight' / 'completed' /
// 'stalled' / 'disputed' / 'resolved' / 'unknown'. The 'refundable'
// flag is true when the protocol's dispute window would refund the fee.
const status = await ln.getJobStatus(${jobId.trim() || "1234"}n);
if (!status) {
  console.log("not yet indexed");
} else {
  console.log("category   :", status.category);
  console.log("refundable :", status.refundable);
  console.log("worker     :", status.worker);
  console.log("model      :", status.model);
}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:gap-4">
        <StepDot n={1} current={step as BridgeStep} label="Network" />
        <StepConnector filled={step > 1} />
        <StepDot n={2} current={step as BridgeStep} label="Job" />
        <StepConnector filled={step > 2} />
        <StepDot n={3} current={step as BridgeStep} label="Use it" />
      </div>

      <div className="rounded-xl border border-bdr-soft bg-card p-6 sm:p-8">
        {step === 1 ? (
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Pick a network</h3>
            <p className="mt-1 text-sm text-content-soft">Job ids are scoped per network.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {MODELS_NETS.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => { setNet(n.id); setStep(2); }}
                  className={`group flex items-center gap-3 rounded-xl border bg-card p-5 text-left transition-all hover:-translate-y-0.5 ${
                    net === n.id ? "border-primary shadow-[0_0_0_1px_var(--primary)_inset]" : "border-bdr-soft hover:border-bdr-light"
                  }`}
                >
                  <div className="grid size-10 place-items-center rounded-lg bg-surface-base-faint">
                    <Database className="size-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-content-primary">{n.label}</div>
                    <div className="truncate text-xs text-content-soft">{n.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <StepBack onClick={() => setStep(1)} />
            <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Inspect a job</h3>
            <p className="mt-1 text-sm text-content-soft">
              Any job id on <span className="text-content-primary">{net === "mainnet" ? "Mainnet" : "Testnet"}</span>.
              <code className="font-mono text-content-default"> ln.getJobStatus(id)</code> returns the category and a
              refundable flag.
            </p>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-xs text-content-soft">Job ID</span>
              <input
                type="text"
                value={jobId}
                onChange={(e) => setJobId(e.target.value.trim())}
                placeholder="e.g. 1234"
                inputMode="numeric"
                className="w-48 rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-sm text-content-primary outline-none focus:border-primary/60"
              />
            </label>
            <button
              type="button"
              onClick={run}
              disabled={busy || !jobId.trim()}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-base font-semibold text-white shadow-[0_4px_12px_rgba(0,0,0,0.25)] transition-all duration-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "linear-gradient(94deg, #dd00ac 10.66%, #7130c3 53.03%, #410093 96.34%)" }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? "Looking up job" : `Inspect job ${jobId.trim() || "..."}`}
            </button>

            {err ? (
              <p className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-content-default">{err}</p>
            ) : null}

            {result ? (
              <div className="mt-6 rounded-lg border border-bdr-soft bg-surface-base-faint p-4">
                <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-content-soft">SDK preview</p>
                <dl className="grid gap-1.5 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-content-soft">Category</dt>
                    <dd>
                      <Badge tone={
                        result.category === "completed" || result.category === "resolved" ? "success"
                          : result.category === "stalled" || result.category === "disputed" ? "warning"
                          : "muted"
                      }>{result.category ?? "?"}</Badge>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-content-soft">Refundable</dt>
                    <dd className="font-mono text-content-primary">{String(result.refundable ?? false)}</dd>
                  </div>
                  {result.worker ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-content-soft">Worker</dt>
                      <dd className="break-all font-mono text-content-default">
                        {result.worker.slice(0, 10)}…{result.worker.slice(-6)}
                      </dd>
                    </div>
                  ) : null}
                  {result.model ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-content-soft">Model</dt>
                      <dd className="break-all font-mono text-content-default">
                        {result.model.slice(0, 10)}…{result.model.slice(-6)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <details className="mt-3 rounded-lg border border-bdr-soft bg-card">
                  <summary className="cursor-pointer px-3 py-2 text-[11px] text-content-soft hover:text-content-primary">
                    Show raw JSON
                  </summary>
                  <pre className="overflow-x-auto border-t border-bdr-soft px-3 py-2 font-mono text-[11px] text-content-default">
{JSON.stringify(result, null, 2)}
                  </pre>
                </details>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="group mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-base font-semibold text-white shadow-[0_4px_18px_-4px_rgba(112,100,233,0.6)] transition-all duration-500 active:scale-95"
                  style={{ background: "linear-gradient(94deg, #7064E9 10%, #5a4fd6 60%, #410093 100%)" }}
                >
                  Get the code for your project
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <StepBack onClick={() => setStep(2)} />
            <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Use it in your project</h3>
            <p className="mt-1 text-sm text-content-soft">
              The snippet targets <span className="text-content-primary">{net}</span> and job{" "}
              <code className="font-mono text-content-default">{jobId.trim() || "1234"}n</code>.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2.5 text-xs text-content-default">
              <span className="truncate text-content-soft">
                Save in your project at <code className="font-mono text-content-default">index.ts</code>
              </span>
              <button
                type="button"
                onClick={() => openSnippetInStackBlitz({ title: "Refund SDK", snippet, needsPrivateKey: false })}
                className="group inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold text-white shadow-[0_0_18px_-4px_rgba(112,100,233,0.7)] transition-all duration-300 hover:shadow-[0_0_24px_-2px_rgba(221,0,172,0.55)]"
                style={{ background: "linear-gradient(94deg, #7064E9 0%, #9333ea 60%, #dd00ac 100%)" }}
              >
                <PlayCircle className="size-3.5 transition-transform group-hover:scale-110" />
                Open in StackBlitz
              </button>
            </div>
            <div className="mt-3">
              <CodeBox code={snippet} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Shared stepper shell ----------------------------------------------------
// Pulls the step indicator + step-container styling into one place so every
// new Recipe gets a consistent shell. The Bridge / DAO / Models / Dispute
// recipes built earlier in this file inline the same JSX - we don't retrofit
// them to avoid regression risk.

function StepperShell({
  step,
  labels,
  children,
}: {
  step: BridgeStep;
  labels: [string, string, string];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:gap-4">
        <StepDot n={1} current={step} label={labels[0]} />
        <StepConnector filled={step > 1} />
        <StepDot n={2} current={step} label={labels[1]} />
        <StepConnector filled={step > 2} />
        <StepDot n={3} current={step} label={labels[2]} />
      </div>
      <div className="rounded-xl border border-bdr-soft bg-card p-6 sm:p-8">{children}</div>
    </div>
  );
}

/** Step 3 'Use it in your project' block. Snippet + file hint + StackBlitz. */
function UseItStep({
  onBack,
  title,
  hint,
  snippet,
  needsKey,
}: {
  onBack: () => void;
  title: string;
  hint: string;
  snippet: string;
  needsKey: boolean;
}) {
  return (
    <div>
      <StepBack onClick={onBack} />
      <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Use it in your project</h3>
      <p className="mt-1 text-sm text-content-soft">{hint}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2.5 text-xs text-content-default">
        <span className="truncate text-content-soft">
          Save in your project at <code className="font-mono text-content-default">index.ts</code>
        </span>
        <button
          type="button"
          onClick={() => openSnippetInStackBlitz({ title, snippet, needsPrivateKey: needsKey })}
          className="group inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold text-white shadow-[0_0_18px_-4px_rgba(112,100,233,0.7)] transition-all duration-300 hover:shadow-[0_0_24px_-2px_rgba(221,0,172,0.55)]"
          style={{ background: "linear-gradient(94deg, #7064E9 0%, #9333ea 60%, #dd00ac 100%)" }}
        >
          <PlayCircle className="size-3.5 transition-transform group-hover:scale-110" />
          Open in StackBlitz
        </button>
      </div>
      <div className="mt-3">
        <CodeBox code={snippet} />
      </div>
    </div>
  );
}

/** Gradient brand 'Run preview' button used by every Recipe in step 2. */
function PreviewButton({ onClick, busy, idle, working }: { onClick: () => void; busy: boolean; idle: string; working: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-base font-semibold text-white shadow-[0_4px_12px_rgba(0,0,0,0.25)] transition-all duration-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: "linear-gradient(94deg, #dd00ac 10.66%, #7130c3 53.03%, #410093 96.34%)" }}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : null}
      {busy ? working : idle}
    </button>
  );
}

/** 'Get the code for your project' CTA that advances to step 3. */
function GetTheCodeCTA({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-base font-semibold text-white shadow-[0_4px_18px_-4px_rgba(112,100,233,0.6)] transition-all duration-500 active:scale-95"
      style={{ background: "linear-gradient(94deg, #7064E9 10%, #5a4fd6 60%, #410093 100%)" }}
    >
      Get the code for your project
      <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
    </button>
  );
}

// --- Worker Operator stepper ------------------------------------------------

type OperatorStep = 1 | 2 | 3;
type OperatorAction = "config" | "status" | "job";

interface OpConfig {
  minStakeLcai: number;
  completionTimeoutSec: number;
  ackTimeoutSec: number;
  resolutionTimeoutSec: number;
  disputeWindowSec: number;
  slashBps: { ackTimeout: number; completionTimeout: number; dispute: number; max: number };
  feeBps: { protocol: number; worker: number; feePool: number };
}
interface OpStatus {
  address: string;
  registered: boolean;
  stakeLcai: number;
  claimableLcai: number;
  belowFloor: boolean;
  headroomLcai: number;
  walletBalanceLcai?: number;
  subgraphStatus?: string | null;
  activeJobCount?: number;
  lifetimeJobsCompleted?: number;
  lifetimeJobsTimedOut?: number;
  lifetimeEarnedLcai?: number;
  lastSeenAt?: number | null;
  createdAt?: number | null;
  recentReleased?: number;
  recentPendingRelease?: number;
  recentStuck?: number;
  recentInFlight?: number;
  registeredModels?: Array<{
    id: string;
    name: string | null;
    isLive: boolean;
    isStale: boolean;
    onchainUnknown: boolean;
    indexedActive: boolean;
  }>;
}
interface OpJob {
  id: string;
  category: string;
  refundable: boolean;
  worker: string | null;
  model: string | null;
  submittedAt: number | null;
  completedAt: number | null;
  workerShareLcai: number;
  submitBlock: number | null;
  completionBlock: number | null;
  submitTx: `0x${string}` | null;
  completionTx: `0x${string}` | null;
}

function OperatorRecipe() {
  const [step, setStep] = useState<OperatorStep>(1);
  const [net, setNet] = useState<ModelsNet>("mainnet");
  const [action, setAction] = useState<OperatorAction>("config");
  const [worker, setWorker] = useState<string>("");
  const [jobId, setJobId] = useState<string>("1234");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ config?: OpConfig; status?: OpStatus; job?: OpJob | null } | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const qs =
        action === "status"
          ? `action=status&net=${net}&worker=${encodeURIComponent(worker)}`
          : action === "job"
            ? `action=job&net=${net}&jobId=${encodeURIComponent(jobId)}`
            : `action=config&net=${net}`;
      const res = await fetch(`/api/operator-preview?${qs}`, { cache: "no-store" });
      const j = (await res.json()) as { error?: string; config?: OpConfig; status?: OpStatus; status_?: OpJob | null };
      if (!res.ok || j.error) {
        setErr(j.error ?? "Couldn't read the operator surface.");
        return;
      }
      const out = j as unknown as { config?: OpConfig; status?: OpStatus | OpJob | null };
      if (action === "job") {
        setResult({ job: (out.status ?? null) as OpJob | null });
      } else {
        setResult({ config: out.config, status: out.status as OpStatus | undefined });
      }
    } catch (e) {
      setErr(humanizeError(e, { action: "the worker SDK preview" }));
    } finally {
      setBusy(false);
    }
  }

  const snippet = operatorSnippet(action, net, worker || "0xWORKER_ADDRESS", jobId || "1234");

  return (
    <StepperShell step={step as BridgeStep} labels={["Network", "Query", "Use it"]}>
      {step === 1 ? (
        <div>
          <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Pick a network</h3>
          <p className="mt-1 text-sm text-content-soft">Worker reads + writes are scoped per network.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {MODELS_NETS.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => { setNet(n.id); setStep(2); }}
                className={`group flex items-center gap-3 rounded-xl border bg-card p-5 text-left transition-all hover:-translate-y-0.5 ${
                  net === n.id ? "border-primary shadow-[0_0_0_1px_var(--primary)_inset]" : "border-bdr-soft hover:border-bdr-light"
                }`}
              >
                <div className="grid size-10 place-items-center rounded-lg bg-surface-base-faint">
                  <ShieldCheck className="size-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-content-primary">{n.label}</div>
                  <div className="truncate text-xs text-content-soft">{n.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div>
          <StepBack onClick={() => setStep(1)} />
          <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Pick a query</h3>
          <p className="mt-1 text-sm text-content-soft">
            All three queries are read-only. Reading <span className="text-content-primary">{net === "mainnet" ? "Mainnet" : "Testnet"}</span>.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {([
              { id: "config", label: "Protocol config", sub: "op.config() - timeouts / fees / slash" },
              { id: "status", label: "Worker status", sub: "op.status() - stake / claimable" },
              { id: "job", label: "Inspect a job", sub: "ln.getJobStatus(id) - refund flag" },
            ] as const).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  if (action !== a.id) {
                    // Drop the stale preview on switch; otherwise the prior
                    // query's panel hangs around until the user manually
                    // re-runs and reads as the result of the NEW selection.
                    setResult(null);
                    setErr(null);
                  }
                  setAction(a.id);
                }}
                className={`rounded-xl border bg-surface-base-faint p-4 text-left transition-all hover:border-bdr-light ${
                  action === a.id ? "border-primary shadow-[0_0_0_1px_var(--primary)_inset]" : "border-bdr-soft"
                }`}
              >
                <div className="text-sm font-semibold text-content-primary">{a.label}</div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-content-soft">{a.sub}</div>
              </button>
            ))}
          </div>
          {action === "status" ? (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs text-content-soft">Worker address</span>
              <input
                type="text"
                value={worker}
                onChange={(e) => setWorker(e.target.value.trim())}
                placeholder="0x..."
                className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2.5 font-mono text-xs text-content-primary outline-none focus:border-primary/60"
              />
            </label>
          ) : null}
          {action === "job" ? (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs text-content-soft">Job ID</span>
              <input
                type="text"
                inputMode="numeric"
                value={jobId}
                onChange={(e) => setJobId(e.target.value.trim())}
                placeholder="e.g. 1234"
                className="w-48 rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2.5 font-mono text-xs text-content-primary outline-none focus:border-primary/60"
              />
            </label>
          ) : null}
          <PreviewButton
            onClick={run}
            busy={
              busy ||
              (action === "status" && !/^0x[0-9a-fA-F]{40}$/.test(worker)) ||
              (action === "job" && !/^\d+$/.test(jobId))
            }
            idle={
              action === "config" ? "Read protocol config" :
              action === "status" ? "Read worker status" :
              `Inspect job ${jobId || "..."}`
            }
            working="Reading on-chain"
          />
          {err ? (
            <p className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-content-default">{err}</p>
          ) : null}
          {result?.config ? (
            <div className="mt-6 rounded-lg border border-bdr-soft bg-surface-base-faint p-4">
              <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-content-soft">SDK preview</p>
              <dl className="grid gap-1.5 text-xs">
                <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Min stake</dt><dd className="font-mono text-content-primary">{result.config.minStakeLcai.toLocaleString()} LCAI</dd></div>
                <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Completion timeout</dt><dd className="font-mono text-content-primary">{result.config.completionTimeoutSec}s <span className="text-content-soft">({secondsToHuman(result.config.completionTimeoutSec)})</span></dd></div>
                <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Ack timeout</dt><dd className="font-mono text-content-primary">{result.config.ackTimeoutSec}s <span className="text-content-soft">({secondsToHuman(result.config.ackTimeoutSec)})</span></dd></div>
                <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Dispute window</dt><dd className="font-mono text-content-primary">{result.config.disputeWindowSec}s <span className="text-content-soft">({secondsToHuman(result.config.disputeWindowSec)})</span></dd></div>
                <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Slash (ack / completion / dispute)</dt><dd className="font-mono text-content-primary">{bpsToPct(result.config.slashBps.ackTimeout)} / {bpsToPct(result.config.slashBps.completionTimeout)} / {bpsToPct(result.config.slashBps.dispute)}</dd></div>
                <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Fee split (protocol / worker / pool)</dt><dd className="font-mono text-content-primary">{bpsToPct(result.config.feeBps.protocol)} / {bpsToPct(result.config.feeBps.worker)} / {bpsToPct(result.config.feeBps.feePool)}</dd></div>
              </dl>
              <details className="mt-3 rounded-lg border border-bdr-soft bg-card">
                <summary className="cursor-pointer px-3 py-2 text-[11px] text-content-soft hover:text-content-primary">Show raw JSON</summary>
                <pre className="overflow-x-auto border-t border-bdr-soft px-3 py-2 font-mono text-[11px] text-content-default">{JSON.stringify(result.config, null, 2)}</pre>
              </details>
              <GetTheCodeCTA onClick={() => setStep(3)} />
            </div>
          ) : null}
          {result?.status ? (
            <div className="mt-6 rounded-lg border border-bdr-soft bg-surface-base-faint p-4">
              <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-content-soft">SDK preview</p>
              <dl className="grid gap-1.5 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-content-soft">Worker</dt>
                  <dd className="inline-flex items-center gap-2">
                    <code className="break-all font-mono text-content-default">{result.status.address.slice(0, 10)}…{result.status.address.slice(-6)}</code>
                    <a
                      href={`https://${net === "mainnet" ? "mainnet" : "testnet"}.lightscan.app/address/${result.status.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open on Lightscan"
                      className="text-content-soft transition-colors hover:text-primary"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Registered</dt><dd>{result.status.registered ? <Badge tone="success">yes</Badge> : <Badge tone="muted">no</Badge>}</dd></div>
                <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Stake locked</dt><dd className="font-mono text-content-primary">{result.status.stakeLcai.toLocaleString()} LCAI</dd></div>
                <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Claimable earnings</dt><dd className="font-mono text-content-primary">{result.status.claimableLcai.toLocaleString()} LCAI</dd></div>
                {result.status.walletBalanceLcai != null ? (
                  <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Wallet balance</dt><dd className="font-mono text-content-primary">{result.status.walletBalanceLcai.toLocaleString()} LCAI</dd></div>
                ) : null}
                {result.status.registeredModels && result.status.registeredModels.length > 0 ? (() => {
                  const isRegistered = result.status.registered;
                  const models = result.status.registeredModels;
                  // When the worker is registered, the chain truth (isLive)
                  // drives the primary 'Serving models' row. Stale subgraph
                  // rows (indexed says active, chain disagrees) are still
                  // surfaced under a secondary row so the operator can SEE
                  // what the indexer is lagging on instead of the data
                  // silently disappearing. When the worker is itself
                  // deregistered, fall back to the indexed snapshot.
                  const live = isRegistered
                    ? models.filter((m) => m.isLive || m.onchainUnknown)
                    : models.filter((m) => m.indexedActive);
                  const stale = isRegistered ? models.filter((m) => m.isStale) : [];
                  return (
                    <>
                      {live.length > 0 ? (
                        <div className="flex items-start justify-between gap-3">
                          <dt className="text-content-soft pt-0.5">
                            {isRegistered ? "Serving models" : "Last whitelist"}
                          </dt>
                          <dd className="flex flex-col items-end gap-1">
                            {live.map((rm) => (
                              <div key={rm.id} className="inline-flex items-center gap-2">
                                <code className="font-mono text-content-primary">{rm.name ?? rm.id.slice(0, 12) + "…"}</code>
                                {isRegistered ? (
                                  rm.isLive ? <Badge tone="success">live</Badge> : <Badge tone="muted">indexed</Badge>
                                ) : (
                                  <Badge tone="muted">not registered</Badge>
                                )}
                              </div>
                            ))}
                          </dd>
                        </div>
                      ) : null}
                      {stale.length > 0 ? (
                        <div className="flex items-start justify-between gap-3">
                          <dt className="text-content-soft pt-0.5" title="Indexer still shows these as active; on-chain WorkerRegistry says otherwise. They will fall off the next time the subgraph reconciles.">
                            Stale index rows
                          </dt>
                          <dd className="flex flex-col items-end gap-1">
                            {stale.map((rm) => (
                              <div key={rm.id} className="inline-flex items-center gap-2">
                                <code className="font-mono text-content-soft line-through">{rm.name ?? rm.id.slice(0, 12) + "…"}</code>
                                <Badge tone="muted">stale</Badge>
                              </div>
                            ))}
                          </dd>
                        </div>
                      ) : null}
                    </>
                  );
                })() : null}
                {result.status.lifetimeEarnedLcai != null && result.status.lifetimeEarnedLcai > 0 ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-content-soft">Lifetime earned</dt>
                    <dd className="font-mono text-content-primary">{result.status.lifetimeEarnedLcai.toLocaleString(undefined, { maximumFractionDigits: 4 })} LCAI</dd>
                  </div>
                ) : null}
                {result.status.lastSeenAt ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-content-soft">Last seen</dt>
                    <dd className="font-mono text-content-default">{relativeTime(result.status.lastSeenAt)}</dd>
                  </div>
                ) : null}
              </dl>
              {/* Activity buckets: surfaces the numbers that operators
                  actually scan for - released vs pending vs stuck vs
                  timed-out. The grid layout makes 4-5 small counters
                  readable at a glance. */}
              {(result.status.lifetimeJobsCompleted != null || result.status.recentReleased != null) ? (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatTile
                    label="Released"
                    sub="jobs paid out"
                    value={(result.status.recentReleased ?? 0).toLocaleString()}
                    tone={result.status.recentReleased ? "success" : "muted"}
                  />
                  <StatTile
                    label="Pending release"
                    sub="awaiting settle"
                    value={(result.status.recentPendingRelease ?? 0).toLocaleString()}
                    tone={result.status.recentPendingRelease ? "info" : "muted"}
                  />
                  <StatTile
                    label="Stuck"
                    sub="acked past deadline"
                    value={(result.status.recentStuck ?? 0).toLocaleString()}
                    tone={result.status.recentStuck ? "warning" : "muted"}
                  />
                  <StatTile
                    label="Timed out"
                    sub="lifetime"
                    value={(result.status.lifetimeJobsTimedOut ?? 0).toLocaleString()}
                    tone={result.status.lifetimeJobsTimedOut ? "warning" : "muted"}
                  />
                </div>
              ) : null}
              {(result.status.recentStuck ?? 0) > 0 ? (
                <p className="mt-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-content-default">
                  This worker has acked jobs past their completion deadline. Operators can self-clear with{" "}
                  <code className="font-mono">op.stuckJobs([...])</code> then{" "}
                  <code className="font-mono">op.claimTimeout(jobId)</code> - the worker keeps its stake, the protocol refunds the consumer.
                </p>
              ) : null}
              {/* Explanatory copy: deregistered workers will show stake 0,
                  claimable 0, but their wallet balance carries the returned
                  stake. Without saying so, the panel reads as 'empty worker'. */}
              {!result.status.registered ? (
                <p className="mt-3 rounded-md border border-bdr-soft bg-card px-3 py-2 text-[11px] leading-relaxed text-content-soft">
                  This worker is <span className="text-content-primary">not currently registered</span>. If it was deregistered, the original stake has been returned to the worker wallet - that is the
                  <span className="text-content-primary"> Wallet balance</span> above. Withdraw it with{" "}
                  <code className="font-mono text-content-default">op.withdraw()</code> or the dashboard Withdraw button.
                </p>
              ) : result.status.belowFloor ? (
                <p className="mt-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-content-default">
                  Stake is below the minimum, so the worker is deactivated. Top up with{" "}
                  <code className="font-mono">op.topUpStake({Math.max(1, -Math.floor(result.status.headroomLcai))}n * 10n ** 18n)</code> to bring it live again.
                </p>
              ) : null}
              <details className="mt-3 rounded-lg border border-bdr-soft bg-card">
                <summary className="cursor-pointer px-3 py-2 text-[11px] text-content-soft hover:text-content-primary">Show raw JSON</summary>
                <pre className="overflow-x-auto border-t border-bdr-soft px-3 py-2 font-mono text-[11px] text-content-default">{JSON.stringify(result.status, null, 2)}</pre>
              </details>
              <GetTheCodeCTA onClick={() => setStep(3)} />
            </div>
          ) : null}
          {action === "job" && result?.job !== undefined ? (
            <div className="mt-6 rounded-lg border border-bdr-soft bg-surface-base-faint p-4">
              <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-content-soft">SDK preview</p>
              {!result.job ? (
                <p className="text-xs text-content-soft">Job {jobId} is not yet indexed on {net}. The protocol may still be processing it.</p>
              ) : (
                <dl className="grid gap-1.5 text-xs">
                  <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Category</dt><dd><Badge tone={
                    result.job.category === "completed" || result.job.category === "resolved" ? "success"
                      : result.job.category === "stalled" || result.job.category === "disputed" ? "warning"
                      : "muted"
                  }>{result.job.category}</Badge></dd></div>
                  <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Refundable</dt><dd className="font-mono text-content-primary">{String(result.job.refundable)}</dd></div>
                  {result.job.worker ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-content-soft">Worker</dt>
                      <dd className="inline-flex items-center gap-2">
                        <code className="break-all font-mono text-content-default">{result.job.worker.slice(0, 10)}…{result.job.worker.slice(-6)}</code>
                        <a
                          href={`https://${net === "mainnet" ? "mainnet" : "testnet"}.lightscan.app/address/${result.job.worker}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open on Lightscan"
                          className="text-content-soft transition-colors hover:text-primary"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-content-soft">Job</dt>
                    <dd className="font-mono text-content-default">#{result.job.id}</dd>
                  </div>
                  {result.job.workerShareLcai ? (
                    <div className="flex items-center justify-between gap-3"><dt className="text-content-soft">Worker share</dt><dd className="font-mono text-content-primary">{result.job.workerShareLcai} LCAI</dd></div>
                  ) : null}
                  {result.job.submitTx ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-content-soft">Submit tx</dt>
                      <dd className="inline-flex items-center gap-2">
                        <code className="font-mono text-content-default">{result.job.submitTx.slice(0, 10)}…{result.job.submitTx.slice(-6)}</code>
                        <a
                          href={`https://${net === "mainnet" ? "mainnet" : "testnet"}.lightscan.app/tx/${result.job.submitTx}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open submitJob tx on Lightscan"
                          className="text-content-soft transition-colors hover:text-primary"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      </dd>
                    </div>
                  ) : null}
                  {result.job.completionTx ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-content-soft">Completion tx</dt>
                      <dd className="inline-flex items-center gap-2">
                        <code className="font-mono text-content-default">{result.job.completionTx.slice(0, 10)}…{result.job.completionTx.slice(-6)}</code>
                        <a
                          href={`https://${net === "mainnet" ? "mainnet" : "testnet"}.lightscan.app/tx/${result.job.completionTx}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open jobCompleted tx on Lightscan"
                          className="text-content-soft transition-colors hover:text-primary"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              )}
              <details className="mt-3 rounded-lg border border-bdr-soft bg-card">
                <summary className="cursor-pointer px-3 py-2 text-[11px] text-content-soft hover:text-content-primary">Show raw JSON</summary>
                <pre className="overflow-x-auto border-t border-bdr-soft px-3 py-2 font-mono text-[11px] text-content-default">{JSON.stringify(result.job, null, 2)}</pre>
              </details>
              <GetTheCodeCTA onClick={() => setStep(3)} />
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <UseItStep
          onBack={() => setStep(2)}
          title="Worker SDK"
          hint={`Targets ${net}. Reads are key-less; the commented-out writes sign with your worker key.`}
          snippet={snippet}
          needsKey={false}
        />
      ) : null}
    </StepperShell>
  );
}

function operatorSnippet(action: OperatorAction, net: ModelsNet, workerAddr: string, jobId: string): string {
  const head = `import { WorkerOperator } from "lightnode-sdk";
import { createPublicClient, http } from "viem";

const chain = ${net === "mainnet"
    ? `{ id: 9200, name: "LightChain mainnet", nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.lightchain.ai"] } } }`
    : `{ id: 8200, name: "LightChain testnet", nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.lightchain.ai"] } } }`};
const publicClient = createPublicClient({ transport: http(chain.rpcUrls.default.http[0]), chain });`;
  if (action === "config") {
    return `${head}

// config() reads global AIConfig values - no worker address needed.
// (lightnode-sdk >= 0.7.7 relaxed the constructor for read-only paths.)
const op = new WorkerOperator("${net}", { publicClient });

const cfg = await op.config();

// Friendlier formatters: seconds to human, bps to percent. Same logic
// the lightnode.app /build/sdks/operator panel uses.
const pct = (bps: number) => {
  if (!Number.isFinite(bps)) return "-";
  const v = bps / 100;
  return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)) + "%";
};
const human = (sec: number) => {
  if (!Number.isFinite(sec) || sec <= 0) return "moments";
  if (sec < 60) return \`\${sec}s\`;
  if (sec < 3600) return \`\${Math.round(sec / 60)} min\`;
  if (sec < 86400) { const h = Math.round(sec / 3600); return \`\${h} hour\${h === 1 ? "" : "s"}\`; }
  const d = Math.round(sec / 86400); return \`\${d} day\${d === 1 ? "" : "s"}\`;
};

console.log("Min stake              :", cfg.minStakeLcai, "LCAI");
console.log("Completion timeout     :", cfg.completionTimeoutSec, "s (" + human(cfg.completionTimeoutSec) + ")");
console.log("Ack timeout            :", cfg.ackTimeoutSec, "s (" + human(cfg.ackTimeoutSec) + ")");
console.log("Resolution timeout     :", cfg.resolutionTimeoutSec, "s (" + human(cfg.resolutionTimeoutSec) + ")");
console.log("Dispute window         :", cfg.disputeWindowSec, "s (" + human(cfg.disputeWindowSec) + ")");
console.log("Slash (ack/comp/disp)  :", pct(cfg.slashBps.ackTimeout) + " / " + pct(cfg.slashBps.completionTimeout) + " / " + pct(cfg.slashBps.dispute));
console.log("Slash cap              :", pct(cfg.slashBps.max));
console.log("Fee split (prot/wkr/p) :", pct(cfg.feeBps.protocol) + " / " + pct(cfg.feeBps.worker) + " / " + pct(cfg.feeBps.feePool));
console.log("Suspension threshold   :", cfg.suspensionThreshold, "consecutive timeouts");
console.log("Suspension cooldown    :", cfg.suspensionCooldownSec, "s (" + human(cfg.suspensionCooldownSec) + ")");`;
  }
  if (action === "job") {
    return `import { LightNode } from "lightnode-sdk";

const ln = new LightNode("${net}");

// Classify any job: 'submitted' / 'in-flight' / 'completed' / 'stalled' /
// 'disputed' / 'resolved'. The 'refundable' flag is true when the protocol's
// dispute window would refund the fee. Pass { withTransactions: true } to
// also resolve the submitJob + jobCompleted tx hashes (one eth_getLogs call
// per tx). Useful for deep-linking from your UI.
const status = await ln.getJobStatus(${jobId}n, { withTransactions: true });
if (!status) {
  console.log("not yet indexed");
} else {
  console.log("category     :", status.category);
  console.log("refundable   :", status.refundable);
  console.log("worker       :", status.worker);
  console.log("share LCAI   :", status.workerShareLcai);
  if (status.worker) {
    console.log("worker page  :", ln.explorerAddressUrl(status.worker));
  }
  if (status.submitTx) {
    console.log("submit tx    :", ln.explorerTxUrl(status.submitTx));
  }
  if (status.completionTx) {
    console.log("completion tx:", ln.explorerTxUrl(status.completionTx));
  }
}`;
  }
  return `import { WorkerOperator, LightNode } from "lightnode-sdk";
import { createPublicClient, http, formatEther } from "viem";

const chain = ${net === "mainnet"
    ? `{ id: 9200, name: "LightChain mainnet", nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.lightchain.ai"] } } }`
    : `{ id: 8200, name: "LightChain testnet", nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.lightchain.ai"] } } }`};
const publicClient = createPublicClient({ transport: http(chain.rpcUrls.default.http[0]), chain });
const worker = "${workerAddr}" as \`0x\${string}\`;

const op = new WorkerOperator("${net}", { publicClient, workerAddress: worker });
const ln = new LightNode("${net}");

// Fan out all the reads in parallel so the panel is one round-trip.
const [st, walletWei, w, jobs, served] = await Promise.all([
  op.status(),
  publicClient.getBalance({ address: worker }),
  ln.getWorker(worker),
  ln.getWorkerJobs(worker, 50),
  // Reconciled list: subgraph rows + on-chain WorkerRegistry.isEligible.
  // onchainEligible === true means the chain confirms the worker serves
  // this model right now (the indexer rows can go stale after a
  // deregister -> re-register cycle).
  ln.getServedModels(worker),
]);

// Friendlier number formatter so the runnable output matches the UI:
// rounds to 4 decimals, drops trailing zeros, adds thousands separators.
const fmtLcai = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
};
const relTime = (sec: number) => {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return \`\${Math.max(0, diff)}s ago\`;
  if (diff < 3600) return \`\${Math.round(diff / 60)} min ago\`;
  if (diff < 86400) { const h = Math.round(diff / 3600); return \`\${h} hour\${h === 1 ? "" : "s"} ago\`; }
  const d = Math.round(diff / 86400); return \`\${d} day\${d === 1 ? "" : "s"} ago\`;
};

console.log("Worker           :", st.address);
console.log("Registered       :", st.registered ? "yes" : "no");
console.log("Stake locked     :", fmtLcai(st.stakeLcai), "LCAI");
console.log("Claimable        :", fmtLcai(st.claimableLcai), "LCAI");
console.log("Wallet balance   :", fmtLcai(Number(formatEther(walletWei))), "LCAI");
console.log("Lifetime earned  :", fmtLcai(w?.total_earned ? Number(formatEther(BigInt(w.total_earned))) : 0), "LCAI");
console.log("Last seen        :", w?.last_seen_at ? relTime(w.last_seen_at) : "unknown");

// Served models (chain-confirmed first, then any indexer-only rows).
const live = served.filter(m => m.onchainEligible === true);
const stale = served.filter(m => m.onchainEligible === false && m.indexedActive);
console.log("Serving models   :", live.length ? live.map(m => m.name ?? m.modelId).join(", ") : "(none)");
if (stale.length) console.log("Stale index rows :", stale.map(m => m.name ?? m.modelId).join(", "));

// Bucket the last 50 jobs to surface what needs attention.
const now = Math.floor(Date.now() / 1000);
const buckets = { released: 0, pendingRelease: 0, stuck: 0, inFlight: 0 };
for (const j of jobs) {
  const s = (j.state ?? "").toLowerCase();
  if (s.includes("released") || s.includes("resolved")) buckets.released++;
  else if (s.includes("complet")) buckets.pendingRelease++;
  else if (s.includes("ack")) ((now - (j.ack_at ?? now)) > 3600 ? buckets.stuck++ : buckets.inFlight++);
  else if (s.includes("submitted")) buckets.inFlight++;
}
console.log("Released         :", buckets.released, "jobs (paid out)");
console.log("Pending release  :", buckets.pendingRelease, "jobs (awaiting settle)");
console.log("Stuck            :", buckets.stuck, "jobs (acked past deadline)");
console.log("Timed out        :", w?.jobs_timed_out ?? 0, "jobs (lifetime)");

// To WRITE (needs a PRIVATE_KEY for the worker key):
//   import { createWalletClient } from "viem";
//   import { privateKeyToAccount } from "viem/accounts";
//   const account = privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`);
//   const walletClient = createWalletClient({ account, transport: http(chain.rpcUrls.default.http[0]), chain });
//   const opRW = new WorkerOperator("${net}", { publicClient, walletClient });
//   await opRW.releaseAll();    // settle all completed jobs past their window
//   await opRW.withdraw();      // pull earned balance out
//   await opRW.deregister();    // exit (clears stuck first if blocked)
//   // For stuck jobs: const stuck = await opRW.stuckJobs([jobId1, jobId2]);
//   //                 for (const s of stuck) await opRW.claimTimeout(s.lookupId);`;
}

// --- Chat (Conversation) stepper -------------------------------------------

type ChatStep = 1 | 2 | 3;

interface ChatDemoResp {
  answer?: string;
  jobId?: string;
  worker?: string;
  remaining?: number;
  error?: string;
  runLocally?: boolean;
  howTo?: string;
}

interface WalletChatTurn {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  worker?: string | null;
  jobId?: string | null;
  submitTx?: string | null;
  jobCompletedTx?: string | null;
}

/** The LightChain atom mark (gradient logo), used as the assistant avatar. The
 *  viewBox frames the atom only - no wordmark. */
function LcaiMark({ className }: { className?: string }) {
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

/** Inline copy-to-clipboard control for a chat answer, with a brief confirmation. */
function ChatCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }, () => undefined);
      }}
      className="inline-flex items-center gap-1 hover:text-content-primary"
      aria-label="Copy answer"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function ChatRecipe() {
  const [step, setStep] = useState<ChatStep>(1);
  const [model, setModel] = useState<"llama3-8b" | "llama3-70b">("llama3-8b");
  const [system, setSystem] = useState<string>("You are a concise assistant. Reply in one or two short sentences.");
  const [input, setInput] = useState<string>("");
  const [turns, setTurns] = useState<WalletChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { address: connectedAddress } = useAccount();
  const { chain: connectedChain } = useAccount();
  const walletNetwork: PreflightNet | null =
    connectedChain?.id === 9200 ? "mainnet" : connectedChain?.id === 8200 ? "testnet" : null;
  const { data: walletClient } = useWalletClient({ chainId: connectedChain?.id });
  const publicClient = usePublicClient({ chainId: connectedChain?.id });

  // Per-turn fee comes from AIConfig on the connected network.
  const [feeLcai, setFeeLcai] = useState<number | null>(null);
  useEffect(() => {
    if (!walletNetwork) { setFeeLcai(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { estimateJobFee, NETWORKS: SDK_NETWORKS } = await import("lightnode-sdk");
        const fee = await estimateJobFee(SDK_NETWORKS[walletNetwork], model);
        if (!cancelled) setFeeLcai(fee);
      } catch {
        if (!cancelled) setFeeLcai(null);
      }
    })();
    return () => { cancelled = true; };
  }, [walletNetwork, model]);

  // Keep the latest turn (and the streaming indicator) in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns, busy]);

  /**
   * Compose the OpenAI-style chat history into a single prompt the way the
   * SDK's `Conversation` helper does internally: system block at the top,
   * then `User: ...` / `Assistant: ...` lines per turn, then the new user
   * message. Llama-style instruction-tuned models handle this layout.
   */
  function composeChatPrompt(history: WalletChatTurn[], next: string): { system: string; prompt: string } {
    const lines: string[] = [];
    for (const t of history) {
      lines.push(`${t.role === "user" ? "User" : "Assistant"}: ${t.text}`);
    }
    lines.push(`User: ${next}`);
    lines.push("Assistant:");
    return { system: system.trim(), prompt: lines.join("\n\n") };
  }

  /** Patch the trailing assistant turn (the streaming placeholder) in place. */
  function patchLastAssistant(patch: Partial<WalletChatTurn>) {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), { ...last, ...patch }];
    });
  }

  async function run() {
    if (!walletClient || !publicClient || !connectedAddress || !walletNetwork) {
      setErr("Connect a wallet on testnet or mainnet first.");
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
      const { siweSignIn, GatewayClient, runInference, NETWORKS: SDK_NETWORKS } = await import("lightnode-sdk");
      const network = SDK_NETWORKS[walletNetwork];
      setBusyStage("Asking your wallet to sign in (SIWE)...");
      const session = await siweSignIn(walletClient as unknown as Parameters<typeof siweSignIn>[0], walletNetwork);
      setBusyStage("Sign the createSession transaction in your wallet...");
      const gateway = new GatewayClient({ network: walletNetwork, bearer: session.bearer });
      const composed = composeChatPrompt(history, next);
      const result = await runInference({
        prompt: composed.system ? `${composed.system}\n\n${composed.prompt}` : composed.prompt,
        gateway,
        wallet: walletClient as unknown as Parameters<typeof runInference>[0]["wallet"],
        publicClient: publicClient as unknown as Parameters<typeof runInference>[0]["publicClient"],
        network,
        model,
        jobCompletedTimeoutMs: 120_000,
        maxRetries: 1,
        // Stream each decrypted chunk into the assistant bubble as it arrives.
        onChunk: (_chunk, totalSoFar) => {
          setBusyStage("");
          patchLastAssistant({ text: totalSoFar });
        },
      });
      patchLastAssistant({
        text: result.answer,
        streaming: false,
        worker: result.worker,
        jobId: result.jobId?.toString() ?? null,
        submitTx: result.txs?.submitJob ?? null,
        jobCompletedTx: result.txs?.jobCompleted ?? null,
      });
    } catch (e) {
      // Rollback the optimistic turns so the visitor can edit and retry.
      setTurns(history);
      setInput(next);
      const msg = (e as Error).message ?? "chat failed";
      const friendly = /user rejected|user denied|cancelled|reject/i.test(msg)
        ? "You rejected the wallet popup. Reopen and approve to send the message."
        : /insufficient funds|insufficient balance/i.test(msg)
          ? `Wallet has no ${walletNetwork === "mainnet" ? "LCAI" : "testnet LCAI"}. Top it up before trying again.`
          : /selection_mismatch|selection was superseded|409/.test(msg)
            ? walletNetwork === "testnet"
              ? "LightChain testnet dispatcher returned 409 selection_mismatch. Reproduced upstream, this is a testnet dispatcher issue, not your wallet. Switch to mainnet for an immediate working chat, or wait for the LightChain team to fix the testnet pod."
              : "Another session for this wallet is in flight on the gateway. This usually means chat.lightchain.ai (or another LightChain dApp) is open in a different tab signed into the same wallet. Close those tabs and try again."
            : msg.split("\n")[0];
      setErr(friendly);
    } finally {
      setBusy(false);
      setBusyStage("");
    }
  }

  const snippet = `import { Conversation } from "lightnode-sdk";

const chat = new Conversation({
  network: "${walletNetwork ?? "mainnet"}",
  privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
  model: "${model}",
  system: ${JSON.stringify(system)},
  maxHistoryTurns: 20,
});

// Multi-turn: each .send() carries the prior history forward.
const r1 = await chat.send(${JSON.stringify(turns[0]?.text ?? "Who wrote The Great Gatsby?")});
console.log("answer 1:", r1.answer);

const r2 = await chat.send("In what year?");   // sees the prior turn
console.log("answer 2:", r2.answer);

console.log("full transcript:", chat.messages());`;

  return (
    <StepperShell step={step as BridgeStep} labels={["Model", "Prompt", "Use it"]}>
      {step === 1 ? (
        <div>
          <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Pick a model</h3>
          <p className="mt-1 text-sm text-content-soft">Both run on the LightChain testnet worker pool.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {([
              { id: "llama3-8b" as const, label: "llama3-8b", sub: "8B params - fast, free testnet" },
              { id: "llama3-70b" as const, label: "llama3-70b", sub: "70B params - more capable, slightly slower" },
            ]).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { setModel(m.id); setStep(2); }}
                className={`group flex items-center gap-3 rounded-xl border bg-card p-5 text-left transition-all hover:-translate-y-0.5 ${
                  model === m.id ? "border-primary shadow-[0_0_0_1px_var(--primary)_inset]" : "border-bdr-soft hover:border-bdr-light"
                }`}
              >
                <div className="grid size-10 place-items-center rounded-lg bg-surface-base-faint">
                  <Workflow className="size-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm font-semibold text-content-primary">{m.label}</div>
                  <div className="truncate text-xs text-content-soft">{m.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div>
          <StepBack onClick={() => setStep(1)} />
          <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Multi-turn chat</h3>
          <p className="mt-1 text-sm text-content-soft">
            One encrypted inference per turn against <span className="font-mono text-content-default">{model}</span>.
            History accumulates client-side and is replayed into each new prompt - the same pattern the SDK&apos;s{" "}
            <code className="font-mono text-content-default">Conversation</code> helper uses.
          </p>

          {/* Wallet status row */}
          <div className="mt-5 rounded-lg border border-bdr-soft bg-card p-4">
            {!connectedAddress ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-content-soft">Connect a wallet on mainnet (chain 9200) or testnet (chain 8200).</div>
                <ConnectButton size="sm" />
              </div>
            ) : !walletNetwork ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-content-soft">Your wallet is on an unsupported chain. Switch to LightChain mainnet or testnet.</div>
                <ConnectButton size="sm" />
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="text-content-soft">
                  Connected on <span className="font-mono text-content-primary">{walletNetwork}</span> as{" "}
                  <code className="font-mono text-content-default">{connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)}</code>.
                  {" "}Each turn costs{" "}
                  {feeLcai != null ? (
                    <span className="font-mono text-content-primary">{feeLcai} LCAI</span>
                  ) : (
                    <span className="text-content-soft">(fetching fee…)</span>
                  )}
                  {" "}plus a small amount of gas.
                  {walletNetwork === "testnet" ? (
                    <>
                      {" "}Get free testnet LCAI from{" "}
                      <a href="https://lightfaucet.ai" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">lightfaucet.ai</a>.
                    </>
                  ) : null}
                </div>
                <ConnectButton size="sm" />
              </div>
            )}
          </div>
          {walletNetwork === "testnet" ? (
            <p className="mt-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-content-default">
              <strong>Heads up:</strong> the LightChain testnet dispatcher is currently returning 409 selection_mismatch on every prepareSession call. Mainnet works on the same code. If you hit it, switch to mainnet.
            </p>
          ) : null}

          {/* System prompt (collapsible) */}
          <details className="mt-4 rounded-lg border border-bdr-soft bg-card">
            <summary className="cursor-pointer px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-content-soft hover:text-content-primary">System prompt (optional)</summary>
            <div className="border-t border-bdr-soft p-3">
              <textarea
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-xs text-content-primary outline-none focus:border-primary/60"
              />
            </div>
          </details>

          {/* Chat thread */}
          {turns.length > 0 ? (
            <div className="mt-4 flex max-h-[420px] flex-col gap-5 overflow-y-auto pr-1">
              {turns.map((t, i) =>
                t.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-surface-base-faint px-4 py-2.5 text-sm text-content-primary">
                      {t.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="group flex gap-3">
                    <LcaiMark className="mt-0.5 size-7 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      {t.text ? (
                        <div className="max-w-none text-sm leading-relaxed text-content-default [&_*:first-child]:mt-0 [&_*:last-child]:mb-0">
                          <Streamdown>{t.text}</Streamdown>
                        </div>
                      ) : (
                        <div className="animate-pulse-dot pt-1 text-sm text-content-soft">
                          {busyStage || "Writing on chain…"}
                        </div>
                      )}
                      {(t.worker || t.submitTx) ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-content-soft opacity-0 transition-opacity group-hover:opacity-100">
                          <ChatCopyButton text={t.text} />
                          {t.worker ? (
                            <span className="inline-flex items-center gap-1">
                              worker <code className="font-mono">{t.worker.slice(0, 8)}…{t.worker.slice(-4)}</code>
                              <a href={`https://${walletNetwork ?? "mainnet"}.lightscan.app/address/${t.worker}`} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                                <ExternalLink className="size-3" />
                              </a>
                            </span>
                          ) : null}
                          {t.jobId ? <span>job <code className="font-mono">#{t.jobId}</code></span> : null}
                          {t.submitTx ? (
                            <a href={`https://${walletNetwork ?? "mainnet"}.lightscan.app/tx/${t.submitTx}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                              submitJob <ExternalLink className="size-3" />
                            </a>
                          ) : null}
                          {t.jobCompletedTx ? (
                            <a href={`https://${walletNetwork ?? "mainnet"}.lightscan.app/tx/${t.jobCompletedTx}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                              completed <ExternalLink className="size-3" />
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              )}
              <div ref={endRef} />
            </div>
          ) : null}

          {/* Input + send */}
          <div className="mt-4">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!busy && input.trim()) run(); }
              }}
              rows={2}
              maxLength={500}
              placeholder={turns.length === 0 ? "Ask anything… (cmd+enter to send)" : "Reply…"}
              className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-xs text-content-primary outline-none focus:border-primary/60"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              {turns.length > 0 ? (
                <button
                  type="button"
                  onClick={() => { setTurns([]); setErr(null); }}
                  className="text-[11px] text-content-soft hover:text-content-primary"
                >
                  Reset thread
                </button>
              ) : <span />}
              <button
                type="button"
                onClick={() => {
                  if (busy || !input.trim() || !connectedAddress || !walletNetwork) return;
                  run();
                }}
                disabled={busy || !input.trim() || !connectedAddress || !walletNetwork}
                className="flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(0,0,0,0.25)] transition-all duration-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: "linear-gradient(94deg, #dd00ac 10.66%, #7130c3 53.03%, #410093 96.34%)" }}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {busyStage || "Signing and dispatching"}
                  </>
                ) : (
                  turns.length === 0 ? "Send first message" : "Send"
                )}
              </button>
            </div>
          </div>

          {err ? (
            <p className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-content-default">{err}</p>
          ) : null}
          {turns.length > 0 ? (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="text-[11px] text-content-soft underline-offset-2 hover:text-primary hover:underline"
              >
                Get the code →
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <UseItStep
          onBack={() => setStep(2)}
          title="Conversation SDK"
          hint={`Targets ${model} on testnet. PRIVATE_KEY must be funded with ≥0.02 LCAI per call (use the testnet faucet).`}
          snippet={snippet}
          needsKey={true}
        />
      ) : null}
    </StepperShell>
  );
}

// --- Preflight stepper ------------------------------------------------------
// Live demo requires a funded key + a real inference per click, which would
// burn the demo wallet. Step 2 shows a canned representative output instead;
// the visitor runs the real thing locally / in StackBlitz with their own key.

interface PreflightDemoResp {
  verdict?: "ok" | "over-deadline" | "stalled" | "failed";
  elapsedMs?: number | null;
  worker?: string | null;
  submitJobTx?: string | null;
  jobCompletedTx?: string | null;
  answer?: string | null;
  summary?: string;
  remaining?: number;
  error?: string;
  runLocally?: boolean;
}

type PreflightNet = "testnet" | "mainnet";

// Templates the inference widget ships out of the box. Picking one swaps the
// prompt + system in the textareas so the visitor can see the shape of the
// pattern, then edit it freely.
type InferenceTemplate = {
  id: "judge" | "classify" | "freeform";
  label: string;
  hint: string;
  system: string;
  prompt: string;
};
const INFERENCE_TEMPLATES: InferenceTemplate[] = [
  {
    id: "judge",
    label: "AI Judge",
    hint: "The LightChallenge pattern: did the user complete the task? STRICT JSON out.",
    system: "You are a careful judge. Reply with STRICT JSON only, no prose.",
    prompt: `Did the user complete the challenge "Run a mile under 8 minutes"?

Evidence: { distance_km: 1.61, time_minutes: 7.4 }

Reply: { "passed": boolean, "confidence": 0-1, "reason": string }`,
  },
  {
    id: "classify",
    label: "Classifier",
    hint: "Sentiment / topic / safety. Useful for meme-coin signal, NFT moderation, etc.",
    system: "You classify short texts. Reply with one of: bullish, bearish, neutral. Nothing else.",
    prompt: "the new partnership announcement looks promising and the chart is breaking out",
  },
  {
    id: "freeform",
    label: "Freeform",
    hint: "Plain Q&A. Whatever you want.",
    system: "You are a concise assistant. One short sentence.",
    prompt: "Reply with the single word OK.",
  },
];

function InferenceRecipe() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [model, setModel] = useState<"llama3-8b" | "llama3-70b">("llama3-8b");
  const [tmplId, setTmplId] = useState<InferenceTemplate["id"]>("judge");
  const activeTmpl = INFERENCE_TEMPLATES.find((t) => t.id === tmplId) ?? INFERENCE_TEMPLATES[0];
  const [prompt, setPrompt] = useState<string>(activeTmpl.prompt);
  const [system, setSystem] = useState<string>(activeTmpl.system);
  function applyTemplate(id: InferenceTemplate["id"]) {
    const t = INFERENCE_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setTmplId(id);
    setPrompt(t.prompt);
    setSystem(t.system);
  }
  // The network follows whichever chain the visitor's wallet is connected
  // to. No demo-wallet fallback - we route through the user's own funded
  // key so there is no shared gateway state to contend with.
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState<string>("");
  const [verdict, setVerdict] = useState<PreflightDemoResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { address: connectedAddress } = useAccount();
  const { chain: connectedChain } = useAccount();
  const walletNetwork: PreflightNet | null =
    connectedChain?.id === 9200 ? "mainnet" : connectedChain?.id === 8200 ? "testnet" : null;
  const { data: walletClient } = useWalletClient({ chainId: connectedChain?.id });
  const publicClient = usePublicClient({ chainId: connectedChain?.id });
  // Read the live model fee from AIConfig for the connected network so we
  // do not lie about cost (hardcoding misrepresents what the wallet popup
  // will actually demand). 8b/70b have different fees.
  const [feeLcai, setFeeLcai] = useState<number | null>(null);
  useEffect(() => {
    if (!walletNetwork) { setFeeLcai(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { estimateJobFee, NETWORKS: SDK_NETWORKS } = await import("lightnode-sdk");
        const fee = await estimateJobFee(SDK_NETWORKS[walletNetwork], model);
        if (!cancelled) setFeeLcai(fee);
      } catch {
        if (!cancelled) setFeeLcai(null);
      }
    })();
    return () => { cancelled = true; };
  }, [walletNetwork, model]);

  async function run() {
    if (!walletClient || !publicClient || !connectedAddress || !walletNetwork) {
      setErr("Connect a wallet on testnet or mainnet first.");
      return;
    }
    setBusy(true);
    setErr(null);
    setVerdict(null);
    const t0 = Date.now();
    try {
      const { siweSignIn, GatewayClient, runInference, NETWORKS: SDK_NETWORKS } = await import("lightnode-sdk");
      const network = SDK_NETWORKS[walletNetwork];
      setBusyStage("Asking your wallet to sign in (SIWE)...");
      const session = await siweSignIn(walletClient as unknown as Parameters<typeof siweSignIn>[0], walletNetwork);
      setBusyStage("Sign the createSession transaction in your wallet...");
      const gateway = new GatewayClient({ network: walletNetwork, bearer: session.bearer });
      // Compose system + prompt the same way the SDK's Conversation helper
      // does for a single turn: a leading system block, blank line, then the
      // user prompt. Most llama3 prompt templates respect this layout.
      const composed = (system ?? "").trim()
        ? `${system.trim()}\n\n${prompt}`
        : prompt;
      const result = await runInference({
        prompt: composed,
        gateway,
        wallet: walletClient as unknown as Parameters<typeof runInference>[0]["wallet"],
        publicClient: publicClient as unknown as Parameters<typeof runInference>[0]["publicClient"],
        network,
        model,
        jobCompletedTimeoutMs: 120_000,
        maxRetries: 1,
      });
      const elapsedMs = Date.now() - t0;
      // Mainnet 8b workers can take 60-90s under load; the 45s deadline
      // was making OK responses look like over-deadline failures. Use
      // the same 120s budget the SDK's runInference defaults to.
      const DEADLINE_MS = 120_000;
      const v: PreflightDemoResp = {
        verdict: elapsedMs > DEADLINE_MS ? "over-deadline" : "ok",
        elapsedMs,
        worker: result.worker ?? null,
        submitJobTx: result.txs?.submitJob ?? null,
        jobCompletedTx: result.txs?.jobCompleted ?? null,
        answer: result.answer ?? null,
        summary:
          elapsedMs > DEADLINE_MS
            ? `Answer arrived but took ${(elapsedMs / 1000).toFixed(1)}s, over the ${DEADLINE_MS / 1000}s deadline.`
            : `OK in ${(elapsedMs / 1000).toFixed(1)}s. ${result.answer.length} chars from worker ${result.worker ?? "?"}.`,
      };
      setVerdict(v);
    } catch (e) {
      const msg = (e as Error).message ?? "preflight failed";
      // Translate the common surfaces.
      // - user rejected: SIWE / tx popup dismissed
      // - insufficient funds: empty wallet
      // - selection_mismatch: ANOTHER session for this wallet is in flight
      //   (almost always chat.lightchain.ai open in another tab signed into
      //   the same wallet). The SDK already retried up to 6x over ~35s; if
      //   the contention is sustained, no client retry will win.
      const friendly = /user rejected|user denied|cancelled|reject/i.test(msg)
        ? "You rejected the wallet popup. Reopen and approve to run preflight."
        : /insufficient funds|insufficient balance/i.test(msg)
          ? `Wallet has no ${walletNetwork === "mainnet" ? "LCAI" : "testnet LCAI"}. Top it up before trying again.`
          : /selection_mismatch|selection was superseded|409/.test(msg)
            ? walletNetwork === "testnet"
              ? "LightChain testnet dispatcher returned 409 selection_mismatch. Reproduced upstream, this is a testnet dispatcher issue, not your wallet. Switch to mainnet for an immediate working preflight, or wait for the LightChain team to fix the testnet pod."
              : "Another session for this wallet is in flight on the gateway. This usually means chat.lightchain.ai (or another LightChain dApp) is open in a different tab signed into the same wallet. Close those tabs and try again."
            : msg.split("\n")[0];
      setErr(friendly);
    } finally {
      setBusy(false);
      setBusyStage("");
    }
  }

  const snippet = `import { workerPreflight, LightNode } from "lightnode-sdk";

const ln = new LightNode("testnet");

// CI-friendly preflight: workerPreflight handles SIWE -> session ->
// createSession -> wait -> decrypt for you. lightnode-sdk >= 0.7.10
// auto-retries gateway 409 selection_mismatch internally, so on your
// OWN funded wallet you do not need an outer retry loop.
const r = await workerPreflight({
  network: "testnet",
  privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
  model: "${model}",
  deadlineMs: 60_000,
});
console.log("verdict       :", r.verdict);    // "ok" | "over-deadline" | "stalled" | "failed"
console.log("elapsed (ms)  :", r.elapsedMs ?? "(none)");
console.log("worker        :", r.worker ?? "(none assigned)");
if (r.worker) console.log("worker page   :", ln.explorerAddressUrl(r.worker));
if (r.txs?.submitJob) console.log("submitJob tx  :", ln.explorerTxUrl(r.txs.submitJob));
if (r.verdict !== "ok") {
  console.log("why           :", r.summary);
  process.exit(1);
}

// Free read - top testnet workers (no key needed). Use it to compare
// your verdict against the rest of the pool. WorkerStat fields:
//   - success: completed jobs in the sample
//   - p50: median processing seconds (null until enough data)
//   - completionRate: success / (success + incomplete + disputed)
const top = await ln.getWorkerStats(500, 5);
console.log("\\nTop 5 testnet workers (last 500 jobs):");
for (const w of top) {
  console.log(
    w.address,
    "jobs:", w.success,
    "p50:", w.p50 != null ? w.p50.toFixed(1) + "s" : "n/a",
    "completion:", w.completionRate != null ? (w.completionRate * 100).toFixed(0) + "%" : "n/a",
  );
}

// -----------------------------------------------------------------------------
// Browser pattern (what the /build/sdks/preflight widget runs with your wallet):
// -----------------------------------------------------------------------------
//   import { siweSignIn, GatewayClient, runInference, NETWORKS } from "lightnode-sdk";
//   import { useAccount, useWalletClient, usePublicClient } from "wagmi";
//
//   const { address, chain } = useAccount();
//   const { data: walletClient } = useWalletClient({ chainId: chain?.id });
//   const publicClient = usePublicClient({ chainId: chain?.id });
//
//   // 1. SIWE -> JWT (one wallet popup, no gas).
//   const session = await siweSignIn(walletClient, chain.id === 9200 ? "mainnet" : "testnet");
//
//   // 2. Authenticated gateway client (the JWT is its Authorization Bearer).
//   const gateway = new GatewayClient({ network: "testnet", bearer: session.bearer });
//
//   // 3. Run inference with the wallet (one tx popup for createSession).
//   const result = await runInference({
//     prompt: "Reply with the single word OK.",
//     gateway, wallet: walletClient, publicClient,
//     network: NETWORKS.testnet, model: "${model}",
//   });`;

  return (
    <StepperShell step={step as BridgeStep} labels={["Model", "Live verdict", "Use it"]}>
      {step === 1 ? (
        <div>
          <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Pick a model</h3>
          <p className="mt-1 text-sm text-content-soft">
            Preflight signs one encrypted inference against the testnet pool. The demo wallet pays.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {([
              { id: "llama3-8b" as const, label: "llama3-8b", sub: "8B params - fastest path" },
              { id: "llama3-70b" as const, label: "llama3-70b", sub: "70B params - slower, hits more workers" },
            ]).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { setModel(m.id); setStep(2); }}
                className={`group flex items-center gap-3 rounded-xl border bg-card p-5 text-left transition-all hover:-translate-y-0.5 ${
                  model === m.id ? "border-primary shadow-[0_0_0_1px_var(--primary)_inset]" : "border-bdr-soft hover:border-bdr-light"
                }`}
              >
                <div className="grid size-10 place-items-center rounded-lg bg-surface-base-faint">
                  <PlayCircle className="size-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm font-semibold text-content-primary">{m.label}</div>
                  <div className="truncate text-xs text-content-soft">{m.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {step === 2 ? (
        <div>
          <StepBack onClick={() => setStep(1)} />
          <h3 className="text-2xl font-semibold tracking-tight text-content-primary">Run a live inference</h3>
          <p className="mt-1 text-sm text-content-soft">
            Sends your prompt to <code className="font-mono text-content-default">{model}</code> on the encrypted
            network and reports the answer plus on-chain proof (submitJob + jobCompleted tx).
          </p>

          {/* Templates row - tap to swap into the prompt textarea. */}
          <div className="mt-5 flex flex-wrap gap-2">
            {INFERENCE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t.id)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all ${
                  tmplId === t.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-bdr-soft bg-surface-base-faint text-content-soft hover:border-bdr-light hover:text-content-primary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-content-soft">{activeTmpl.hint}</p>

          {/* System + prompt textareas - the visitor can freely edit. */}
          <div className="mt-4 grid gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.18em] text-content-soft">System prompt (optional)</span>
              <textarea
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                rows={2}
                className="rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-xs text-content-primary focus:border-primary focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.18em] text-content-soft">Prompt</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={Math.min(8, Math.max(3, prompt.split("\n").length + 1))}
                className="rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-xs text-content-primary focus:border-primary focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-5 rounded-lg border border-bdr-soft bg-card p-4">
            {!connectedAddress ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-content-soft">Connect a wallet on mainnet (chain 9200) or testnet (chain 8200).</div>
                <ConnectButton size="sm" />
              </div>
            ) : !walletNetwork ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-content-soft">Your wallet is on an unsupported chain. Switch to LightChain mainnet or testnet.</div>
                <ConnectButton size="sm" />
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="text-content-soft">
                  Connected on <span className="font-mono text-content-primary">{walletNetwork}</span> as{" "}
                  <code className="font-mono text-content-default">{connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)}</code>.
                  {" "}One preflight costs{" "}
                  {feeLcai != null ? (
                    <span className="font-mono text-content-primary">{feeLcai} LCAI</span>
                  ) : (
                    <span className="text-content-soft">(fetching fee…)</span>
                  )}
                  {" "}plus a small amount of gas.
                  {walletNetwork === "testnet" ? (
                    <>
                      {" "}Get free testnet LCAI from{" "}
                      <a href="https://lightfaucet.ai" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">lightfaucet.ai</a>.
                    </>
                  ) : null}
                </div>
                <ConnectButton size="sm" />
              </div>
            )}
          </div>
          {walletNetwork === "testnet" ? (
            <p className="mt-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-content-default">
              <strong>Heads up:</strong> the LightChain testnet dispatcher is currently returning 409 selection_mismatch on every prepareSession call (reproduced against the live <code className="font-mono">chat-api.testnet.lightchain.ai</code> with a brand-new wallet and no concurrent traffic; mainnet works fine on the same code). If you hit it, switch to mainnet to try the flow. The SDK code is identical and the fee is the same 0.02 LCAI.
            </p>
          ) : null}
          <div className="mt-5">
            <PreviewButton
              onClick={run}
              busy={busy}
              idle="Run inference with my wallet"
              working={busyStage || "Signing and dispatching"}
            />
          </div>
          {err ? (
            <p className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-content-default">{err}</p>
          ) : null}
          {verdict ? (
            <div className="mt-6 rounded-lg border border-bdr-soft bg-surface-base-faint p-4">
              <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-content-soft">Live answer + on-chain proof</p>
              {verdict.answer ? (
                <div className="mb-4 rounded-md border border-bdr-soft bg-card p-3">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-content-soft">Answer</p>
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs text-content-primary">{verdict.answer}</pre>
                </div>
              ) : null}
              <dl className="grid gap-1.5 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-content-soft">Status</dt>
                  <dd><Badge tone={verdict.verdict === "ok" ? "success" : "warning"}>{verdict.verdict}</Badge></dd>
                </div>
                {verdict.elapsedMs != null ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-content-soft">Elapsed</dt>
                    <dd className="font-mono text-content-primary">{verdict.elapsedMs} ms ({(verdict.elapsedMs / 1000).toFixed(1)} s)</dd>
                  </div>
                ) : null}
                {verdict.worker ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-content-soft">Worker</dt>
                    <dd className="inline-flex items-center gap-2">
                      <code className="font-mono text-content-default">{verdict.worker.slice(0, 12)}…{verdict.worker.slice(-6)}</code>
                      <a
                        href={`https://${walletNetwork ?? "mainnet"}.lightscan.app/address/${verdict.worker}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open worker on Lightscan"
                        className="text-content-soft transition-colors hover:text-primary"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </dd>
                  </div>
                ) : null}
                {verdict.submitJobTx ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-content-soft">submitJob tx</dt>
                    <dd className="inline-flex items-center gap-2">
                      <code className="font-mono text-content-default">{verdict.submitJobTx.slice(0, 10)}…{verdict.submitJobTx.slice(-6)}</code>
                      <a
                        href={`https://${walletNetwork ?? "mainnet"}.lightscan.app/tx/${verdict.submitJobTx}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open submitJob tx on Lightscan"
                        className="text-content-soft transition-colors hover:text-primary"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </dd>
                  </div>
                ) : null}
                {verdict.jobCompletedTx ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-content-soft">jobCompleted tx</dt>
                    <dd className="inline-flex items-center gap-2">
                      <code className="font-mono text-content-default">{verdict.jobCompletedTx.slice(0, 10)}…{verdict.jobCompletedTx.slice(-6)}</code>
                      <a
                        href={`https://${walletNetwork ?? "mainnet"}.lightscan.app/tx/${verdict.jobCompletedTx}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open jobCompleted tx on Lightscan"
                        className="text-content-soft transition-colors hover:text-primary"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </dd>
                  </div>
                ) : null}
              </dl>
              {verdict.summary ? (
                <p className="mt-3 rounded-md border border-bdr-soft bg-card px-3 py-2 text-xs leading-relaxed text-content-default">{verdict.summary}</p>
              ) : null}
              <details className="mt-3 rounded-lg border border-bdr-soft bg-card">
                <summary className="cursor-pointer px-3 py-2 text-[11px] text-content-soft hover:text-content-primary">Show raw JSON</summary>
                <pre className="overflow-x-auto border-t border-bdr-soft px-3 py-2 font-mono text-[11px] text-content-default">{JSON.stringify(verdict, null, 2)}</pre>
              </details>
              <GetTheCodeCTA onClick={() => setStep(3)} />
            </div>
          ) : null}
        </div>
      ) : null}
      {step === 3 ? (
        <UseItStep
          onBack={() => setStep(2)}
          title="Preflight SDK"
          hint={`Targets testnet (free). PRIVATE_KEY must be funded from the faucet (~0.022 LCAI per call).`}
          snippet={snippet}
          needsKey={true}
        />
      ) : null}
    </StepperShell>
  );
}

function BatchExplainer() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-content-soft">
      <p>
        Running many inferences serially is a typical first attempt that drags total wall-clock to{" "}
        <span className="font-semibold text-content-primary">N x p95-per-call</span>. <code className="font-mono text-content-default">runInferenceBatch</code> caps
        concurrency at whatever you pick, hands each slot a fresh session, and surfaces per-slot errors so one stalled
        worker does not kill the run.
      </p>
      <ul className="space-y-2 pl-4">
        <li className="list-disc"><span className="text-content-primary">Stable order.</span> Result at index N corresponds to prompt at index N.</li>
        <li className="list-disc"><span className="text-content-primary">Per-slot retry.</span> Stalls and reverts do not propagate.</li>
        <li className="list-disc"><span className="text-content-primary">Live progress.</span> <code className="font-mono text-content-default">onSlotComplete</code> fires per slot.</li>
        <li className="list-disc"><span className="text-content-primary">Cancellable.</span> Pass an <code className="font-mono text-content-default">AbortSignal</code> to stop queued slots.</li>
      </ul>
      <p className="text-xs text-content-soft">
        Fits batch evals, content scoring, RAG re-ranking, parallel rewrites. The runnable example is below; one click
        opens it in StackBlitz with a sample three-prompt batch.
      </p>
    </div>
  );
}

function AgentExplainer() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-content-soft">
      <p>
        Most agent frameworks assume the model knows native function calling. The LightChain pool runs open models
        (llama3-8b, llama3-70b) without that capability. The <code className="font-mono text-content-default">Agent</code> class drives the same loop with simple
        string markers: <code className="font-mono text-content-default">&lt;tool&gt;name {`{...args}`}&lt;/tool&gt;</code> /{" "}
        <code className="font-mono text-content-default">&lt;answer&gt;...&lt;/answer&gt;</code>.
      </p>
      <ul className="space-y-2 pl-4">
        <li className="list-disc"><span className="text-content-primary">Bring your own tools.</span> Each handler is a plain async function returning JSON.</li>
        <li className="list-disc"><span className="text-content-primary">Per-step trace.</span> <code className="font-mono text-content-default">{"{ steps }"}</code> includes every thought, tool call, and observation.</li>
        <li className="list-disc"><span className="text-content-primary">Bounded.</span> <code className="font-mono text-content-default">maxIterations</code> caps the wall clock + cost.</li>
        <li className="list-disc"><span className="text-content-primary">Works on small models.</span> No native function calling required.</li>
      </ul>
      <p className="text-xs text-content-soft">
        Fits autonomous tasks, search + summarise, lookup chains, deterministic side effects. The runnable example is
        below with two built-in tools (<code className="font-mono text-content-default">add</code>,{" "}
        <code className="font-mono text-content-default">now</code>) so it starts producing tool calls right away.
      </p>
    </div>
  );
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
