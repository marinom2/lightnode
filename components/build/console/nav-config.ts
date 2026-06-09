import {
  LayoutDashboard,
  Sparkles,
  Gauge,
  MessagesSquare,
  Bot,
  Layers,
  Server,
  Calculator,
  ArrowLeftRight,
  Landmark,
  Activity,
  Coins,
  LayoutGrid,
  BookOpen,
  TerminalSquare,
  Bug,
  type LucideIcon,
} from "lucide-react";

/**
 * Information architecture for the BUILD developer console. The shell renders
 * these sections as a left sidebar; each item is a runnable capability panel or
 * a reference surface. `ready: false` items render dimmed with a "soon" tag so
 * the full vision is visible while panels land in phases (they flip to links as
 * each panel ships).
 */
export interface ConsoleNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Short hint shown under the label on the overview, not in the rail. */
  blurb: string;
  ready?: boolean;
}

export interface ConsoleNavSection {
  title: string;
  items: ConsoleNavItem[];
}

export const CONSOLE_NAV: ConsoleNavSection[] = [
  {
    title: "Start",
    items: [
      { label: "Overview", href: "/build", icon: LayoutDashboard, blurb: "What you can build, and how to start", ready: true },
    ],
  },
  {
    title: "Run a capability",
    items: [
      { label: "Inference", href: "/build/inference", icon: Sparkles, blurb: "One encrypted prompt to a verifiable answer", ready: true },
      { label: "Quote", href: "/build/quote", icon: Gauge, blurb: "Pre-spend cost, worker depth, reliability, refund window", ready: true },
      { label: "Chat", href: "/build/chat", icon: MessagesSquare, blurb: "Multi-turn conversation, one job per turn", ready: true },
      { label: "Agent", href: "/build/agent", icon: Bot, blurb: "ReAct tool-calling loop on any model", ready: true },
      { label: "Batch", href: "/build/batch", icon: Layers, blurb: "Many prompts in parallel, stable order", ready: true },
      { label: "Worker ops", href: "/build/worker", icon: Server, blurb: "Status, settle, stuck-job recovery, exit", ready: true },
      { label: "Earnings", href: "/build/economics", icon: Calculator, blurb: "Project worker earnings + ROI from live economics", ready: true },
      { label: "Bridge", href: "/build/bridge", icon: ArrowLeftRight, blurb: "Quote + move LCAI to/from Ethereum", ready: true },
      { label: "DAO", href: "/build/dao", icon: Landmark, blurb: "Read + vote on LCAI Governor proposals", ready: true },
      { label: "Network", href: "/build/network", icon: Activity, blurb: "Live workers, models, jobs, analytics", ready: true },
      { label: "Revenue", href: "/build/revenue", icon: Coins, blurb: "Protocol fee revenue, run-rate, FeePool flow", ready: true },
      { label: "Models", href: "/build/models", icon: LayoutGrid, blurb: "Supply vs demand + saturation per model", ready: true },
    ],
  },
  {
    title: "Reference",
    items: [
      { label: "SDK reference", href: "/build/reference", icon: BookOpen, blurb: "Every method, network, contract address", ready: true },
      { label: "CLI", href: "/build/cli", icon: TerminalSquare, blurb: "Run lightnode commands, copy scaffolders", ready: true },
      { label: "Errors", href: "/build/errors", icon: Bug, blurb: "Decode any error or on-chain revert into a fix", ready: true },
    ],
  },
];

/** Flat list of the capability items (for the overview grid). */
export const CAPABILITY_ITEMS: ConsoleNavItem[] =
  CONSOLE_NAV.find((s) => s.title === "Run a capability")?.items ?? [];
