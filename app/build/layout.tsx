import { BuildShell } from "@/components/build/console/build-shell";

/**
 * The BUILD section renders as a developer console: a persistent left rail of
 * runnable capabilities + reference (BuildShell), with each page's content in
 * the main column. Sits below the global site nav.
 */
export default function BuildLayout({ children }: { children: React.ReactNode }) {
  return <BuildShell>{children}</BuildShell>;
}
