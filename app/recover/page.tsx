"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RecoverKeys } from "@/components/recover-keys";

export default function RecoverPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-content-soft transition-colors hover:text-content-primary"
      >
        <ArrowLeft className="size-4" /> Back to dashboard
      </Link>
      <RecoverKeys />
    </div>
  );
}
