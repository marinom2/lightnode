import type { Metadata } from "next";

// The guide page is a client component (openExternal), so its route metadata
// lives here.
export const metadata: Metadata = {
  title: "How the worker app works",
  description:
    "What the desktop app does under the hood when you run a LightChain AI worker: the lifecycle, where stake and earnings live, how slashing is avoided, serving multiple models, and key recovery.",
};

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return children;
}
