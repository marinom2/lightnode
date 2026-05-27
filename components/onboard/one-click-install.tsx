"use client";

import { useEffect, useRef, useState } from "react";
import {
  Rocket, Loader2, CheckCircle2, XCircle, Terminal, ShieldCheck, Download,
  Wand2, Copy, Check, Eye, EyeOff, Wallet, AlertTriangle, ArrowRight, RefreshCw,
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
import { detectClientOS } from "@/lib/os-detect";
import { isDesktop, runSetupStreamed, generateWorkerKey } from "@/lib/tauri";
import { getSecret, setSecret, getWorkerAddr, setWorkerAddr, nativeSecretsAvailable, SECRET_WORKER_KEY, SECRET_WORKER_PW } from "@/lib/secrets";
import { useSavedWorkers } from "@/lib/saved-workers";

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
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Save this - it decrypts your worker key and can&apos;t be recovered.
        </p>
      ) : (
        <p className="mt-2.5 text-xs text-content-soft">Encrypts your worker key on this machine. Use Generate for a strong one.</p>
      )}
    </div>
  );
}

/** Funding source body: generate a dedicated key + fund it from the connected
 *  wallet, or paste an existing funder key. (Mode toggle lives in the StepCard
 *  aside.) Reports the chosen key once it holds enough. */
function FunderSetup({ network, mode, onReady }: { network: NetworkId; mode: FundMode; onReady: (ready: string | null) => void }) {
  const net = NETWORKS[network];
  const need = parseEther(String(net.fundLcai));
  const [genAddr, setGenAddr] = useState("");
  const [reveal, setReveal] = useState(false);
  const [revealedKey, setRevealedKey] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const savedWorkers = useSavedWorkers();
  const onChain = chainId === net.chainId;

  // Restore from the public ADDRESS (never the key) - if it's stored, a key
  // exists in the keychain/localStorage. The raw key is fetched only on an
  // explicit "reveal for backup".
  useEffect(() => {
    const a = getWorkerAddr(network);
    if (/^0x[a-fA-F0-9]{40}$/.test(a)) setGenAddr(a);
  }, []);

  const generate = async () => {
    setBusy(true);
    setReveal(false);
    setRevealedKey("");
    try {
      let addr: string;
      if (await nativeSecretsAvailable()) {
        // Key is created + kept in the keychain natively; only the address returns.
        const native = await generateWorkerKey(SECRET_WORKER_KEY);
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
              onClick={() => { if (confirm("Generate a NEW funding key? The current one is forgotten - back it up first if it holds funds.")) void generate(); }}
              className="inline-flex items-center gap-1 text-[11px] text-content-soft transition-colors hover:text-content-primary"
            >
              <RefreshCw className="size-3" /> New key
            </button>
          </span>
        </div>
        {reveal && (
          <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-warning/10 px-2.5 py-2">
            <code className="truncate font-mono text-[11px] text-content-default">{revealedKey || "…"}</code>
            {revealedKey && <CopyBtn value={revealedKey} />}
          </div>
        )}
        <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" /> Back up this key - it&apos;s your worker&apos;s identity and holds the staked LCAI.
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-content-soft">
          <ShieldCheck className="mt-0.5 size-3 shrink-0 text-success/80" /> Your key and password are generated and kept
          on this device only - in your OS keychain and an encrypted keystore - and are never sent to any server. Signing
          happens locally.
        </p>
      </div>

      <div className="flex items-start gap-4 rounded-xl border border-bdr-light bg-card/40 p-4">
        {genAddr && <FundingQr uri={`ethereum:${genAddr}@${net.chainId}?value=${need.toString()}`} />}
        <div className="text-xs leading-relaxed text-content-soft">
          <span className="font-medium text-content-primary">Scan with your phone wallet</span> to send{" "}
          {net.fundLcai.toLocaleString()} LCAI - recipient, amount and network are prefilled. The balance updates
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

      {isPending && !funded && (
        <p className="text-xs text-warning">Approve the transfer in your wallet - on mobile, open the MetaMask app to see the request.</p>
      )}
      {hash && !funded && (
        <p className="text-xs text-content-soft">
          Sent - confirming on-chain…{" "}
          <a href={`${net.explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">view</a>
        </p>
      )}
      {errMsg && <p className="text-xs text-destructive">{errMsg}</p>}
    </div>
  );
}

/**
 * The literal one-click install - only in the desktop shell. Generates the
 * keystore password + a dedicated funding key (fundable from the connected
 * wallet), passes them as process env to the native runner, and streams the log.
 */
export function OneClickInstall({ model = DEFAULT_MODEL }: { model?: string }) {
  const { network } = useNetwork();
  const net = NETWORKS[network];
  const [desktop, setDesktop] = useState(false);
  const [os, setOs] = useState<OS>("macos");
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState<FundMode>("wallet");
  // The worker ADDRESS once a key exists + is funded (the raw key lives in the
  // keychain/localStorage, not here). Null until ready.
  const [ready, setReady] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef<(() => void) | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => setDesktop(isDesktop()), []);
  useEffect(() => {
    const d = detectClientOS();
    setOs(d === "windows" ? "windows" : d === "linux" ? "linux" : "macos");
  }, []);
  useEffect(() => {
    let on = true;
    getSecret(SECRET_WORKER_PW, network).then((saved) => on && saved && setPw(saved));
    return () => {
      on = false;
    };
  }, []);
  useEffect(() => () => stopRef.current?.(), []);

  const updatePw = (v: string) => {
    setPw(v);
    void setSecret(SECRET_WORKER_PW, v, network); // keychain on desktop, localStorage on web
  };
  useEffect(() => logEnd.current?.scrollIntoView({ behavior: "smooth" }), [log]);

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

  const valid = pw.length >= 6 && !!ready;
  const hint = pw.length < 6 ? "Set a password (6+ characters)" : "Fund the worker address";

  const run = async () => {
    if (!ready) return;
    setPhase("running");
    setLog([]);
    // The key already lives in the keychain (desktop) / localStorage (web) from
    // generation; just make sure the password is stored too. On desktop the
    // native runner injects both by NAME (the web layer never carries the raw
    // values); on web we fall back to passing them via env.
    await setSecret(SECRET_WORKER_PW, pw, network);
    const baseEnv = { NETWORK: network, SUPPORTED_MODELS: model };
    const native = await nativeSecretsAvailable();
    const secretEnv = native ? [SECRET_WORKER_KEY, SECRET_WORKER_PW] : undefined;
    const env = native
      ? baseEnv
      : { ...baseEnv, WORKER_PASSWORD: pw, WORKER_PRIVKEY: (await getSecret(SECRET_WORKER_KEY, network)) || "" };
    stopRef.current = await runSetupStreamed(
      desktopInstallCommand(os, network, model),
      env,
      (line) => setLog((l) => [...l, line]),
      (code) => {
        setPhase(code === 0 ? "done" : "failed");
        // NOTE: do NOT auto-clear the saved key/password here. "exit 0" only means
        // the install script finished (the container was started) - the worker can
        // still crash-loop afterward. Wiping the key would orphan the staked worker
        // and make the app "forget" it. The key stays persisted so the worker is
        // always recoverable; the "new" button lets the user discard it on purpose.
      },
      secretEnv,
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
            <h3 className="text-base font-semibold tracking-tight text-content-primary">One-click install</h3>
            <p className="text-xs text-content-soft">Set a password, fund your worker, go live.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-bdr-soft bg-surface-base-faint px-2.5 py-1 text-[11px] font-medium text-content-soft">
          <span className="dot dot-live" /> desktop
        </span>
      </div>

      {phase === "idle" && (
        <div className="relative space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-bdr-soft bg-surface-base-subtle/60 px-3.5 py-3 text-xs leading-relaxed text-content-soft">
            <Wallet className="mt-0.5 size-4 shrink-0 text-content-soft" />
            <span>
              <span className="font-medium text-content-primary">No wallet connection needed to fund.</span> This desktop app
              runs in its own browser, so it can&apos;t use your Chrome MetaMask extension. Just send the amount to the funding
              address from any wallet - the balance updates automatically.
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
            <FunderSetup network={network} mode={mode} onReady={setReady} />
          </StepCard>

          <p className="flex items-center gap-2 rounded-xl border border-success/20 bg-success/5 px-3.5 py-2.5 text-xs text-content-soft">
            <ShieldCheck className="size-4 shrink-0 text-success" /> Keys stay in memory and on your machine - passed to the
            local installer, never stored or sent anywhere.
          </p>

          <Button variant="gradient" size="lg" className="w-full" disabled={!valid} onClick={run}>
            <Rocket /> Install &amp; run my worker <ArrowRight />
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
          <div className="mb-3 flex items-center gap-2 text-sm">
            {phase === "running" && <span className="inline-flex items-center gap-2 text-content-primary"><Loader2 className="size-4 animate-spin" /> Installing your worker...</span>}
            {phase === "done" && <span className="inline-flex items-center gap-2 font-medium text-success"><CheckCircle2 className="size-4" /> Worker online - track it on the dashboard.</span>}
            {phase === "failed" && <span className="inline-flex items-center gap-2 font-medium text-destructive"><XCircle className="size-4" /> Install stopped - see the log.</span>}
          </div>
          <div className="max-h-64 overflow-auto rounded-xl border border-bdr-soft bg-[#0b0b14] p-4 font-mono text-[12px] leading-relaxed text-content-default">
            <div className="mb-1.5 flex items-center gap-1.5 text-content-soft"><Terminal className="size-3" /> install log</div>
            {log.map((l, i) => (<div key={i} className="whitespace-pre-wrap">{l}</div>))}
            <div ref={logEnd} />
          </div>
        </div>
      )}
    </div>
  );
}
