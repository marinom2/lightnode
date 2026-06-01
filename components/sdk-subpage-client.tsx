"use client";

/**
 * Client-side renderer for the dedicated /build/sdks/<id> sub-pages.
 *
 * Visual language is intentionally pared down: dark navy panels, purple-
 * tinted borders (rgba(112,100,233,0.20)), CCCEEF body text, 7376AA mute,
 * one accent (7064E9). Generous spacing, soft hierarchy, one widget per
 * page so the focus is on what the SDK does, not on the chrome around it.
 */

import type React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Boxes } from "lucide-react";
import { MODULES, type ModuleId } from "@/lib/sdk-modules-data";
import { Widget, DocLinks } from "@/components/sdk-modules";

export function SdkSubpageClient({ id }: { id: ModuleId }) {
  const m = MODULES.find((x) => x.id === id);
  if (!m) return null;
  // Tagline + subtitle. Prefer the curated fields on the module data;
  // fall back to splitting the blurb so older modules keep working.
  const sentences = m.blurb.split(/(?<=\.)\s+/);
  const tagline = m.tagline ?? sentences[0] ?? m.blurb;
  const subtitle = m.subtitle ?? (sentences.slice(1).join(" ").trim() || null);

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

      {/* Hero. Massive title with brand-gradient accent on a key word,
          kicker eyebrow beneath, soft description, one gradient CTA.
          Mirrors the Lightchain DAO hero treatment. */}
      <header className={`mb-20 ${m.heroImage ? "grid items-center gap-10 lg:grid-cols-[1.1fr_minmax(0,480px)]" : ""}`}>
        <div>
          <h1 className="text-balance text-5xl font-bold tracking-tight text-[#CCCEEF] sm:text-6xl lg:text-7xl">
            {renderAccentedTitle(m.title, m.titleAccent)}
          </h1>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7376AA]">
            {m.kicker ?? "lightnode-sdk"}
          </p>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-[#CCCEEF]">
            {subtitle ?? tagline}
          </p>
          {m.cta ? (
            <a
              href={m.cta.href}
              {...(m.cta.href.startsWith("#") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
              className="group mt-10 inline-flex items-center gap-3 rounded-xl px-6 py-3.5 text-sm font-bold uppercase tracking-wider text-[#CCCEEF] shadow-[0_8px_24px_-6px_rgba(112,100,233,0.55)] transition-all duration-500 active:scale-95"
              style={{ background: "linear-gradient(94deg, #dd00ac 10.66%, #7130c3 53.03%, #410093 96.34%)" }}
            >
              {m.cta.label}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </a>
          ) : null}
        </div>
        {m.heroImage ? (
          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="pointer-events-none absolute inset-0 -z-10 scale-110 rounded-full bg-[radial-gradient(closest-side,rgba(112,100,233,0.18),transparent)] blur-2xl" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.heroImage}
              alt={`${m.title} illustration`}
              className="h-auto w-full"
              loading="eager"
            />
          </div>
        ) : null}
      </header>

      {/* DocLinks moved out of the hero - a quieter row below it. */}
      <div className="mb-14">
        <DocLinks m={m} />
      </div>

      {/* The widget - the main event. Anchored so hero CTAs can jump here. */}
      <section id="try-it" className="mb-14 scroll-mt-20">
        <div className="rounded-xl border border-[rgba(112,100,233,0.20)] bg-[#070710] p-5 sm:p-8">
          <Widget id={m.id} />
        </div>
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

/**
 * Render the hero title with one substring rendered in the brand magenta-
 * to-purple gradient. If `accent` is missing or not found in `title`, the
 * full title renders in body color (no gradient).
 */
function renderAccentedTitle(title: string, accent?: string): React.ReactNode {
  if (!accent) return title;
  const idx = title.indexOf(accent);
  if (idx === -1) return title;
  const before = title.slice(0, idx);
  const after = title.slice(idx + accent.length);
  return (
    <>
      {before}
      <span
        className="bg-clip-text text-transparent"
        style={{ backgroundImage: "linear-gradient(94deg, #dd00ac 10.66%, #7130c3 53.03%, #410093 96.34%)" }}
      >
        {accent}
      </span>
      {after}
    </>
  );
}
