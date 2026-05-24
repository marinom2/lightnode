"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { NetworkId } from "./network";
import { DEFAULT_NETWORK } from "./network";

interface NetworkCtx {
  network: NetworkId;
  setNetwork: (n: NetworkId) => void;
}

const Ctx = createContext<NetworkCtx>({ network: DEFAULT_NETWORK, setNetwork: () => {} });

const STORAGE_KEY = "lightnode.network";

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetworkState] = useState<NetworkId>(DEFAULT_NETWORK);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as NetworkId | null;
      if (saved === "mainnet" || saved === "testnet") setNetworkState(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const setNetwork = (n: NetworkId) => {
    setNetworkState(n);
    try {
      window.localStorage.setItem(STORAGE_KEY, n);
    } catch {
      /* ignore */
    }
  };

  return <Ctx.Provider value={{ network, setNetwork }}>{children}</Ctx.Provider>;
}

export function useNetwork() {
  return useContext(Ctx);
}
