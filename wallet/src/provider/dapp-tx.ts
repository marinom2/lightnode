/**
 * Canonicalize a dapp-supplied eth_sendTransaction payload before signing.
 * The signed tx must carry EXACTLY what the approval popup displayed, calldata
 * included (regression: dropping `data` turns every dapp contract call into an
 * empty transfer).
 */
export interface DappTxRequest {
  from: string;
  to?: string;
  value?: string;
  data?: string;
}

export interface CanonicalDappTx {
  to: `0x${string}`;
  value: bigint;
  data?: `0x${string}`;
}

export function canonicalizeDappTx(tx: DappTxRequest): CanonicalDappTx {
  if (!tx.to || !/^0x[0-9a-fA-F]{40}$/.test(tx.to)) {
    throw new Error("This transaction has no valid recipient (contract creation is not supported).");
  }
  let value = 0n;
  if (tx.value != null && tx.value !== "") {
    try {
      value = BigInt(tx.value);
    } catch {
      throw new Error("This transaction carries an invalid value.");
    }
    if (value < 0n) throw new Error("This transaction carries an invalid value.");
  }
  const data = typeof tx.data === "string" && /^0x[0-9a-fA-F]*$/.test(tx.data) && tx.data.length > 2 ? (tx.data as `0x${string}`) : undefined;
  return { to: tx.to as `0x${string}`, value, data };
}
