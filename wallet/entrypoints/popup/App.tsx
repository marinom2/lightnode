import { useCallback, useEffect, useState, type ReactNode } from "react";
import { wallet, type WalletState } from "./wallet-api";
import { isApproveWindow, isExpanded } from "./shared";
import { Onboarding, Unlock } from "./onboarding";
import { WalletHome } from "./home";
import { ApproveView } from "./approve";

export function App() {
  const [state, setState] = useState<WalletState | null>(null);
  const refresh = useCallback(async () => setState(await wallet<WalletState>({ type: "getState" })), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (isApproveWindow()) return <Shell><Brand /><ApproveView /></Shell>;
  if (!state) return <Shell><Brand /><p className="muted">Loading…</p></Shell>;
  if (!state.hasVault) return <Shell><Onboarding onDone={refresh} /></Shell>;
  if (!state.unlocked) return <Shell><Unlock onDone={refresh} /></Shell>;
  return <Shell><WalletHome state={state} onChange={refresh} /></Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  const expanded = isExpanded();
  useEffect(() => {
    if (expanded) document.body.classList.add("expanded-body");
  }, [expanded]);
  return <div className={`wrap${expanded ? " expanded" : ""}`}>{children}</div>;
}

function Brand() {
  return <div className="brand"><img className="brand-mark" src="/lightnode.png" alt="" /> LightNode Wallet</div>;
}
