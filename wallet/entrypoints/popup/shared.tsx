/** Shared popup primitives: icons, formatting helpers, tiny display atoms. */
import { CHAIN_LIST } from "../../src/rpc/chains";
import type { Severity } from "../../src/provider/decode-call";

export type Asset = { kind: "native"; symbol: string; balance: string } | { kind: "token"; symbol: string; address: string; decimals: number; balance: string };
export type DaoView = { supported: boolean; votingPower: string; delegated: boolean; voteUrl: string };

/** Stable identity for an asset (symbols are attacker-chosen; addresses are not). */
export const assetKey = (a: Asset): string => (a.kind === "token" ? a.address.toLowerCase() : "native");

export const SEVERITY_CLASS: Record<Severity, string> = { info: "muted", warn: "warn", danger: "danger-box" };
export const SUPPORTED_IDS = CHAIN_LIST.map((c) => c.id);
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
// Bundled token marks; unknown tokens fall back to a monogram chip.
export const tokenLogo = (symbol: string): string | null => (symbol.toUpperCase() === "USDC" ? "/tokens/usdc.png" : null);
export const fmtBal = (s: string) => Number(s).toLocaleString(undefined, { maximumFractionDigits: Number(s) >= 1 ? 4 : 6 });
export const isApproveWindow = () => window.location.hash.includes("approve");
export const isExpanded = () => window.location.hash.includes("expanded");
export const openFullTab = () => void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html#/expanded") });

export function avatarGradient(addr: string): string {
  let h = 0;
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 80% 62%), hsl(${(h + 70) % 360} 80% 55%))`;
}

const ICONS: Record<string, string> = {
  send: "M7 17 17 7M8 7h9v9",
  receive: "M12 4v15M19 12l-7 7-7-7",
  copy: "M9 9h10v10H9zM5 15V5h10",
  chevron: "M6 9l6 6 6-6",
  back: "M15 18l-6-6 6-6",
  lock: "M7 11V8a5 5 0 0110 0v3M5 11h14v9H5z",
  check: "M5 12l5 5L20 7",
  external: "M14 4h6v6M20 4l-9 9M10 5H5v14h14v-5",
  x: "M6 6l12 12M18 6 6 18",
  settings: "M20 7h-9M14 17H5M17 14a3 3 0 100 6 3 3 0 000-6zM7 4a3 3 0 100 6 3 3 0 000-6z",
  plus: "M12 5v14M5 12h14",
  expand: "M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3m13-5v3a2 2 0 01-2 2h-3",
  edit: "M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z",
  image: "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6M8.5 9.5a1 1 0 110-2 1 1 0 010 2z",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  swap: "M16 3l4 4-4 4M20 7H7M8 21l-4-4 4-4M4 17h13",
  gov: "M3 21h18M5 21V10M19 21V10M3 10l9-6 9 6M9 21v-5h6v5",
  server: "M3 5h18v6H3zM3 13h18v6H3zM6.5 8h.01M6.5 16h.01",
};
export function Ic({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

export const timeAgo = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export function Change({ pct }: { pct: number }) {
  // Derive sign from the ROUNDED value so -0.004 never renders a red "-0.00%".
  const rounded = Number(pct.toFixed(2)) + 0;
  if (Math.abs(rounded) < 0.005) return <span className="chg faint">0.00%</span>;
  const up = rounded > 0;
  return <span className={`chg ${up ? "chg-up" : "chg-down"}`}>{up ? "+" : ""}{rounded.toFixed(2)}%</span>;
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="faint">{label}</div>
      <b className={tone}>{value}</b>
    </div>
  );
}
