import type { Metadata } from "next";

// The network page is a client component (live polling), so its route
// metadata lives here.
export const metadata: Metadata = {
  title: "Live network stats",
  description:
    "Live overview of the LightChain AI worker network: top workers by jobs and earnings, real-time job activity, model demand, reliability leaderboards, and per-model analytics.",
};

export default function NetworkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
