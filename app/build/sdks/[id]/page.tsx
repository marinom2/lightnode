import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MODULES, type ModuleId, Widget, DocLinks, CodeBox } from "@/components/sdk-modules";

const VALID_IDS: ModuleId[] = ["bridge", "dao", "chat", "preflight", "dispute", "models"];

export function generateStaticParams(): { id: ModuleId }[] {
  return VALID_IDS.map((id) => ({ id }));
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const m = MODULES.find((x) => x.id === id);
  if (!m) return { title: "SDK module - Build with LightChain AI" };
  return {
    title: `${m.title} - Build with LightChain AI`,
    description: m.blurb,
  };
}

export default async function SdkSubpage({ params }: PageProps) {
  const { id } = await params;
  if (!VALID_IDS.includes(id as ModuleId)) notFound();
  const m = MODULES.find((x) => x.id === id);
  if (!m) notFound();

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      {/* Breadcrumb / back link */}
      <Link
        href="/build/sdks"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-content-soft transition-colors hover:text-content-primary"
      >
        <ArrowLeft className="size-4" />
        All SDK modules
      </Link>

      {/* Hero - title, blurb, badge */}
      <header className="mb-10">
        <div className="mb-3 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl border border-bdr-soft bg-surface-base-faint text-primary">
            <m.icon className="size-5" />
          </div>
          <div>
            <h1 className="text-balance text-3xl font-semibold tracking-tight text-content-primary sm:text-4xl">
              {m.title}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone="success">in 0.6.x</Badge>
              <span className="text-[11px] text-content-soft">lightnode-sdk</span>
            </div>
          </div>
        </div>
        <p className="max-w-3xl text-balance text-base leading-relaxed text-content-soft">{m.blurb}</p>
        <DocLinks m={m} />
      </header>

      {/* The widget - given full width + breathing room */}
      <section className="mb-10">
        <div className="rounded-3xl border border-bdr-soft bg-card/40 p-5 sm:p-8">
          <Widget id={m.id} />
        </div>
      </section>

      {/* The exported snippet - one of the things builders actually copy */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-content-primary">
          The exported API at a glance
        </h2>
        <p className="mb-3 max-w-2xl text-xs text-content-soft">
          Short version of what this module exposes. The full integration shapes (Node CLI, server route,
          React component) are wired into the widget above; here is the SDK surface itself.
        </p>
        <CodeBox code={m.snippet} />
      </section>

      {/* Cross-link to the other modules */}
      <section className="mb-4">
        <h2 className="mb-3 text-sm font-semibold text-content-primary">Other modules in lightnode-sdk</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.filter((x) => x.id !== m.id).map((other) => (
            <Link
              key={other.id}
              href={`/build/sdks/${other.id}`}
              className="group flex items-start gap-3 rounded-xl border border-bdr-soft bg-surface-base-faint p-3 transition-colors hover:border-primary/40"
            >
              <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-bdr-soft bg-card text-content-soft transition-colors group-hover:border-primary/40 group-hover:text-primary">
                <other.icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-content-primary">{other.title}</div>
                <div className="line-clamp-2 text-[11px] text-content-soft">{other.blurb}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-2 text-xs text-content-soft">
        <Link href="/build/sdks" className="inline-flex items-center gap-1 transition-colors hover:text-content-primary">
          <ArrowLeft className="size-3" /> Back to all modules
        </Link>
        <Link
          href="/build"
          className="inline-flex items-center gap-1 transition-colors hover:text-content-primary"
        >
          <Boxes className="size-3" /> Build hub
        </Link>
      </div>
    </div>
  );
}
