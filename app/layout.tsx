import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Github } from "lucide-react";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lightnode.app";
const TITLE = "LightNode - Run a LightChain AI worker in one flow";
const DESCRIPTION =
  "Connect a wallet, check your machine, get a tailored setup, and watch your rewards. The friction-free way to join LightChain's decentralized AI network and earn $LCAI.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s | LightNode" },
  description: DESCRIPTION,
  applicationName: "LightNode",
  keywords: ["LightChain", "LCAI", "AI worker", "decentralized AI", "Ollama", "node operator", "staking"],
  authors: [{ name: "LightNode" }],
  openGraph: {
    type: "website",
    siteName: "LightNode",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: "#070710",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script
          // Apply the stored theme before paint (default dark) - avoids a flash.
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('lightnode.theme');if(t!=='light'){document.documentElement.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>
          <Nav />
          <main>{children}</main>
          <footer className="mt-24 border-t border-bdr-soft">
            <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-content-soft md:flex-row">
              <p>
                LightNode - an independent ecosystem tool for LightChain AI. Not an official LightChain product.
              </p>
              <div className="flex items-center gap-4">
                <span>Built builder-to-builder for LightChain worker operators</span>
                <a
                  href="https://github.com/marinom2/lightnode"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-content-primary"
                  aria-label="LightNode on GitHub"
                >
                  <Github className="size-4" /> GitHub
                </a>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
