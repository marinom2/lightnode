"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isDesktop } from "@/lib/tauri";

/** Hero buttons that adapt to where they run: the web pushes the download, the
 *  desktop app (already installed) sends you straight to setting up a worker. */
export function HomeHeroCta() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isDesktop()), []);

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
      <Link href="/onboard">
        <Button variant="gradient" size="lg">
          {desktop ? (
            <>
              Set up your worker <ArrowRight />
            </>
          ) : (
            <>
              <Download /> Get the app
            </>
          )}
        </Button>
      </Link>
      <Link href="/dashboard">
        <Button variant="outline" size="lg">
          {desktop ? "My worker dashboard" : "I already run a worker"}
        </Button>
      </Link>
    </div>
  );
}
