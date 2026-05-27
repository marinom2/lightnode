"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, CheckCircle2, AlertTriangle, Wallet, Trash2, KeyRound } from "lucide-react";
import { createPublicClient, createWalletClient, http, formatEther, isAddress, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useAccount } from "wagmi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NETWORKS } from "@/lib/network";
import { useNetwork } from "@/lib/network-context";
import { getSecret, wipeWorkerSecrets, getWorkerAddr, SECRET_WORKER_KEY, SECRET_WORKER_PW } from "@/lib/secrets";
import { useSavedWorkers } from "@/lib/saved-workers";
import { isDesktop, runSetupStreamed } from "@/lib/tauri";
import { detectClientOS } from "@/lib/os-detect";
import { sweepCommand, type OS } from "@/lib/scriptgen";
import { fmt, shortAddr } from "@/lib/utils";

const PRIVKEY_RE = /^0x[a-fA-F0-9]{64}$/;
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Send the managed worker's spendable LCAI (returned stake after deregister +
 * leftover gas) to a wallet you control. Two signing paths, picked automatically:
 *  - if the in-app key controls the worker, it signs locally in the browser
 *    (viem, precise gas);
 *  - otherwise (e.g. the in-app key is a newer wallet for another network) it
 *    falls back to the worker key in the on-disk keystore via the desktop
 *    runner, so the worker that actually ran here can still be withdrawn.
 * The staked amount stays locked until you deregister.
 */
export function WithdrawWorker() {
  const { network } = useNetwork();
  const net = NETWORKS[network];
  const { address: connected } = useAccount();
  const { saved } = useSavedWorkers();

  // The worker we manage on this device: the per-network saved address, else the
  // first watchlisted one (same resolution the Operations panel uses).
  const resolveWorkerAddr = useCallback((): string => {
    const a = getWorkerAddr(network);
    if (ADDR_RE.test(a)) return a;
    return saved.find((s) => ADDR_RE.test(s)) ?? "";
  }, [network, saved]);

  const [inAppKey, setInAppKey] = useState("");
  const [inAppAddr, setInAppAddr] = useState("");
  const [target, setTarget] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [dest, setDest] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "done">("idle");
  const [hash, setHash] = useState("");
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [wiped, setWiped] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [os, setOs] = useState<OS>("macos");
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setDesktop(isDesktop());
    const d = detectClientOS();
    setOs(d === "windows" ? "windows" : d === "linux" ? "linux" : "macos");
  }, []);
  useEffect(() => () => stopRef.current?.(), []);

  useEffect(() => {
    let on = true;
    setBalance(null);
    setPhase("idle");
    setHash("");
    setError("");
    setLog([]);
    setWiped(false);
    getSecret(SECRET_WORKER_KEY, network).then((k) => {
      if (!on) return;
      const validKey = PRIVKEY_RE.test(k);
      let addr = "";
      if (validKey) {
        try {
          addr = privateKeyToAccount(k as `0x${string}`).address;
        } catch {
          /* malformed key */
        }
      }
      setInAppKey(validKey ? k : "");
      setInAppAddr(addr);
      const managed = resolveWorkerAddr();
      setTarget(managed || addr);
    });
    return () => {
      on = false;
    };
  }, [network, resolveWorkerAddr]);

  useEffect(() => {
    if (connected && !dest) setDest(connected);
  }, [connected, dest]);

  const chain: Chain = {
    id: net.chainId,
    name: net.label,
    nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
    rpcUrls: { default: { http: [net.rpc] } },
  };

  const refreshBalance = useCallback(async () => {
    if (!ADDR_RE.test(target)) return;
    try {
      const pub = createPublicClient({ chain, transport: http(net.rpc) });
      setBalance(await pub.getBalance({ address: target as `0x${string}` }));
    } catch {
      /* leave as-is */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, net.rpc, net.chainId]);

  useEffect(() => {
    refreshBalance();
    const t = setInterval(refreshBalance, 15_000);
    return () => clearInterval(t);
  }, [refreshBalance]);

  // The in-app key controls the worker we're managing -> sign in the browser.
  const matched = !!inAppKey && ADDR_RE.test(target) && inAppAddr.toLowerCase() === target.toLowerCase();
  // Otherwise the desktop can still sign with the worker key held in the on-disk
  // keystore (the worker that actually ran on this machine).
  const keystorePath = !matched && desktop && ADDR_RE.test(target);
  if (!matched && !keystorePath) return null;

  const bal = balance ?? 0n;
  const destValid = isAddress(dest);

  // Path A: in-app key signs in the browser (precise gas, near-full sweep).
  const sendViem = async () => {
    if (!destValid) return;
    setError("");
    setPhase("sending");
    setHash("");
    try {
      const account = privateKeyToAccount(inAppKey as `0x${string}`);
      const pub = createPublicClient({ chain, transport: http(net.rpc) });
      const [fresh, gasPrice] = await Promise.all([pub.getBalance({ address: account.address }), pub.getGasPrice()]);
      const fee = gasPrice * 21_000n * 2n;
      if (fresh <= fee) throw new Error("Balance too low to cover the network fee.");
      const wallet = createWalletClient({ account, chain, transport: http(net.rpc) });
      const tx = await wallet.sendTransaction({ to: dest as `0x${string}`, value: fresh - fee, gas: 21_000n });
      setHash(tx);
      await pub.waitForTransactionReceipt({ hash: tx });
      setPhase("done");
      refreshBalance();
    } catch (e) {
      setError((e as Error).message.split("\n")[0].slice(0, 160));
      setPhase("idle");
    }
  };

  // Path B: the worker key is NOT in the app (it's in the on-disk keystore).
  // Run the keystore-signed sweep through the desktop runner; the raw key is
  // derived on-device and never enters the web layer.
  const sweepFromKeystore = async () => {
    if (!destValid) return;
    setError("");
    setPhase("sending");
    setLog([`$ withdraw ${shortAddr(target)} -> ${shortAddr(dest)}...`]);
    const env: Record<string, string> = { NETWORK: network };
    const pw = await getSecret(SECRET_WORKER_PW, network);
    if (pw) env.WORKER_PASSWORD = pw;
    env.WORKER_ADDR = target;
    // Deliberately NOT passing WORKER_PRIVKEY: the in-app key is a different
    // wallet, so we let the command derive the right key from the keystore.
    stopRef.current = await runSetupStreamed(
      sweepCommand(os, dest),
      env,
      (line) => setLog((l) => [...l, line]),
      (code) => {
        setLog((l) => [...l, code === 0 ? "done." : `exited (${code}).`]);
        setPhase(code === 0 ? "done" : "idle");
        if (code !== 0) setError("Withdraw failed - see the log above.");
        refreshBalance();
      },
    );
  };

  const onWithdraw = () => (matched ? sendViem() : sweepFromKeystore());

  const wipeKey = async () => {
    await wipeWorkerSecrets(network);
    setWiped(true);
    setInAppKey("");
  };

  const nearEmpty = balance !== null && bal < 1_000_000_000_000_000n; // < 0.001 LCAI

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center gap-2">
        <Send className="size-4 text-content-soft" />
        <h3 className="text-sm font-semibold text-content-primary">Withdraw Funds</h3>
      </div>
      <p className="mb-4 text-xs text-content-soft">
        Sends your worker wallet&apos;s spendable LCAI (returned stake after deregister + leftover gas) to a wallet you
        control.{" "}
        {matched ? (
          <>Signed locally with your worker key - it never leaves this device.</>
        ) : (
          <>
            Signed on this device with the worker key from the on-disk keystore (the worker that ran here) - the raw key
            never enters the app.
          </>
        )}{" "}
        The staked amount stays locked until you deregister.
      </p>

      {!matched && (
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-bdr-soft bg-surface-base-subtle/60 px-2.5 py-1.5 text-[11px] text-content-soft">
          <KeyRound className="size-3.5" /> Withdrawing the worker on this machine ({shortAddr(target)}), not the in-app
          key.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bdr-soft bg-surface-base-subtle/60 p-3">
        <div className="text-xs text-content-soft">
          Worker wallet
          <div className="font-mono text-sm text-content-primary">{shortAddr(target)}</div>
        </div>
        <div className="text-right text-xs text-content-soft">
          Spendable balance
          <div className="text-lg font-semibold tabular-nums text-content-primary">
            {balance === null ? "…" : `${fmt(Number(formatEther(bal)), 4)} LCAI`}
          </div>
        </div>
      </div>

      <label className="text-xs text-content-soft">
        Destination wallet
        <input
          value={dest}
          onChange={(e) => setDest(e.target.value.trim())}
          placeholder="0x... where to send the funds"
          className="mt-1 h-10 w-full rounded-lg border border-bdr-soft bg-surface-base-subtle px-2.5 font-mono text-sm text-content-primary outline-none focus:border-primary"
        />
      </label>
      {connected && dest.toLowerCase() === connected.toLowerCase() && (
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-content-soft">
          <Wallet className="size-3" /> your connected wallet
        </p>
      )}

      <Button
        variant="gradient"
        className="mt-4 w-full"
        disabled={phase === "sending" || !destValid || (matched && bal === 0n)}
        onClick={onWithdraw}
      >
        {phase === "sending" ? <Loader2 className="animate-spin" /> : <Send />}
        {phase === "sending" ? "Sending..." : "Withdraw all funds"}
      </Button>

      {error && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {error}
        </p>
      )}
      {hash && (
        <p className="mt-3 text-xs text-content-soft">
          {phase === "done" ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-success">
              <CheckCircle2 className="size-3.5" /> Sent.
            </span>
          ) : (
            "Confirming on-chain… "
          )}{" "}
          <a href={`${net.explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            view transaction
          </a>
        </p>
      )}

      {log.length > 0 && (
        <div className="mt-3 max-h-48 overflow-auto rounded-lg border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-[12px] leading-relaxed text-content-default">
          {log.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {l}
            </div>
          ))}
        </div>
      )}

      {phase === "done" && matched && nearEmpty && !wiped && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3">
          <p className="text-xs text-content-default">
            The worker wallet is now empty. If you&apos;ve also deregistered and are done with this worker, you can wipe
            its key from this device.
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={wipeKey}>
            <Trash2 className="size-3.5" /> Wipe worker key from this device
          </Button>
        </div>
      )}
      {wiped && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-success">
          <CheckCircle2 className="size-3.5" /> Worker key wiped from this device.
        </p>
      )}
    </Card>
  );
}
