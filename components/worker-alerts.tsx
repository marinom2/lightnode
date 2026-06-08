"use client";

import { useEffect, useState } from "react";
import { Bell, Loader2, Send, Trash2, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isDesktop, runSetupStreamed } from "@/lib/tauri";
import { getWorkerAddr } from "@/lib/secrets";
import type { NetworkId } from "@/lib/network";

const LS_KEY = "lightnode.alertWebhook";

/**
 * Opt-in worker alerts. The keep-online watchdog (launchd / cron / Scheduled Task,
 * running every 10 min even when this app is CLOSED) reads the webhook URL from
 * ~/.lightnode/alerts.webhook and posts Discord-compatible JSON on STATE CHANGES
 * only - so it never spams. It alerts on the worker going down / recovering AND on
 * the on-chain conditions an operator must not miss: out of gas, stuck jobs, and
 * completed jobs ready to settle. Those economic checks read the worker + this
 * app's URL from ~/.lightnode/alerts.conf (written here on Save) and hit the public
 * /api/worker-alert. Desktop only; the commands are OS-aware (bash on macOS/Linux,
 * PowerShell on Windows) and pass the URL via env, never the command string.
 */
export function WorkerAlerts({ network }: { network: NetworkId }) {
  const [desktop, setDesktop] = useState(false);
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setDesktop(isDesktop());
    try {
      const v = localStorage.getItem(LS_KEY) || "";
      setUrl(v);
      setSaved(v);
    } catch {
      /* no localStorage */
    }
  }, []);

  if (!desktop) return null;

  const valid = /^https:\/\/\S+$/.test(url.trim());
  const isWin = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  // Per-network managed worker address + this app's origin, so the watchdog knows
  // which worker to check on-chain and where to reach the alert endpoint.
  const addr = getWorkerAddr(network);
  // The watchdog (app closed) must reach this from a scheduled task, so BASE must
  // be a reachable https deployment - never http://localhost (tauri dev). Use the
  // current https origin, else fall back to the production host.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = /^https:\/\//.test(origin) ? origin : "https://lightnode.app";

  // OS-aware command builders. macOS/Linux run bash, Windows runs PowerShell
  // (run_command_streamed picks the shell), so each native action needs both. The
  // old single bash form silently failed on Windows.
  const saveCmd = isWin
    ? '$d = Join-Path $env:USERPROFILE ".lightnode"; New-Item -ItemType Directory -Force -Path $d | Out-Null; Set-Content -Path (Join-Path $d "alerts.webhook") -Value $env:ALERT_WEBHOOK -NoNewline; Set-Content -Path (Join-Path $d "alerts.conf") -Value @("WORKER_ADDR=$env:ALERT_ADDR","NET=$env:ALERT_NET","BASE=$env:ALERT_BASE"); Remove-Item (Join-Path $d "alerts.last"),(Join-Path $d "alerts.gas"),(Join-Path $d "alerts.stuck"),(Join-Path $d "alerts.settle") -ErrorAction SilentlyContinue; Write-Output saved'
    : 'mkdir -p "$HOME/.lightnode" && printf "%s" "$ALERT_WEBHOOK" > "$HOME/.lightnode/alerts.webhook" && printf "WORKER_ADDR=%s\\nNET=%s\\nBASE=%s\\n" "$ALERT_ADDR" "$ALERT_NET" "$ALERT_BASE" > "$HOME/.lightnode/alerts.conf" && rm -f "$HOME/.lightnode/alerts.last" "$HOME/.lightnode/alerts.gas" "$HOME/.lightnode/alerts.stuck" "$HOME/.lightnode/alerts.settle" && echo saved';

  const testCmd = isWin
    ? 'try { Invoke-RestMethod -Uri $env:ALERT_WEBHOOK -Method Post -ContentType "application/json" -Body (@{content="LightNode test alert - downtime + on-chain alerts are working."} | ConvertTo-Json) -TimeoutSec 8 | Out-Null; Write-Output sent } catch { Write-Output failed }'
    : 'curl -s -m 8 -H "content-type: application/json" -d "{\\"content\\":\\"LightNode test alert - downtime + on-chain alerts are working.\\"}" "$ALERT_WEBHOOK" >/dev/null 2>&1 && echo sent || echo failed';

  const removeCmd = isWin
    ? '$d = Join-Path $env:USERPROFILE ".lightnode"; Remove-Item (Join-Path $d "alerts.webhook"),(Join-Path $d "alerts.conf"),(Join-Path $d "alerts.last"),(Join-Path $d "alerts.gas"),(Join-Path $d "alerts.stuck"),(Join-Path $d "alerts.settle") -ErrorAction SilentlyContinue; Write-Output removed'
    : 'rm -f "$HOME/.lightnode/alerts.webhook" "$HOME/.lightnode/alerts.conf" "$HOME/.lightnode/alerts.last" "$HOME/.lightnode/alerts.gas" "$HOME/.lightnode/alerts.stuck" "$HOME/.lightnode/alerts.settle" && echo removed';

  const run = (kind: "save" | "test" | "remove", command: string, env: Record<string, string>, onDone: (code: number) => void) => {
    setBusy(kind);
    setMsg("");
    void runSetupStreamed(
      command,
      env,
      () => {},
      (code) => {
        setBusy(null);
        onDone(code);
      },
    );
  };

  const save = () => {
    const u = url.trim();
    if (!/^https:\/\/\S+$/.test(u)) {
      setMsg("Enter a valid https webhook URL.");
      return;
    }
    run("save", saveCmd, { ALERT_WEBHOOK: u, ALERT_ADDR: addr, ALERT_NET: network, ALERT_BASE: base }, (code) => {
      if (code !== 0) return setMsg("Could not save the webhook.");
      try {
        localStorage.setItem(LS_KEY, u);
      } catch {
        /* ignore */
      }
      setSaved(u);
      setMsg(
        addr
          ? "Saved. You'll be pinged on downtime, recovery, out-of-gas, stuck jobs, and earnings ready to settle - even with the app closed."
          : "Saved downtime alerts. Set up a worker on this machine to also get on-chain alerts (out-of-gas, stuck jobs, settle).",
      );
    });
  };

  const test = () => {
    run("test", testCmd, { ALERT_WEBHOOK: (saved || url).trim() }, (code) =>
      setMsg(code === 0 ? "Test sent - check your channel." : "Test failed - double-check the URL."),
    );
  };

  const remove = () => {
    run("remove", removeCmd, {}, (code) => {
      if (code !== 0) return;
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        /* ignore */
      }
      setUrl("");
      setSaved("");
      setMsg("Alerts disabled.");
    });
  };

  return (
    <Card className="p-5">
      <div className="mb-1.5 flex items-center gap-2">
        <Bell className="size-4 text-primary" />
        <h3 className="text-sm font-semibold text-content-primary">Worker alerts</h3>
        {saved && <Check className="size-3.5 text-success" />}
      </div>
      <p className="mb-3 text-xs text-content-soft">
        Get a Discord (or any webhook) ping when your worker goes down or recovers, runs{" "}
        <span className="text-content-default">out of gas</span>, has{" "}
        <span className="text-content-default">stuck jobs</span>, or has{" "}
        <span className="text-content-default">earnings ready to settle</span>. Checked every 10 minutes by the keep-online
        watchdog - even when this app is closed - and only on a change, so it never spams.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://discord.com/api/webhooks/..."
          className="h-10 flex-1 rounded-lg border border-bdr-soft bg-surface-base-subtle px-3 font-mono text-xs text-content-primary outline-none focus:border-primary"
        />
        <div className="flex gap-2">
          <Button size="sm" variant="gradient" onClick={save} disabled={busy !== null || !valid || url.trim() === saved}>
            {busy === "save" ? <Loader2 className="animate-spin" /> : <Check />} Save
          </Button>
          <Button size="sm" variant="outline" onClick={test} disabled={busy !== null || !(saved || valid)}>
            {busy === "test" ? <Loader2 className="animate-spin" /> : <Send />} Test
          </Button>
          {saved && (
            <Button size="sm" variant="outline" onClick={remove} disabled={busy !== null}>
              {busy === "remove" ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          )}
        </div>
      </div>
      {msg && <p className="mt-2 text-xs text-content-soft">{msg}</p>}
    </Card>
  );
}
