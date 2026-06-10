"use client";

import { useAccount, useSwitchChain, useChainId } from "wagmi";
import { getWalletClient } from "@wagmi/core";
import { useAppKit } from "@reown/appkit/react";
import { wagmiConfig } from "@/lib/wagmi";
import { DAO_CHAIN_ID, type DaoChain } from "./dao-chain";

/**
 * Shared wallet wiring for the DAO write controls (delegate, cast vote). Uses
 * `open()` from AppKit for connect rather than the global ConnectButton, which
 * treats Ethereum as "unsupported" and would nag the user back to LightChain.
 *
 * `getSigner` is the load-bearing piece: the app's network toggle drives wagmi's
 * tracked chain (e.g. LightChain 9200) independently of the wallet's real chain,
 * so the reactive `useWalletClient()` can stay bound to the wrong chain and viem
 * then rejects the write ("wallet chain ... does not match target chain ..."). We
 * instead switch to the target chain and fetch a FRESH client bound to it from
 * the connector's actual state.
 */
export function useDaoWallet(chain: DaoChain) {
  const { address, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { open } = useAppKit();
  const chainId = useChainId();
  const targetChainId = DAO_CHAIN_ID[chain];

  const getSigner = async () => {
    // Switching to the chain you're already on is a no-op (no wallet prompt),
    // and it realigns wagmi's tracked chain with the connector before we read it.
    await switchChainAsync({ chainId: targetChainId });
    const signer = await getWalletClient(wagmiConfig, { chainId: targetChainId });
    if (!signer) throw new Error("Could not get a wallet client for this network. Reconnect and try again.");
    return signer;
  };

  return {
    address,
    isConnected,
    open,
    chainId,
    targetChainId,
    onTargetChain: chainId === targetChainId,
    getSigner,
  };
}
