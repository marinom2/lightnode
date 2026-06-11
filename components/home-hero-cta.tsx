"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Code2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isDesktop } from "@/lib/tauri";

/** Hero buttons that adapt to where they run. The desktop app (already
 *  installed) is operator-only, so it goes straight to worker setup. The web
 *  hero is dual-track, so each track gets one equal-weight primary CTA. */
export function HomeHeroCta() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isDesktop()), []);

  if (desktop) {
    return (
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild variant="gradient" size="lg">
          <Link href="/onboard">
            Set up your worker <ArrowRight />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/dashboard">My worker dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
      <Button asChild variant="gradient" size="lg">
        <Link href="/build">
          <Code2 /> Build with the SDK
        </Link>
      </Button>
      <Button asChild variant="gradient" size="lg">
        <Link href="/onboard">
          <Download /> Get the app
        </Link>
      </Button>
    </div>
  );
}
