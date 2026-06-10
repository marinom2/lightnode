"use client";

import { useAccount, useWalletClient, useSwitchChain, useChainId } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { DAO_CHAIN_ID, type DaoChain } from "./dao-chain";

/**
 * Shared wallet wiring for the DAO write controls (delegate, cast vote). Uses
 * `open()` from AppKit for connect rather than the global ConnectButton, which
 * treats Ethereum as "unsupported" and would nag the user back to LightChain.
 */
export function useDaoWallet(chain: DaoChain) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const { open } = useAppKit();
  const chainId = useChainId();
  const targetChainId = DAO_CHAIN_ID[chain];

  const ensureChain = async () => {
    if (chainId !== targetChainId) await switchChainAsync({ chainId: targetChainId });
  };

  return {
    address,
    isConnected,
    walletClient,
    open,
    chainId,
    targetChainId,
    onTargetChain: chainId === targetChainId,
    ensureChain,
  };
}
