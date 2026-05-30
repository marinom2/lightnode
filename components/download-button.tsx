"use client";

import { useEffect, useState, type ReactElement } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppleIcon, LinuxIcon, WindowsIcon } from "@/components/os-icons";
import { detectClientOS, OS_LABEL, type DownloadOS } from "@/lib/os-detect";

const RELEASES = "https://github.com/marinom2/lightnode/releases/latest";
// One-line installer (served from /public/install.sh): picks the right package
// for the user's distro, installs the runtime libs the app needs, and adds it to
// the apps menu - the reliable "just works" path on Linux's fragmented packaging.
const LINUX_INSTALL_CMD = "curl -fsSL https://lightnode.app/install.sh | bash";

const OS_ICON: Record<DownloadOS, (p: { className?: string }) => ReactElement> = {
  mac: AppleIcon,
  windows: WindowsIcon,
  linux: LinuxIcon,
};

const ALL_OS: DownloadOS[] = ["mac", "windows", "linux"];

/**
 * Detects the visitor's OS and offers a one-click download of the matching
 * installer (via /api/download, which redirects to the latest release asset).
 * Other platforms stay one click away, plus a link to all downloads + checksums.
 */
export function DownloadButton() {
  const [os, setOS] = useState<DownloadOS | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => setOS(detectClientOS()), []);

  const copyLinuxCmd = async () => {
    try {
      await navigator.clipboard.writeText(LINUX_INSTALL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (e.g. insecure context): leave the command visible to copy manually.
      setCopied(false);
    }
  };

  const PrimaryIcon = os ? OS_ICON[os] : null;
  const others = ALL_OS.filter((o) => o !== os);

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-4">
        <a href={os ? `/api/download?os=${os}` : RELEASES} {...(os ? {} : { target: "_blank", rel: "noreferrer" })}>
          <Button variant="gradient" size="lg">
            {PrimaryIcon ? <PrimaryIcon className="size-5" /> : <Download />}
            {os ? `Download for ${OS_LABEL[os]}` : "Download the app"}
          </Button>
        </a>

        {/* other platforms, one click away */}
        <div className="flex items-center gap-3 text-content-soft">
          {others.map((o) => {
            const Icon = OS_ICON[o];
            return (
              <a
                key={o}
                href={`/api/download?os=${o}`}
                title={`Download for ${OS_LABEL[o]}`}
                aria-label={`Download for ${OS_LABEL[o]}`}
                className="transition-colors hover:text-content-primary"
              >
                <Icon className="size-5" />
              </a>
            );
          })}
        </div>
      </div>

      <a
        href={RELEASES}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-content-soft underline-offset-4 hover:text-content-primary hover:underline"
      >
        All downloads &amp; checksums
      </a>

      {os === "mac" && (
        <p className="mt-1 max-w-md text-[11px] leading-relaxed text-content-soft">
          First launch on macOS: <span className="text-content-primary">right-click the app → Open → Open</span> (one
          time). The app isn&apos;t notarized yet, so macOS asks once - no Terminal needed.
        </p>
      )}

      {os === "linux" && (
        <div className="mt-1 w-full max-w-xl">
          <p className="text-[11px] leading-relaxed text-content-soft">
            Easiest on Linux - paste this in a terminal. It picks the right package for your distro, installs what the
            app needs, and adds LightNode to your apps menu (the download above is a portable AppImage you&apos;d have to
            make executable yourself):
          </p>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-bdr-soft bg-surface-base-subtle px-3 py-2">
            <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-content-primary">
              {LINUX_INSTALL_CMD}
            </code>
            <button
              type="button"
              onClick={copyLinuxCmd}
              className="shrink-0 rounded-md border border-bdr-soft px-2 py-1 text-[11px] text-content-soft transition-colors hover:text-content-primary"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
