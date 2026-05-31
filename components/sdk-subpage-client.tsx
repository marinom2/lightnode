"use client";

/**
 * Client-side renderer for the dedicated /build/sdks/<id> sub-pages.
 *
 * Visual language is intentionally pared down: dark navy panels, purple-
 * tinted borders (rgba(112,100,233,0.20)), CCCEEF body text, 7376AA mute,
 * one accent (7064E9). Generous spacing, soft hierarchy, one widget per
 * page so the focus is on what the SDK does, not on the chrome around it.
 */

import Link from "next/link";
import { ArrowLeft, ArrowRight, Boxes } from "lucide-react";
import { MODULES, type ModuleId } from "@/lib/sdk-modules-data";
import { Widget, DocLinks, CodeBox } from "@/components/sdk-modules";

export function SdkSubpageClient({ id }: { id: ModuleId }) {
  const m = MODULES.find((x) => x.id === id);
  if (!m) return null;

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      {/* Back link, quiet. */}
      <Link
        href="/build/sdks"
        className="mb-10 inline-flex items-center gap-1.5 text-sm text-[#7376AA] transition-colors hover:text-[#CCCEEF]"
      >
        <ArrowLeft className="size-4" />
        Modules
      </Link>

      {/* Hero. Generous vertical room, soft eyebrow, large title, soft blurb. */}
      <header className="mb-12">
        <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-[#14152C]">
          <m.icon className="size-6 text-[#7064E9]" />
        </div>
        <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-[#7376AA]">lightnode-sdk 0.6.x</p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-[#CCCEEF] sm:text-5xl">
          {m.title}
        </h1>
        <p className="mt-5 max-w-3xl text-balance text-base leading-relaxed text-[#7376AA] sm:text-lg">
          {m.blurb}
        </p>
        <DocLinks m={m} />
      </header>

      {/* The widget in a calm, deep panel - the main event. */}
      <section className="mb-14">
        <div className="rounded-xl border border-[rgba(112,100,233,0.20)] bg-[#070710] p-5 sm:p-8">
          <Widget id={m.id} />
        </div>
      </section>

      {/* The exported API. Quiet section title, code block. */}
      <section className="mb-14">
        <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-[#7376AA]">The exported API</p>
        <h2 className="mb-4 text-2xl font-semibold tracking-tight text-[#CCCEEF]">A small surface to learn</h2>
        <CodeBox code={m.snippet} />
      </section>

      {/* Cross-link grid - one row, simple, no decoration. */}
      <section className="mb-4">
        <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-[#7376AA]">More from lightnode-sdk</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.filter((x) => x.id !== m.id).map((other) => (
            <Link
              key={other.id}
              href={`/build/sdks/${other.id}`}
              className="group flex items-start gap-4 rounded-xl border border-[rgba(112,100,233,0.20)] bg-[#070710] p-5 transition-all hover:-translate-y-0.5 hover:border-[rgba(112,100,233,0.40)]"
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#14152C]">
                <other.icon className="size-4 text-[#7064E9]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#CCCEEF]">{other.title}</div>
                <div className="line-clamp-2 text-xs text-[#7376AA]">{other.blurb}</div>
              </div>
              <ArrowRight className="size-4 shrink-0 text-[#7376AA] transition-all group-hover:translate-x-0.5 group-hover:text-[#7064E9]" />
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-12 flex flex-wrap items-center justify-between gap-2 text-xs text-[#7376AA]">
        <Link href="/build/sdks" className="inline-flex items-center gap-1.5 transition-colors hover:text-[#CCCEEF]">
          <ArrowLeft className="size-3" /> Back to all modules
        </Link>
        <Link href="/build" className="inline-flex items-center gap-1.5 transition-colors hover:text-[#CCCEEF]">
          <Boxes className="size-3" /> Build hub
        </Link>
      </div>
    </div>
  );
}
