import type { Metadata } from "next";

// The playground page is a client component (wallet hooks), so its route
// metadata lives here.
export const metadata: Metadata = {
  title: "Encrypted inference playground",
  description:
    "Run a real encrypted inference on LightChain AI from your browser: connect a wallet, sign two transactions, and watch the answer stream back decrypted. Free on testnet with the faucet.",
};

export default function PlaygroundLayout({ children }: { children: React.ReactNode }) {
  return children;
}
