import type { Metadata } from "next";
import { BuildShell } from "@/components/build/console/build-shell";

// Fallback for BUILD pages that don't export their own metadata; pages that do
// (the hub, reference, ...) override this per-route.
export const metadata: Metadata = {
  title: "Build on LightChain AI",
  description:
    "The lightnode-sdk developer console: runnable panels for encrypted inference, chat, agents, batch, worker operations, bridge, and DAO, plus network reads, reference docs, and scaffolders.",
};

/**
 * The BUILD section renders as a developer console: a persistent left rail of
 * runnable capabilities + reference (BuildShell), with each page's content in
 * the main column. Sits below the global site nav.
 */
export default function BuildLayout({ children }: { children: React.ReactNode }) {
  return <BuildShell>{children}</BuildShell>;
}
