import { Download, ScanLine, Rocket, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { AppleIcon, LinuxIcon, WindowsIcon } from "@/components/os-icons";

const RELEASES = "https://github.com/marinom2/lightnode/releases/latest";

const STEPS = [
  { icon: Download, t: "Download", d: "Grab the app for your OS." },
  { icon: ScanLine, t: "Auto-detect", d: "It reads your real GPU, VRAM, CPU and RAM." },
  { icon: Rocket, t: "One click", d: "Press Install - it sets up and runs everything." },
  { icon: HeartPulse, t: "Earn", d: "Your worker goes live and starts earning $LCAI." },
];

/** Web-facing band: get the desktop app for the literal one-click install. */
export function DownloadDesktop() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-10">
      <div className="relative overflow-hidden rounded-3xl border border-bdr-soft bg-card/60 p-[1px]">
        <div className="absolute -right-24 -top-24 size-72 rounded-full bg-gradient-primary opacity-20 blur-3xl" />
        <div className="relative rounded-[23px] bg-card/70 p-8 backdrop-blur-sm md:p-10">
          <div className="grid items-center gap-8 md:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold leading-tight tracking-tight text-content-primary">
                Run a worker in <span className="text-gradient">one click</span>, from your desktop.
              </h2>
              <p className="mt-3 text-content-soft">
                Download the app, press Install, and it handles the rest - reads your hardware, sets up the node,
                stakes, and goes live. No terminal, no config, no copy-paste.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <a href={RELEASES} target="_blank" rel="noreferrer">
                  <Button variant="gradient" size="lg">
                    <Download /> Download the app
                  </Button>
                </a>
                <div className="flex items-center gap-3 text-content-soft">
                  <AppleIcon className="size-5" />
                  <LinuxIcon className="size-5" />
                  <WindowsIcon className="size-[18px]" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {STEPS.map((s, i) => (
                <div key={s.t} className="rounded-2xl border border-bdr-soft bg-surface-base-subtle p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <IconChip icon={s.icon} size="sm" />
                    <span className="font-mono text-xs text-content-soft">0{i + 1}</span>
                  </div>
                  <div className="text-sm font-semibold text-content-primary">{s.t}</div>
                  <div className="mt-0.5 text-xs text-content-soft">{s.d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
