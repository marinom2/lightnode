"use client";

import { useEffect, useRef, useState } from "react";
import {
  Rocket, Loader2, CheckCircle2, XCircle, Terminal, ShieldCheck, Download,
  Wand2, Copy, Check, Eye, EyeOff, Wallet, AlertTriangle,
} from "lucide-react";
import { useAccount, useChainId, useBalance, useSendTransaction, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import { parseEther, formatEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { useNetwork } from "@/lib/network-context";
import { DEFAULT_MODEL, NETWORKS, type NetworkId } from "@/lib/network";
import { desktopInstallCommand, type OS } from "@/lib/scriptgen";
import { detectClientOS } from "@/lib/os-detect";
import { isDesktop, runSetupStreamed } from "@/lib/tauri";

type Phase = "idle" | "running" | "done" | "failed";
const PRIVKEY_RE = /^0x[a-fA-F0-9]{64}$/;

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
      className="inline-flex items-center gap-1 text-[11px] text-content-soft hover:text-content-primary"
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
    QRCode.toDataURL(uri, { margin: 1, width: 168, color: { dark: "#0b0b14", light: "#ffffff" } })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [uri]);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Scan to fund" width={84} height={84} className="rounded-md" />;
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(true);
  return (
    <label className="text-xs text-content-soft">
      <span className="flex items-center justify-between">
        Keystore password
        <button type="button" onClick={() => { onChange(strongPassword()); setShow(true); }} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
          <Wand2 className="size-3" /> Generate
        </button>
      </span>
      <span className="relative mt-1 block">
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
          className="h-9 w-full rounded-lg border border-bdr-soft bg-card/60 px-2.5 pr-16 font-mono text-sm text-content-primary outline-none focus:border-primary"
        />
        <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {value && <CopyBtn value={value} />}
          <button type="button" aria-label={show ? "Hide" : "Show"} onClick={() => setShow((s) => !s)} className="text-content-soft hover:text-content-primary">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </span>
      </span>
      {value && <span className="mt-1 block text-[11px] text-warning">Save this - it decrypts your worker key and can&apos;t be recovered.</span>}
    </label>
  );
}

/** Funding source: generate a dedicated key + fund it from the connected wallet,
 *  or paste an existing funder key. Reports the chosen key once it holds enough. */
function FunderSetup({ network, onReady }: { network: NetworkId; onReady: (key: string | null) => void }) {
  const net = NETWORKS[network];
  const need = parseEther(String(net.fundLcai));
  const [mode, setMode] = useState<"wallet" | "paste">("wallet");
  const [genKey, setGenKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [paste, setPaste] = useState("");

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const onChain = chainId === net.chainId;
  const genAddr = genKey ? privateKeyToAccount(genKey as `0x${string}`).address : undefined;
  const { data: bal } = useBalance({ address: genAddr, chainId: net.chainId, query: { enabled: !!genAddr, refetchInterval: 5000 } });
  const { sendTransaction, isPending, error: sendError, data: hash } = useSendTransaction();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash, chainId: net.chainId, query: { enabled: !!hash } });
  const { switchChain, isPending: switching } = useSwitchChain();

  const funded = !!bal && bal.value >= need;
  const errMsg = sendError ? sendError.message.split("\n")[0].slice(0, 140) : null;

  useEffect(() => {
    if (mode === "wallet") onReady(genKey && funded ? genKey : null);
    else onReady(PRIVKEY_RE.test(paste) ? paste : null);
  }, [mode, genKey, funded, paste, onReady]);

  if (mode === "paste") {
    return (
      <div className="text-xs text-content-soft">
        <span className="flex items-center justify-between">
          Funder private key (0x..., holds ~{net.fundLcai.toLocaleString()} LCAI)
          <button type="button" onClick={() => setMode("wallet")} className="text-[11px] font-medium text-primary hover:underline">Use my wallet instead</button>
        </span>
        <input
          type="password"
          value={paste}
          onChange={(e) => setPaste(e.target.value.trim())}
          placeholder="0x... (used once to fund + stake)"
          className="mt-1 h-9 w-full rounded-lg border border-bdr-soft bg-card/60 px-2.5 font-mono text-sm text-content-primary outline-none focus:border-primary"
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 text-xs text-content-soft">
      <span className="flex items-center justify-between">
        Funding ({net.fundLcai.toLocaleString()} LCAI stake + gas)
        <button type="button" onClick={() => setMode("paste")} className="text-[11px] font-medium text-primary hover:underline">Paste a key instead</button>
      </span>

      {!genKey ? (
        <button type="button" onClick={() => setGenKey(generatePrivateKey())} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 font-medium text-primary hover:bg-primary/15">
          <Wand2 className="size-3.5" /> Generate a dedicated funding key
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border border-bdr-soft bg-card/60 p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-content-primary">{genAddr?.slice(0, 10)}…{genAddr?.slice(-8)}</span>
            <span className="flex items-center gap-3">
              {genAddr && <CopyBtn value={genAddr} />}
              <button type="button" onClick={() => setReveal((r) => !r)} className="inline-flex items-center gap-1 text-[11px] text-content-soft hover:text-content-primary">
                {reveal ? <EyeOff className="size-3" /> : <Eye className="size-3" />} key
              </button>
            </span>
          </div>
          {reveal && (
            <div className="flex items-center justify-between gap-2 rounded bg-warning/10 px-2 py-1.5">
              <code className="truncate font-mono text-[11px] text-content-default">{genKey}</code>
              <CopyBtn value={genKey} />
            </div>
          )}
          <p className="flex items-start gap-1.5 text-[11px] text-warning">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" /> Back up this key - it holds your stake until the worker is funded.
          </p>
          <div className="flex items-center gap-3 rounded-lg border border-bdr-light bg-card/40 p-2.5">
            {genAddr && <FundingQr uri={`ethereum:${genAddr}@${net.chainId}?value=${need.toString()}`} />}
            <div className="text-[11px] text-content-soft">
              <span className="font-medium text-content-primary">Scan with your phone wallet</span> to send{" "}
              {net.fundLcai.toLocaleString()} LCAI - recipient, amount and network are prefilled. The balance updates
              automatically. (Or use the button below and approve in your wallet.)
              {isConnected && (
                <button
                  type="button"
                  disabled={switching}
                  onClick={() => switchChain({ chainId: net.chainId })}
                  className="mt-1.5 inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  {switching ? <Loader2 className="size-3 animate-spin" /> : <Wallet className="size-3" />}
                  First time? Add LightChain {net.label} to your wallet
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-bdr-light pt-2">
            <span>Balance: <span className="font-medium text-content-primary">{bal ? Number(formatEther(bal.value)).toLocaleString() : "0"} LCAI</span></span>
            {funded ? (
              <span className="inline-flex items-center gap-1 font-medium text-success"><CheckCircle2 className="size-3.5" /> Funded</span>
            ) : isConnected && onChain ? (
              <Button size="sm" variant="outline" disabled={isPending || confirming} onClick={() => genAddr && sendTransaction({ to: genAddr, value: need, chainId: net.chainId })}>
                {isPending || confirming ? <Loader2 className="size-3.5 animate-spin" /> : <Wallet className="size-3.5" />} Fund {net.fundLcai.toLocaleString()} from wallet
              </Button>
            ) : isConnected ? (
              <button type="button" disabled={switching} onClick={() => switchChain({ chainId: net.chainId })} className="inline-flex items-center gap-1 text-warning hover:underline">
                {switching ? <Loader2 className="size-3.5 animate-spin" /> : <Wallet className="size-3.5" />} Switch to {net.label}
              </button>
            ) : (
              <span className="text-warning">Connect wallet to fund</span>
            )}
          </div>
          {isPending && !funded && (
            <p className="text-[11px] text-warning">Approve the transfer in your wallet - on mobile, open the MetaMask app to see the request.</p>
          )}
          {hash && !funded && (
            <p className="text-[11px] text-content-soft">
              Sent - confirming on-chain…{" "}
              <a href={`${net.explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">view</a>
            </p>
          )}
          {errMsg && <p className="text-[11px] text-destructive">{errMsg}</p>}
        </div>
      )}
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
  const [desktop, setDesktop] = useState(false);
  const [os, setOs] = useState<OS>("macos");
  const [pw, setPw] = useState("");
  const [funderKey, setFunderKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef<(() => void) | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => setDesktop(isDesktop()), []);
  useEffect(() => {
    const d = detectClientOS();
    setOs(d === "windows" ? "windows" : d === "linux" ? "linux" : "macos");
  }, []);
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => logEnd.current?.scrollIntoView({ behavior: "smooth" }), [log]);

  if (!desktop) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
        <div className="flex items-start gap-2.5 text-sm text-content-soft">
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

  const valid = pw.length >= 6 && !!funderKey;

  const run = async () => {
    if (!funderKey) return;
    setPhase("running");
    setLog([]);
    stopRef.current = await runSetupStreamed(
      desktopInstallCommand(os, network, model),
      { WORKER_PASSWORD: pw, FUNDER_PRIVKEY: funderKey, NETWORK: network, SUPPORTED_MODELS: model },
      (line) => setLog((l) => [...l, line]),
      (code) => {
        setPhase(code === 0 ? "done" : "failed");
        setPw("");
        setFunderKey(null);
      },
    );
  };

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <IconChip icon={Rocket} size="sm" />
        <span className="text-sm font-semibold text-content-primary">One-click install (desktop)</span>
      </div>

      {phase === "idle" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <PasswordField value={pw} onChange={setPw} />
            <FunderSetup network={network} onReady={setFunderKey} />
          </div>
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-content-soft">
            <ShieldCheck className="size-3.5 text-success" /> Keys stay in memory and on your machine - passed to the local
            installer, never stored or sent anywhere.
          </p>
          <Button variant="gradient" className="mt-3" disabled={!valid} onClick={run}>
            <Rocket /> Install &amp; run my worker
          </Button>
        </>
      )}

      {phase !== "idle" && (
        <>
          <div className="mb-2 flex items-center gap-2 text-sm">
            {phase === "running" && <span className="inline-flex items-center gap-2 text-content-primary"><Loader2 className="size-4 animate-spin" /> Installing...</span>}
            {phase === "done" && <span className="inline-flex items-center gap-2 font-medium text-success"><CheckCircle2 className="size-4" /> Worker online - track it on the dashboard.</span>}
            {phase === "failed" && <span className="inline-flex items-center gap-2 font-medium text-destructive"><XCircle className="size-4" /> Install stopped - see the log.</span>}
          </div>
          <div className="max-h-56 overflow-auto rounded-lg border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-[12px] leading-relaxed text-content-default">
            <div className="mb-1 flex items-center gap-1.5 text-content-soft"><Terminal className="size-3" /> install log</div>
            {log.map((l, i) => (<div key={i} className="whitespace-pre-wrap">{l}</div>))}
            <div ref={logEnd} />
          </div>
        </>
      )}
    </div>
  );
}
