"use client";

/**
 * Client-side renderer for the dedicated /build/sdks/<id> sub-pages.
 *
 * Visual language is intentionally pared down: bordered panels, a soft
 * accent purple, and one brand magenta-to-purple gradient. All surfaces,
 * borders, and text colors use theme-aware tokens (bg-card, text-content-
 * primary, border-bdr-soft) so the page reads cleanly in both light and
 * dark modes - same component, two skins.
 */

import type React from "react";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Boxes, Check, Copy, Globe, PlayCircle, Server, Terminal } from "lucide-react";
import { MODULES, type ModuleId, type ModuleDef, type ScaffoldDef } from "@/lib/sdk-modules-data";
import { Widget, DocLinks, CodeBox, openSnippetInStackBlitz } from "@/components/sdk-modules";

export function SdkSubpageClient({ id }: { id: ModuleId }) {
  const m = MODULES.find((x) => x.id === id);
  if (!m) return null;
  // Tagline + subtitle. Prefer the curated fields on the module data;
  // fall back to splitting the blurb so older modules keep working.
  const sentences = m.blurb.split(/(?<=\.)\s+/);
  const tagline = m.tagline ?? sentences[0] ?? m.blurb;
  const subtitle = m.subtitle ?? (sentences.slice(1).join(" ").trim() || null);

  return (
    <div className="relative mx-auto max-w-5xl px-5 py-12 sm:py-16">
      {/* Pink-to-lavender aurora behind the hero (same treatment as the
          lightchain.ai marketing pages). Sits absolutely so it only
          washes the top of the page, not the widget below. */}
      <div className="aurora-hero" aria-hidden />
      {/* Back link, quiet. */}
      <Link
        href="/build/sdks"
        className="mb-10 inline-flex items-center gap-1.5 text-sm text-content-soft transition-colors hover:text-content-primary"
      >
        <ArrowLeft className="size-4" />
        Modules
      </Link>

      {/* Hero. Massive title with brand-gradient accent on a key word,
          kicker eyebrow beneath, soft description, one gradient CTA.
          Mirrors the Lightchain DAO hero treatment. */}
      <header className={`mb-20 ${m.heroImage ? "grid items-center gap-10 lg:grid-cols-[1.1fr_minmax(0,480px)]" : ""}`}>
        <div>
          <h1 className="text-balance text-5xl font-bold tracking-tight text-content-primary sm:text-6xl lg:text-7xl">
            {renderAccentedTitle(m.title, m.titleAccent)}
          </h1>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-content-soft">
            {m.kicker ?? "lightnode-sdk"}
          </p>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-content-primary">
            {subtitle ?? tagline}
          </p>
          {m.cta ? (
            <a
              href={m.cta.href}
              {...(m.cta.href.startsWith("#") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
              className="group mt-10 inline-flex items-center gap-3 rounded-xl px-6 py-3.5 text-sm font-bold uppercase tracking-wider text-white shadow-[0_8px_24px_-6px_rgba(112,100,233,0.55)] transition-all duration-500 active:scale-95"
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
        <div className="rounded-xl border border-bdr-soft bg-card p-5 sm:p-8">
          <Widget id={m.id} />
        </div>
      </section>

      {/* Every steppered module ships its own 'Use it in your project' as
          step 3. Only modules without a Recipe widget still need the
          external block. */}
      {(["bridge", "dao", "chat", "inference", "operator"] as ModuleId[]).includes(m.id)
        ? null
        : m.sandboxBody
          ? <UseInYourProject m={m} />
          : null}

      {/* Add this to your project: the scaffold CTA. Lets the visitor go from
          'I just tried it in the widget' to 'I dropped it into my project' in
          one command. Two cards side by side for the server-pays vs user-pays
          choice when both apply. */}
      {m.scaffolds && m.scaffolds.length > 0 ? (
        <ScaffoldCTA scaffolds={m.scaffolds} moduleTitle={m.title} />
      ) : null}

      {/* Cross-link grid - one row, simple, no decoration. */}
      <section className="mb-4">
        <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-content-soft">More from lightnode-sdk</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.filter((x) => x.id !== m.id).map((other) => (
            <Link
              key={other.id}
              href={`/build/sdks/${other.id}`}
              className="group flex items-start gap-4 rounded-xl border border-bdr-soft bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-bdr-light"
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-base-faint">
                <other.icon className="size-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-content-primary">{other.title}</div>
                <div className="line-clamp-2 text-xs text-content-soft">{other.blurb}</div>
              </div>
              <ArrowRight className="size-4 shrink-0 text-content-soft transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-12 flex flex-wrap items-center justify-between gap-2 text-xs text-content-soft">
        <Link href="/build/sdks" className="inline-flex items-center gap-1.5 transition-colors hover:text-content-primary">
          <ArrowLeft className="size-3" /> Back to all modules
        </Link>
        <Link href="/build" className="inline-flex items-center gap-1.5 transition-colors hover:text-content-primary">
          <Boxes className="size-3" /> Build hub
        </Link>
      </div>
    </div>
  );
}

/**
 * 'Use this in your project' block. Mirrors step 3 of the bridge stepper
 * for every other SDK module so each sub-page ends with: try the live
 * widget, then take the code home. One Open-in-StackBlitz button, one
 * code block, one collapsed terminal-setup pane.
 */
function UseInYourProject({ m }: { m: ModuleDef }) {
  const body = m.sandboxBody ?? m.snippet;
  const needsKey = m.sandboxNeedsKey ?? false;
  // Synthesise the same shell setup the bridge stepper shows. Node script
  // wrapper - the snippet is index.ts, npm install + tsx --env-file
  // optional based on whether the snippet reads PRIVATE_KEY.
  const setup = needsKey
    ? `# 1. Create a folder + install deps
mkdir my-${m.id} && cd my-${m.id}
npm init -y
npm install lightnode-sdk viem tsx

# 2. Save the snippet above as index.ts in this folder.

# 3. Put a funded private key in .env:
echo 'PRIVATE_KEY=0xYOUR_KEY_HERE' > .env

# 4. Run it:
npx tsx --env-file=.env index.ts`
    : `# 1. Create a folder + install deps
mkdir my-${m.id} && cd my-${m.id}
npm init -y
npm install lightnode-sdk viem tsx

# 2. Save the snippet above as index.ts in this folder.

# 3. Run it (read-only - no PRIVATE_KEY needed):
npx tsx index.ts`;
  return (
    <section className="mb-14">
      <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-content-soft">Use this in your project</p>
      <h2 className="mb-5 text-2xl font-semibold tracking-tight text-content-primary">Get the code</h2>

      <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-5 sm:p-6">
        {/* File hint + Open in StackBlitz */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-content-soft">
            Save in your project at <code className="font-mono text-content-default">index.ts</code>
          </span>
          <button
            type="button"
            onClick={() =>
              openSnippetInStackBlitz({
                title: m.title,
                snippet: body,
                needsPrivateKey: needsKey,
              })
            }
            className="group inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold text-white shadow-[0_0_18px_-4px_rgba(112,100,233,0.7)] transition-all duration-300 hover:shadow-[0_0_24px_-2px_rgba(221,0,172,0.55)]"
            style={{ background: "linear-gradient(94deg, #7064E9 0%, #9333ea 60%, #dd00ac 100%)" }}
          >
            <PlayCircle className="size-3.5 transition-transform group-hover:scale-110" />
            Open in StackBlitz
          </button>
        </div>

        {/* The runnable code */}
        <CodeBox code={body} />

        {/* Setup commands behind a collapsed details */}
        <details className="mt-4 rounded-lg border border-bdr-soft bg-card">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-content-soft hover:text-content-primary">
            <Terminal className="size-3" /> Terminal setup commands
          </summary>
          <div className="border-t border-bdr-soft p-3">
            <CodeBox code={setup} />
          </div>
        </details>
      </div>
    </section>
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

/**
 * 'Add this to your project' section. Each scaffold renders as a card with a
 * tone (server = soft blue, browser = brand purple) so the architecture choice
 * is visually obvious. The command is one click to copy. The 'Includes' list
 * makes the trade-off concrete instead of marketing-fluff.
 *
 * One card → centered; two-or-more → 2-column grid on >=sm.
 */
function ScaffoldCTA({ scaffolds, moduleTitle }: { scaffolds: ScaffoldDef[]; moduleTitle: string }) {
  const hasServer = scaffolds.some((s) => s.kind === "server");
  const hasBrowser = scaffolds.some((s) => s.kind === "browser");
  const tagline =
    hasServer && hasBrowser
      ? "Two ways to ship it. Pick whichever fits your app."
      : hasBrowser
        ? "Drop the wallet-signed flow into your project."
        : "Drop the server-side flow into your project.";
  return (
    <section className="mb-16">
      <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-content-soft">Add it to your project</p>
      <h2 className="mb-2 text-2xl font-semibold tracking-tight text-content-primary sm:text-3xl">
        Ship {moduleTitle} in one command
      </h2>
      <p className="mb-6 max-w-2xl text-sm text-content-soft">{tagline}</p>
      <div className={`grid gap-4 ${scaffolds.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {scaffolds.map((s) => (
          <ScaffoldCard key={s.id} scaffold={s} />
        ))}
      </div>
      {hasServer && hasBrowser ? (
        <p className="mt-4 text-[11px] text-content-soft">
          New here? <span className="text-content-default">Server-paid</span> means YOUR funded wallet pays for every
          call (typical SaaS).{" "}
          <span className="text-content-default">User-paid</span> means each visitor signs and pays from their own
          wallet (typical Web3 dApp). Pick whichever matches who&apos;s using the app.
        </p>
      ) : null}
    </section>
  );
}

function ScaffoldCard({ scaffold }: { scaffold: ScaffoldDef }) {
  const [copied, setCopied] = useState(false);
  const isBrowser = scaffold.kind === "browser";
  const Icon = isBrowser ? Globe : Server;
  // Browser variant gets the brand magenta-to-purple gradient on its eyebrow
  // chip; server variant gets a quieter info-blue. Both work in dark + light
  // mode because the chip itself uses translucent backgrounds over bg-card.
  const eyebrowClass = isBrowser
    ? "text-primary"
    : "text-emerald-600 dark:text-emerald-400";
  const ringClass = isBrowser
    ? "ring-primary/20 hover:ring-primary/40"
    : "ring-emerald-500/15 hover:ring-emerald-500/30 dark:ring-emerald-400/15";

  async function copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(scaffold.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // navigator.clipboard unavailable in some contexts; ignore silently.
    }
  }

  return (
    <article
      className={`group flex flex-col gap-4 rounded-2xl border border-bdr-soft bg-card p-5 ring-1 ${ringClass} transition-all sm:p-6`}
    >
      {/* Eyebrow + title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`grid size-9 shrink-0 place-items-center rounded-lg ${
              isBrowser
                ? "bg-primary/10 text-primary"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            }`}
          >
            <Icon className="size-4" />
          </div>
          <div>
            <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${eyebrowClass}`}>
              {isBrowser ? "User pays · browser" : "Dev pays · server"}
            </p>
            <h3 className="text-base font-semibold tracking-tight text-content-primary">{scaffold.title}</h3>
          </div>
        </div>
      </div>

      {/* Blurb */}
      <p className="text-sm leading-relaxed text-content-soft">{scaffold.blurb}</p>

      {/* Optional prerequisite (e.g. web3 scaffolds need a Next.js app). Shown
          above the command so the visitor sees it before copy-pasting. */}
      {scaffold.prereq ? (
        <p className="flex items-start gap-1.5 text-xs text-content-soft">
          <Terminal className="mt-[2px] size-3 shrink-0 opacity-60" />
          <span>{scaffold.prereq}</span>
        </p>
      ) : null}

      {/* Command + copy button. Inline so the visitor can read AND copy. */}
      <div className="flex items-center gap-2 rounded-lg border border-bdr-soft bg-surface-base-faint p-2 pl-3">
        <Terminal className="size-4 shrink-0 text-content-soft" />
        <code className="flex-1 truncate font-mono text-xs text-content-default sm:text-[13px]">
          {scaffold.command}
        </code>
        <button
          type="button"
          onClick={() => void copyCommand()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-bdr-soft bg-card px-2.5 py-1.5 text-[11px] font-medium text-content-default transition-all hover:border-bdr-light hover:text-content-primary"
          aria-label={`Copy ${scaffold.command}`}
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-500 dark:text-emerald-400" />
              <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Includes list */}
      <ul className="space-y-1.5">
        {scaffold.includes.map((line) => (
          <li key={line} className="flex items-start gap-2 text-xs text-content-soft">
            <Check className={`mt-[2px] size-3.5 shrink-0 ${isBrowser ? "text-primary" : "text-emerald-500 dark:text-emerald-400"}`} />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
