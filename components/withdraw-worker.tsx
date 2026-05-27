"use client";

import { useCallback, useEffect, useState } from "react";
import { Send, Loader2, CheckCircle2, AlertTriangle, Wallet, Trash2 } from "lucide-react";
import { createPublicClient, createWalletClient, http, formatEther, isAddress, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useAccount } from "wagmi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NETWORKS } from "@/lib/network";
import { useNetwork } from "@/lib/network-context";
import { getSecret, wipeWorkerSecrets, SECRET_WORKER_KEY } from "@/lib/secrets";
import { fmt, cn } from "@/lib/utils";

const PRIVKEY_RE = /^0x[a-fA-F0-9]{64}$/;

/**
 * Send the worker wallet's spendable LCAI to a wallet you control. Signs locally
 * with the worker key held on this device and broadcasts over the network RPC -
 * the key never leaves the machine. This moves the wallet's free balance (e.g.
 * the stake returned after deregister + leftover gas); the staked amount stays
 * locked until you deregister.
 */
export function WithdrawWorker() {
  const { network } = useNetwork();
  const net = NETWORKS[network];
  const { address: connected } = useAccount();

  const [key, setKey] = useState("");
  const [addr, setAddr] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [dest, setDest] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "done">("idle");
  const [hash, setHash] = useState("");
  const [error, setError] = useState("");
  const [wiped, setWiped] = useState(false);

  useEffect(() => {
    let on = true;
    setKey("");
    setAddr("");
    getSecret(SECRET_WORKER_KEY, network).then((k) => {
      if (on && PRIVKEY_RE.test(k)) {
        setKey(k);
        setAddr(privateKeyToAccount(k as `0x${string}`).address);
      }
    });
    return () => {
      on = false;
    };
  }, [network]);
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
    if (!addr) return;
    try {
      const pub = createPublicClient({ chain, transport: http(net.rpc) });
      setBalance(await pub.getBalance({ address: addr as `0x${string}` }));
    } catch {
      /* leave as-is */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr, net.rpc, net.chainId]);

  useEffect(() => {
    refreshBalance();
    const t = setInterval(refreshBalance, 15_000);
    return () => clearInterval(t);
  }, [refreshBalance]);

  if (!key) return null; // nothing to withdraw from without a local worker key

  const bal = balance ?? 0n;
  const destValid = isAddress(dest);

  const send = async () => {
    if (!destValid) return;
    setError("");
    setPhase("sending");
    setHash("");
    try {
      const account = privateKeyToAccount(key as `0x${string}`);
      const pub = createPublicClient({ chain, transport: http(net.rpc) });
      const [fresh, gasPrice] = await Promise.all([pub.getBalance({ address: account.address }), pub.getGasPrice()]);
      const fee = gasPrice * 21_000n * 2n; // a transfer is 21k gas; 2x buffer
      if (fresh <= fee) throw new Error("Balance too low to cover the network fee.");
      const value = fresh - fee;
      const wallet = createWalletClient({ account, chain, transport: http(net.rpc) });
      const tx = await wallet.sendTransaction({ to: dest as `0x${string}`, value, gas: 21_000n });
      setHash(tx);
      await pub.waitForTransactionReceipt({ hash: tx });
      setPhase("done");
      refreshBalance();
    } catch (e) {
      setError((e as Error).message.split("\n")[0].slice(0, 160));
      setPhase("idle");
    }
  };

  const wipeKey = async () => {
    await wipeWorkerSecrets(network);
    setWiped(true);
    setKey("");
  };

  const nearEmpty = balance !== null && bal < 1_000_000_000_000_000n; // < 0.001 LCAI

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center gap-2">
        <Send className="size-4 text-content-soft" />
        <h3 className="text-sm font-semibold text-content-primary">Withdraw to my wallet</h3>
      </div>
      <p className="mb-4 text-xs text-content-soft">
        Sends your worker wallet&apos;s spendable LCAI (returned stake after deregister + leftover gas) to a wallet you
        control. Signed locally with your worker key - it never leaves this device. The staked amount stays locked until
        you deregister.
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bdr-soft bg-surface-base-subtle/60 p-3">
        <div className="text-xs text-content-soft">
          Worker wallet
          <div className="font-mono text-sm text-content-primary">
            {addr.slice(0, 10)}…{addr.slice(-8)}
          </div>
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
        disabled={phase === "sending" || !destValid || bal === 0n}
        onClick={send}
      >
        {phase === "sending" ? <Loader2 className="animate-spin" /> : <Send />}
        {phase === "sending" ? "Sending..." : "Send all to my wallet"}
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

      {phase === "done" && nearEmpty && !wiped && (
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
        <p className={cn("mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-success")}>
          <CheckCircle2 className="size-3.5" /> Worker key wiped from this device.
        </p>
      )}
    </Card>
  );
}
