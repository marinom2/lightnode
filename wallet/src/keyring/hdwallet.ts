import { HDKey } from "@scure/bip32";

// BIP-44 Ethereum path. LightChain is EVM, so accounts share the 60' coin type.
const ethPath = (index: number): string => `m/44'/60'/0'/0/${index}`;

/** Derive the raw 32-byte private key for account `index` from a BIP-39 seed. */
export function derivePrivateKey(seed: Uint8Array, index: number): Uint8Array {
  if (index < 0 || !Number.isInteger(index)) throw new Error("Account index must be a non-negative integer");
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(ethPath(index));
  if (!child.privateKey) throw new Error("HD derivation produced no private key");
  return child.privateKey;
}
