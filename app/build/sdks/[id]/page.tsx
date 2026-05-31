import { notFound } from "next/navigation";
import { MODULES, type ModuleId } from "@/lib/sdk-modules-data";
import { SdkSubpageClient } from "@/components/sdk-subpage-client";

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
  return <SdkSubpageClient id={id as ModuleId} />;
}
