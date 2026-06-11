import type { Metadata } from "next";

// The onboard page is a client component (wallet + desktop hooks), so its
// route metadata lives here.
export const metadata: Metadata = {
  title: "Run a LightChain AI worker",
  description:
    "Set up a LightChain AI worker in one flow: connect a wallet, check your machine, and install with one click. The desktop app generates keys, funds and stakes, and brings your node online to earn LCAI.",
};

export default function OnboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
