import type { Metadata } from "next";

// The dashboard page is a client component (wallet + desktop hooks), so its
// route metadata lives here.
export const metadata: Metadata = {
  title: "Worker dashboard",
  description:
    "Track any LightChain AI worker live: status, stake, earnings, jobs, and health. In the desktop app you can also manage it - settle earnings, withdraw, and update served models.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
