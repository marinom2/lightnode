"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-5 py-24 text-center">
      <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-destructive/15 text-destructive">
        <AlertTriangle className="size-6" />
      </span>
      <h1 className="text-2xl font-semibold text-content-primary">Something went wrong</h1>
      <p className="mt-2 text-content-soft">
        An unexpected error occurred. You can retry — your wallet stays connected.
      </p>
      <Button variant="gradient" className="mt-6" onClick={reset}>
        <RefreshCw /> Try again
      </Button>
    </div>
  );
}
