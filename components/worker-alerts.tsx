"use client";

import { useEffect, useState } from "react";
import { Bell, Loader2, Send, Trash2, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isDesktop, runSetupStreamed } from "@/lib/tauri";

const LS_KEY = "lightnode.alertWebhook";

/**
 * Opt-in downtime alerts. The keep-online watchdog reads the webhook URL from
 * ~/.lightnode/alerts.webhook and posts (Discord-compatible JSON) on state changes
 * only - worker down / Docker down / recovered - so it never spams. Desktop only:
 * writing that local file needs the native runner. The URL is passed via env, never
 * interpolated into the command string (no shell injection).
 */
export function WorkerAlerts() {
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
    run(
      "save",
      'mkdir -p "$HOME/.lightnode" && printf "%s" "$ALERT_WEBHOOK" > "$HOME/.lightnode/alerts.webhook" && rm -f "$HOME/.lightnode/alerts.last" && echo saved',
      { ALERT_WEBHOOK: u },
      (code) => {
        if (code !== 0) return setMsg("Could not save the webhook.");
        try {
          localStorage.setItem(LS_KEY, u);
        } catch {
          /* ignore */
        }
        setSaved(u);
        setMsg("Saved. The watchdog will ping you on state changes.");
      },
    );
  };

  const test = () => {
    run(
      "test",
      'curl -s -m 8 -H "content-type: application/json" -d "{\\"content\\":\\"LightNode test alert - downtime alerts are working.\\"}" "$ALERT_WEBHOOK" >/dev/null 2>&1 && echo sent || echo failed',
      { ALERT_WEBHOOK: (saved || url).trim() },
      (code) => setMsg(code === 0 ? "Test sent - check your channel." : "Test failed - double-check the URL."),
    );
  };

  const remove = () => {
    run("remove", 'rm -f "$HOME/.lightnode/alerts.webhook" "$HOME/.lightnode/alerts.last" && echo removed', {}, (code) => {
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
        <h3 className="text-sm font-semibold text-content-primary">Downtime alerts</h3>
        {saved && <Check className="size-3.5 text-success" />}
      </div>
      <p className="mb-3 text-xs text-content-soft">
        Get a Discord (or any webhook) ping if your worker goes down or comes back. Opt-in, checked every 10 minutes,
        and only on a change so it never spams.
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
