"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Rocket, Loader2, CheckCircle2, XCircle, ShieldCheck, Download,
  Wand2, Copy, Check, Eye, EyeOff, Wallet, AlertTriangle, ArrowRight, ArrowUpRight, RefreshCw, Gauge, KeyRound,
} from "lucide-react";
import { useAccount, useChainId, useBalance, useSendTransaction, useWaitForTransactionReceipt, useSwitchChain, usePublicClient } from "wagmi";
import { parseEther, formatEther, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { useNetwork } from "@/lib/network-context";
import { DEFAULT_MODEL, NETWORKS, type NetworkId } from "@/lib/network";
import { desktopInstallCommand, type OS } from "@/lib/scriptgen";
import { appendCleanLog } from "@/lib/install-log";
import { InstallProgress } from "@/components/onboard/install-progress";
import { detectClientOS } from "@/lib/os-detect";
import { isDesktop, runSetupStreamed, generateWorkerKey, localWorkerInfo, openExternal, type LocalWorkerInfo } from "@/lib/tauri";
import { shortAddr } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { getSecret, setSecret, getWorkerAddr, setWorkerAddr, resolveManagedWorkerAddr, getServedModels, setServedModels, migrateBareWorkerKey, archiveRetiredWorker, nativeSecretsAvailable, SECRET_WORKER_KEY, SECRET_WORKER_PW } from "@/lib/secrets";
import { useSavedWorkers } from "@/lib/saved-workers";
import { fetchWorker } from "@/lib/subgraph";

type Phase = "idle" | "running" | "done" | "failed";
type FundMode = "wallet" | "paste";
const PRIVKEY_RE = /^0x[a-fA-F0-9]{64}$/;

// In-flight secrets persist so a reload never loses the funded key/password
// (which would orphan the stake). On desktop they live in the OS keychain
// (via the secrets module); on web they fall back to localStorage. The worker
// ADDRESS is public, so it stays in localStorage for the dashboard.
function lsGet(k: string): string {
  try { return window.localStorage.getItem(k) ?? ""; } catch { return ""; }
}
function lsSet(k: string, v: string): void {
  try { window.localStorage.setItem(k, v); } catch { /* storage unavailable */ }
}

/** Cryptographically-strong keystore password. */
function strongPassword(len = 20): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      className="inline-flex items-center gap-1 text-[11px] text-content-soft transition-colors hover:text-content-primary"
    >
      {done ? <Check className="size-3 text-success" /> : <Copy className="size-3" />} {done ? "Copied" : "Copy"}
    </button>
  );
}

/** QR of an EIP-681 payment URI - scanning it in a mobile wallet prefills the
 *  recipient, amount and chain for a one-tap native transfer. */
function FundingQr({ uri }: { uri: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: "#0b0b14", light: "#ffffff" } })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [uri]);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Scan to fund" width={104} height={104} className="rounded-lg ring-1 ring-black/5" />;
}

/** A numbered, glassy step container - the spine of the spacious layout. */
function StepCard({ n, title, aside, children }: { n: number; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-bdr-soft bg-card/50 p-5 transition-colors hover:border-bdr-light">
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/30">
            {n}
          </span>
          <span className="text-sm font-semibold text-content-primary">{title}</span>
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** The keystore-password input (body only; the label + Generate live in the StepCard). */
function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Masked by default - reveal only when you want to read/copy it (shoulder-surfing).
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="relative">
        {/* type=text + CSS masking, so WebKit AutoFill never hijacks/replaces the value */}
        <input
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="choose or generate a strong password"
          style={show ? undefined : ({ WebkitTextSecurity: "disc" } as React.CSSProperties)}
          className="h-11 w-full rounded-xl border border-bdr-soft bg-card/60 px-3.5 pr-[5.5rem] font-mono text-sm text-content-primary outline-none transition-all placeholder:text-content-soft/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2.5">
          {value && <CopyBtn value={value} />}
          <button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)} className="text-content-soft transition-colors hover:text-content-primary">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </span>
      </div>
      {value ? (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Save this. It decrypts your worker key and can&apos;t be recovered.
        </p>
      ) : (
        <p className="mt-2.5 text-xs text-content-soft">Encrypts your worker key on this machine. Use Generate for a strong one.</p>
      )}
      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-content-soft">
        <ShieldCheck className="mt-0.5 size-3 shrink-0 text-success/80" /> Kept on this device only, in the OS keychain and an
        encrypted keystore. It is never sent to any server.
      </p>
    </div>
  );
}

/** Funding source body: generate a dedicated key + fund it from the connected
 *  wallet, or paste an existing funder key. (Mode toggle lives in the StepCard
 *  aside.) Reports the chosen key once it holds enough. */
function FunderSetup({ network, mode, onReady, registered }: { network: NetworkId; mode: FundMode; onReady: (ready: string | null) => void; registered: boolean }) {
  const net = NETWORKS[network];
  const need = parseEther(String(net.fundLcai));
  const [genAddr, setGenAddr] = useState("");
  const [reveal, setReveal] = useState(false);
  const [revealedKey, setRevealedKey] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  // Inline confirm for "New key" - the desktop webview has no native confirm()
  // dialog, so we ask in-app before discarding the current key.
  const [confirmNew, setConfirmNew] = useState(false);

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const savedWorkers = useSavedWorkers();
  const onChain = chainId === net.chainId;

  // Show the worker the app actually holds the key for (the key is authoritative;
  // the public address record can drift, e.g. after viewing another watchlisted
  // worker). Derives from the stored key and re-syncs the record. Re-runs on
  // network toggle so the shown worker + its balance match the selected network.
  useEffect(() => {
    let on = true;
    resolveManagedWorkerAddr(network).then((a) => {
      if (on) setGenAddr(/^0x[a-fA-F0-9]{40}$/.test(a) ? a : "");
    });
    return () => {
      on = false;
    };
  }, [network]);

  const generate = async () => {
    setBusy(true);
    setConfirmNew(false);
    try {
      // Never silently lose a key: archive the current one (with its password +
      // address) before it's replaced, so a staked worker stays recoverable even
      // if this regenerate was a mistake.
      const oldKey = await getSecret(SECRET_WORKER_KEY, network);
      if (oldKey) {
        await archiveRetiredWorker(network, getWorkerAddr(network), oldKey, await getSecret(SECRET_WORKER_PW, network));
      }
      setReveal(false);
      setRevealedKey("");
      let addr: string;
      if (await nativeSecretsAvailable()) {
        // Key is created + kept in the keychain natively, under a PER-NETWORK name
        // so a second network's worker never overwrites the first; only the
        // address returns to the UI.
        const native = await generateWorkerKey(`${SECRET_WORKER_KEY}.${network}`);
        if (!native) throw new Error("native key generation unavailable");
        addr = getAddress(native);
      } else {
        const k = generatePrivateKey();
        await setSecret(SECRET_WORKER_KEY, k, network); // localStorage on web
        addr = privateKeyToAccount(k).address;
      }
      setGenAddr(addr);
      setWorkerAddr(network, addr); // public - powers the dashboard "My worker"
      savedWorkers.add(addr);
    } catch {
      /* leave prior state */
    } finally {
      setBusy(false);
    }
  };

  const toggleReveal = async () => {
    if (reveal) {
      setReveal(false);
      setRevealedKey("");
      return;
    }
    setRevealedKey(await getSecret(SECRET_WORKER_KEY, network)); // explicit backup action
    setReveal(true);
  };

  const genAddrTyped = genAddr ? (genAddr as `0x${string}`) : undefined;
  const { data: bal } = useBalance({ address: genAddrTyped, chainId: net.chainId, query: { enabled: !!genAddr, refetchInterval: 5000 } });
  const { sendTransaction, isPending, error: sendError, data: hash } = useSendTransaction();
  const publicClient = usePublicClient({ chainId: net.chainId });

  // Fund the worker. A plain native transfer is 21000 gas; LightChain's fee is
  // a few WEI, which MetaMask can't auto-display ("Network fee Unavailable"), so
  // we pass explicit gas + chain-estimated fees to make it concrete.
  const fundWorker = async () => {
    if (!genAddrTyped) return;
    let fees: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint } = {};
    try {
      const f = await publicClient?.estimateFeesPerGas();
      if (f?.maxFeePerGas) fees = { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
    } catch {
      /* fall back to wallet estimation */
    }
    sendTransaction({ to: genAddrTyped, value: need, chainId: net.chainId, gas: 21_000n, ...fees });
  };
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash, chainId: net.chainId, query: { enabled: !!hash } });
  const { switchChain, isPending: switching } = useSwitchChain();

  const funded = !!bal && bal.value >= need;
  const errMsg = sendError ? sendError.message.split("\n")[0].slice(0, 140) : null;

  // Report readiness as the worker ADDRESS (not the key). In paste mode, store
  // the pasted key (keychain on desktop) so the install/withdraw can use it.
  useEffect(() => {
    if (mode === "paste") {
      if (PRIVKEY_RE.test(paste)) {
        const a = privateKeyToAccount(paste as `0x${string}`).address;
        void setSecret(SECRET_WORKER_KEY, paste, network);
        setWorkerAddr(network, a);
        onReady(a);
      } else {
        onReady(null);
      }
    } else {
      onReady(genAddr && funded ? genAddr : null);
    }
  }, [mode, paste, genAddr, funded, onReady]);

  if (mode === "paste") {
    return (
      <div>
        <input
          type="password"
          value={paste}
          onChange={(e) => setPaste(e.target.value.trim())}
          placeholder="0x... (used once to fund + stake)"
          className="h-11 w-full rounded-xl border border-bdr-soft bg-card/60 px-3.5 font-mono text-sm text-content-primary outline-none transition-all placeholder:text-content-soft/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <p className="mt-2.5 text-xs text-content-soft">
          Paste a key that already holds ~{net.fundLcai.toLocaleString()} LCAI. Used once to fund and stake your worker.
        </p>
      </div>
    );
  }

  if (!genAddr) {
    return (
      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className="group flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-all hover:border-primary/50 hover:bg-primary/15 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
        {busy ? "Generating..." : "Generate your worker key"}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-bdr-soft bg-card/60 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm text-content-primary">{genAddr.slice(0, 10)}…{genAddr.slice(-8)}</span>
          <span className="flex items-center gap-3">
            {genAddr && <CopyBtn value={genAddr} />}
            <button
              type="button"
              onClick={toggleReveal}
              title={reveal ? "Hide private key" : "Reveal private key"}
              aria-label={reveal ? "Hide private key" : "Reveal private key"}
              className="text-content-soft transition-colors hover:text-content-primary"
            >
              {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
            <button
              type="button"
              onClick={async () => {
                setConfirmNew(true);
                // For a STAKED worker, reveal the current key right away so the
                // user can copy it before it's replaced (losing it strands the stake).
                if (registered) {
                  setRevealedKey(await getSecret(SECRET_WORKER_KEY, network));
                  setReveal(true);
                }
              }}
              className="inline-flex items-center gap-1 text-[11px] text-content-soft transition-colors hover:text-content-primary"
            >
              <RefreshCw className="size-3" /> New key
            </button>
          </span>
        </div>
        {confirmNew && (
          <div className="mt-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px]">
            {registered ? (
              <p className="flex items-start gap-1.5 text-warning">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  <span className="font-semibold text-content-primary">
                    This worker has a {net.minStakeLcai.toLocaleString()} LCAI stake locked on-chain.
                  </span>{" "}
                  A new key points the app at a different worker. The stake stays on-chain, but you need <span className="font-semibold">this</span> key
                  to ever recover it, so copy it (revealed above) somewhere safe first. To get the stake back instead, deregister this worker.
                  A copy is also archived on this device.
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-warning">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" /> Replace this key? The current one is forgotten, so back it up first if it holds funds.
              </p>
            )}
            <div className="mt-2 flex items-center justify-end gap-3">
              <button type="button" onClick={() => { setConfirmNew(false); void generate(); }} className="font-medium text-destructive transition-colors hover:underline">
                {registered ? "I saved it, replace key" : "Replace key"}
              </button>
              <button type="button" onClick={() => setConfirmNew(false)} className="text-content-soft transition-colors hover:underline">
                Cancel
              </button>
            </div>
          </div>
        )}
        {reveal && (
          <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-warning/10 px-2.5 py-2">
            <code className="truncate font-mono text-[11px] text-content-default">{revealedKey || "…"}</code>
            {revealedKey && <CopyBtn value={revealedKey} />}
          </div>
        )}
        <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" /> Back up this key. It&apos;s your worker&apos;s identity and holds the staked LCAI.
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-content-soft">
          <ShieldCheck className="mt-0.5 size-3 shrink-0 text-success/80" /> Your key and password are generated and kept
          on this device only, in your OS keychain and an encrypted keystore. They are never sent to any server, and signing
          happens locally.
        </p>
      </div>

      <div className="flex items-start gap-4 rounded-xl border border-bdr-light bg-card/40 p-4">
        {genAddr && <FundingQr uri={`ethereum:${genAddr}@${net.chainId}?value=${need.toString()}`} />}
        <div className="text-xs leading-relaxed text-content-soft">
          <span className="font-medium text-content-primary">Scan with your phone wallet</span> to send{" "}
          {net.fundLcai.toLocaleString()} LCAI. The recipient, amount and network are prefilled, and the balance updates
          automatically. (Or use the button below and approve in your wallet.)
          {isConnected && (
            <button
              type="button"
              disabled={switching}
              onClick={() => switchChain({ chainId: net.chainId })}
              className="mt-2 inline-flex items-center gap-1 font-medium text-primary transition-colors hover:underline"
            >
              {switching ? <Loader2 className="size-3 animate-spin" /> : <Wallet className="size-3" />}
              First time? Add LightChain {net.label} to your wallet
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-bdr-light bg-surface-base-subtle/60 px-3.5 py-2.5 text-xs">
        <span className="text-content-soft">
          Balance: <span className="font-semibold tabular-nums text-content-primary">{bal ? Number(formatEther(bal.value)).toLocaleString() : "0"} LCAI</span>
        </span>
        {funded ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-success"><CheckCircle2 className="size-4" /> Funded</span>
        ) : isConnected && onChain ? (
          <Button size="sm" variant="outline" disabled={isPending || confirming} onClick={fundWorker}>
            {isPending || confirming ? <Loader2 className="size-3.5 animate-spin" /> : <Wallet className="size-3.5" />} Fund {net.fundLcai.toLocaleString()} from wallet
          </Button>
        ) : isConnected ? (
          <button type="button" disabled={switching} onClick={() => switchChain({ chainId: net.chainId })} className="inline-flex items-center gap-1 font-medium text-warning transition-colors hover:underline">
            {switching ? <Loader2 className="size-3.5 animate-spin" /> : <Wallet className="size-3.5" />} Switch to {net.label}
          </button>
        ) : (
          <span className="font-medium text-warning">Connect wallet to fund</span>
        )}
      </div>

      {isPending && !hash && (
        <p className="text-xs text-warning">Approve the transfer in your wallet. On mobile, open the MetaMask app to see the request.</p>
      )}
      {/* Persistent transfer confirmation. The View Tx link stays put after the
          balance confirms (it used to vanish the instant `funded` flipped true). */}
      {hash ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-bdr-light bg-surface-base-subtle/60 px-3.5 py-2.5 text-xs">
          <span className="inline-flex items-center gap-1.5 text-content-soft">
            {confirming && !funded ? (
              <><Loader2 className="size-3.5 animate-spin" /> Confirming your transfer on-chain…</>
            ) : (
              <><CheckCircle2 className="size-4 text-success" /> Transfer confirmed</>
            )}
          </span>
          <button
            type="button"
            onClick={() => openExternal(`${net.explorer}/tx/${hash}`)}
            className="inline-flex items-center gap-1 font-medium text-primary transition-colors hover:underline"
          >
            View Tx <ArrowUpRight className="size-3.5" />
          </button>
        </div>
      ) : funded ? (
        <div className="flex justify-end text-xs">
          <button
            type="button"
            onClick={() => openExternal(`${net.explorer}/address/${genAddr}`)}
            className="inline-flex items-center gap-1 font-medium text-primary transition-colors hover:underline"
          >
            View worker on explorer <ArrowUpRight className="size-3.5" />
          </button>
        </div>
      ) : null}
      {errMsg && <p className="text-xs text-destructive">{errMsg}</p>}
    </div>
  );
}

/**
 * Shown instead of the fund-and-install wizard when this network's worker is
 * already registered on-chain. It's not a fresh install - the worker exists, so
 * this points you to the dashboard to manage it and (only when it isn't already
 * running here) offers to bring it back online.
 */
function AlreadyAWorker({ network, addr, local, onBringOnline, onReplace }: { network: NetworkId; addr: string; local: LocalWorkerInfo | null; onBringOnline: () => void; onReplace: () => void }) {
  const net = NETWORKS[network];
  const runningHere = local?.status === "running" && local.chainId === net.chainId;
  const otherNetRunning = local?.status === "running" && local.chainId != null && local.chainId !== net.chainId;
  const stoppedHere = local?.status === "stopped";
  const missingHere = local?.status === "missing";
  const canBringOnline = !runningHere && !otherNetRunning;

  const desc = runningHere
    ? "It's running on this machine and serving jobs, so there's nothing to do here. Manage it (settle, restart, health, deregister) from the dashboard."
    : otherNetRunning
      ? `A worker for the other network is running on this machine right now. This ${net.label} worker is registered but offline here. Stop the other one first (on the dashboard), then come back to bring this one online.`
      : stoppedHere
        ? "Its container is stopped on this machine. Restart it from the dashboard, or bring it back online here."
        : missingHere
          ? "It's registered on-chain but not installed on this machine right now. Bring it back online to recreate the worker container here."
          : "It's registered on-chain. Manage it from the dashboard.";

  const localBadge = runningHere ? (
    <Badge tone="success">Running on this machine</Badge>
  ) : otherNetRunning ? (
    <Badge tone="warning">Offline here (other network running)</Badge>
  ) : stoppedHere ? (
    <Badge tone="warning">Stopped on this machine</Badge>
  ) : missingHere ? (
    <Badge tone="default">Not installed here</Badge>
  ) : null;

  return (
    <div className="relative space-y-4">
      <div className="rounded-xl border border-success/20 bg-success/5 p-4">
        <div className="mb-1.5 flex items-center gap-2">
          <CheckCircle2 className="size-5 text-success" />
          <span className="font-semibold text-content-primary">You already run a worker on {net.label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono text-content-primary">{shortAddr(addr)}</span>
          <Badge tone="success">Registered · stake locked</Badge>
          {localBadge}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-content-soft">{desc}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/dashboard">
          <Button variant="gradient" size="lg">
            <Gauge /> Open dashboard <ArrowRight />
          </Button>
        </Link>
        {canBringOnline && (
          <Button variant="outline" size="lg" onClick={onBringOnline}>
            <Rocket /> Bring it back online
          </Button>
        )}
      </div>

      <p className="text-xs leading-relaxed text-content-soft">
        To exit this worker and get your stake back, use <span className="text-content-primary">Deregister</span> on the
        dashboard.{" "}
        <button type="button" onClick={onReplace} className="font-medium text-content-soft underline-offset-2 transition-colors hover:text-content-primary hover:underline">
          Use a different worker instead
        </button>
        . The current one stays staked and is archived so you never lose it.
      </p>

      <Link href="/recover" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:underline">
        <KeyRound className="size-3.5" /> Recover a replaced key
      </Link>
    </div>
  );
}

/**
 * The literal one-click install - only in the desktop shell. Generates the
 * keystore password + a dedicated funding key (fundable from the connected
 * wallet), passes them as process env to the native runner, and streams the log.
 */
export function OneClickInstall({ models = [DEFAULT_MODEL], onAlready, onInstalled }: { models?: string[]; onAlready?: (already: boolean) => void; onInstalled?: (done: boolean) => void }) {
  const { network } = useNetwork();
  const net = NETWORKS[network];
  const [desktop, setDesktop] = useState(false);
  const [os, setOs] = useState<OS>("macos");
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState<FundMode>("wallet");
  // The worker ADDRESS once a key exists + is funded (the raw key lives in the
  // keychain/localStorage, not here). Null until ready.
  const [ready, setReady] = useState<string | null>(null);
  // This network's stored (public) worker address + whether it is already
  // registered on-chain. Owned here (not in FunderSetup) so it re-evaluates on
  // every network toggle, even while the "already a worker" panel is showing.
  const [workerAddr, setWorkerAddrState] = useState("");
  const [registered, setRegistered] = useState(false);
  // Escape hatch: from the "already a worker" panel, choose to set up a different
  // worker (shows the fund wizard despite an existing registration).
  const [forceFresh, setForceFresh] = useState(false);
  // Local container state for an already-registered worker (running here / stopped
  // / not installed), so we can show the right "you already have a worker" panel.
  const [local, setLocal] = useState<LocalWorkerInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => setDesktop(isDesktop()), []);
  useEffect(() => {
    const d = detectClientOS();
    setOs(d === "windows" ? "windows" : d === "linux" ? "linux" : "macos");
  }, []);
  useEffect(() => {
    let on = true;
    // Load THIS network's saved password, and clear when it has none - otherwise
    // toggling networks would leave the previous network's password on screen
    // (misleading: the two workers have different keystore passwords).
    getSecret(SECRET_WORKER_PW, network).then((saved) => {
      if (on) setPw(saved || "");
    });
    return () => {
      on = false;
    };
  }, [network]);
  useEffect(() => () => stopRef.current?.(), []);
  // Detect this network's worker + whether it's registered on-chain. Re-runs on
  // every network toggle (the panel that needs it may already be showing).
  useEffect(() => {
    let on = true;
    setForceFresh(false);
    // Recover a key stored by an older build under the single (non-per-network)
    // name first, so the address resolves to the worker the app actually holds.
    void migrateBareWorkerKey(network).then(() => resolveManagedWorkerAddr(network)).then((a) => {
      if (!on) return;
      const valid = /^0x[a-fA-F0-9]{40}$/.test(a);
      setWorkerAddrState(valid ? a : "");
      if (!valid) {
        setRegistered(false);
        return;
      }
      fetchWorker(network, a)
        .then((w) => on && setRegistered(!!w && w.status !== "deregistered"))
        .catch(() => on && setRegistered(false));
    });
    return () => {
      on = false;
    };
  }, [network]);
  // Read the local container's state once we know this network's worker is
  // registered - to distinguish "already running here" from "registered but offline".
  useEffect(() => {
    if (!desktop || !registered) {
      setLocal(null);
      return;
    }
    let on = true;
    localWorkerInfo().then((info) => {
      if (on) setLocal(info);
    });
    return () => {
      on = false;
    };
  }, [desktop, registered, network]);

  const updatePw = (v: string) => {
    setPw(v);
    void setSecret(SECRET_WORKER_PW, v, network); // keychain on desktop, localStorage on web
  };
  // Tell the parent whether this is an existing worker, so the onboard step can
  // drop the install chrome (model picker etc.) and just show the manage panel.
  const alreadyAWorker = registered && !forceFresh;
  useEffect(() => onAlready?.(alreadyAWorker), [alreadyAWorker, onAlready]);
  // Tell the parent when the install has actually finished, so the wizard's
  // "Continue" can stay disabled until the worker is really set up.
  useEffect(() => onInstalled?.(phase === "done"), [phase, onInstalled]);

  if (!desktop) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex items-start gap-3 text-sm text-content-soft">
          <IconChip icon={Rocket} size="sm" className="shrink-0" />
          <span>
            <span className="font-medium text-content-primary">Want true one-click?</span> The desktop app installs &amp;
            runs everything with a single button. On the web, use the one command below.
          </span>
        </div>
        <a href="https://github.com/marinom2/lightnode/releases/latest" target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm"><Download /> Get the desktop app</Button>
        </a>
      </div>
    );
  }

  // The "already a worker" panel shows for a registered worker unless the user
  // explicitly chose to set up a different one.
  const showAlready = alreadyAWorker;
  // The worker this install acts on: the existing registered one (bring online),
  // else the freshly funded/generated one from the wizard.
  const target = showAlready ? workerAddr : ready ?? "";
  const valid = pw.length >= 6 && !!ready;
  const hint = pw.length < 6 ? "Set a password (6+ characters)" : "Fund the worker address";
  const ctaLabel = forceFresh ? "Install my new worker" : "Install & run my worker";

  const run = async () => {
    if (!target) return;
    setPhase("running");
    setLog([]);
    // Persist this network's password, then pass THIS network's secrets to the
    // installer by value (read from the per-network keychain/localStorage). We
    // pass them per-network rather than by bare keychain name, because the native
    // by-name injection can't carry a per-network name - using it would feed the
    // wrong network's worker. The values are device-local (in-app + native runner),
    // never networked. WORKER_PRIVKEY may be absent for a switch-back to a worker
    // whose key isn't in the app; WORKER_ADDR (public) then identifies it and the
    // installer/keystore supplies the key.
    // Use the typed password if set, else this network's stored one (the
    // already-registered "bring online" panel hides the field and relies on it).
    const pwVal = pw || (await getSecret(SECRET_WORKER_PW, network));
    if (pwVal) await setSecret(SECRET_WORKER_PW, pwVal, network);
    const k = await getSecret(SECRET_WORKER_KEY, network);
    // Fresh install uses the picked set; bringing an existing worker back online
    // reuses its recorded set (so we don't silently change what it serves).
    const installModels = showAlready ? (getServedModels(network).length ? getServedModels(network) : [DEFAULT_MODEL]) : models;
    setServedModels(network, installModels);
    const env: Record<string, string> = {
      NETWORK: network,
      SUPPORTED_MODELS: installModels.join(","),
      WORKER_PASSWORD: pwVal,
      WORKER_ADDR: target,
      ...(k ? { WORKER_PRIVKEY: k } : {}),
    };
    stopRef.current = await runSetupStreamed(
      desktopInstallCommand(os, network, installModels),
      env,
      (line) => setLog((l) => appendCleanLog(l, line)),
      (code) => {
        setPhase(code === 0 ? "done" : "failed");
        // NOTE: do NOT auto-clear the saved key/password here. "exit 0" only means
        // the install script finished (the container was started) - the worker can
        // still crash-loop afterward. Wiping the key would orphan the staked worker
        // and make the app "forget" it. The key stays persisted so the worker is
        // always recoverable; the "new" button lets the user discard it on purpose.
      },
    );
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-card/40 p-6 backdrop-blur-sm sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 -left-20 size-56 rounded-full bg-[#dd00ac]/5 blur-3xl" />

      <div className="relative mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconChip icon={Rocket} size="md" />
          <div>
            <h3 className="text-base font-semibold tracking-tight text-content-primary">{showAlready ? "Your worker" : "One-click install"}</h3>
            <p className="text-xs text-content-soft">
              {showAlready
                ? `Already set up on ${net.label}. Manage it below.`
                : forceFresh
                  ? "Set up a different worker."
                  : "Set a password, fund your worker, go live."}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-bdr-soft bg-surface-base-faint px-2.5 py-1 text-[11px] font-medium text-content-soft">
          <span className="dot dot-live" /> desktop
        </span>
      </div>

      {phase === "idle" && showAlready && (
        <AlreadyAWorker network={network} addr={workerAddr} local={local} onBringOnline={run} onReplace={() => setForceFresh(true)} />
      )}

      {phase === "idle" && !showAlready && (
        <div className="relative space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-bdr-soft bg-surface-base-subtle/60 px-3.5 py-3 text-xs leading-relaxed text-content-soft">
            <Wallet className="mt-0.5 size-4 shrink-0 text-content-soft" />
            <span>
              <span className="font-medium text-content-primary">No wallet connection needed to fund.</span> This desktop app
              runs in its own browser, so it can&apos;t use your Chrome MetaMask extension. Just send the amount to the funding
              address from any wallet. The balance updates automatically.
            </span>
          </div>

          <StepCard
            n={1}
            title="Keystore password"
            aside={
              <button
                type="button"
                onClick={() => updatePw(strongPassword())}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <Wand2 className="size-3.5" /> Generate
              </button>
            }
          >
            <PasswordField value={pw} onChange={updatePw} />
          </StepCard>

          <StepCard
            n={2}
            title="Fund your worker"
            aside={
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-surface-base-faint px-2.5 py-1 text-[11px] font-medium tabular-nums text-content-soft">
                  {net.fundLcai.toLocaleString()} LCAI
                </span>
                <button
                  type="button"
                  onClick={() => setMode((m) => (m === "wallet" ? "paste" : "wallet"))}
                  className="text-[11px] font-medium text-primary transition-colors hover:underline"
                >
                  {mode === "wallet" ? "Paste a key" : "Use my wallet"}
                </button>
              </div>
            }
          >
            <FunderSetup network={network} mode={mode} onReady={setReady} registered={registered} />
          </StepCard>
          {forceFresh && (
            <button
              type="button"
              onClick={() => setForceFresh(false)}
              className="text-xs text-content-soft underline-offset-2 transition-colors hover:text-content-primary hover:underline"
            >
              ← Back to my existing worker
            </button>
          )}

          <p className="flex items-center gap-2 rounded-xl border border-success/20 bg-success/5 px-3.5 py-2.5 text-xs text-content-soft">
            <ShieldCheck className="size-4 shrink-0 text-success" /> Your keys stay on this machine and go straight to the
            local installer. They are never stored or sent anywhere.
          </p>

          <Button variant="gradient" size="lg" className="w-full" disabled={!valid} onClick={run}>
            <Rocket /> {ctaLabel} <ArrowRight />
          </Button>
          {!valid && (
            <p className="text-center text-[11px] text-content-soft">
              {hint} to enable install.
            </p>
          )}
        </div>
      )}

      {phase !== "idle" && (
        <div className="relative">
          <div className="mb-4 flex items-center gap-2 text-sm">
            {phase === "running" && <span className="inline-flex items-center gap-2 text-content-primary"><Loader2 className="size-4 animate-spin" /> Setting up your worker…</span>}
            {phase === "done" && <span className="inline-flex items-center gap-2 font-medium text-success"><CheckCircle2 className="size-4" /> Worker online. Track it on the dashboard.</span>}
            {phase === "failed" && <span className="inline-flex items-center gap-2 font-medium text-destructive"><XCircle className="size-4" /> Install stopped. Open the details below.</span>}
          </div>
          <InstallProgress log={log} phase={phase} />
        </div>
      )}
    </div>
  );
}
