"use client";

import { useEffect, useState, type ReactElement } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppleIcon, LinuxIcon, WindowsIcon } from "@/components/os-icons";
import { detectClientOS, OS_LABEL, type DownloadOS } from "@/lib/os-detect";

const RELEASES = "https://github.com/marinom2/lightnode/releases/latest";

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
  useEffect(() => setOS(detectClientOS()), []);

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
    </div>
  );
}
