import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: "LightNode — Run a LightChain AI worker in one flow",
  description:
    "Connect a wallet, check your machine, get a tailored setup, and watch your rewards. The friction-free way to join LightChain's decentralized AI network.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>
          <Nav />
          <main>{children}</main>
          <footer className="mt-24 border-t border-bdr-soft">
            <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-content-soft md:flex-row">
              <p>
                LightNode — an independent ecosystem tool for LightChain AI. Not an official LightChain product.
              </p>
              <p>Built builder-to-builder · wraps the open lightchain-worker-toolkit</p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
