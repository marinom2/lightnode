import type { Metadata } from "next";

// The recover page is a client component (local keystore access), so its
// route metadata lives here.
export const metadata: Metadata = {
  title: "Recover a replaced worker key",
  description:
    "Restore an archived worker key from this device and get back the worker and any stake it still holds. Keys are archived locally when replaced and never leave your machine.",
};

export default function RecoverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
