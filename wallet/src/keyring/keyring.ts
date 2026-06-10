/**
 * In-memory unlocked keyring. Holds the seed + derived viem accounts ONLY in the
 * background service worker's volatile memory. Per the security review:
 *   - private keys become viem accounts via `toHex` (NOT Node Buffer, which is
 *     absent in the SW), and we hold the account for the session rather than
 *     re-stringifying the raw key on every signature.
 *   - JS strings are unwipeable, so the in-memory keyring (not per-op churn) is
 *     the real boundary; `wipe()` zeroes the byte arrays we can control.
 */
import { toHex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { mnemonicToSeed } from "./mnemonic";
import { derivePrivateKey } from "./hdwallet";

export interface KeyringAccount {
  index: number;
  address: `0x${string}`;
  account: PrivateKeyAccount;
}

export class Keyring {
  private constructor(
    private seed: Uint8Array,
    readonly accounts: KeyringAccount[],
  ) {}

  /** Build a keyring from a mnemonic, deriving the first `count` accounts. */
  static fromMnemonic(mnemonic: string, count = 1, passphrase = ""): Keyring {
    const seed = mnemonicToSeed(mnemonic, passphrase);
    const accounts: KeyringAccount[] = [];
    for (let i = 0; i < count; i += 1) accounts.push(deriveAccount(seed, i));
    return new Keyring(seed, accounts);
  }

  addAccount(): KeyringAccount {
    const next = deriveAccount(this.seed, this.accounts.length);
    this.accounts.push(next);
    return next;
  }

  accountFor(address: string): KeyringAccount | undefined {
    return this.accounts.find((a) => a.address.toLowerCase() === address.toLowerCase());
  }

  /** Zero the seed bytes we control. (Derived hex strings inside viem are unwipeable.) */
  wipe(): void {
    this.seed.fill(0);
  }
}

function deriveAccount(seed: Uint8Array, index: number): KeyringAccount {
  const pk = derivePrivateKey(seed, index);
  const account = privateKeyToAccount(toHex(pk));
  pk.fill(0); // wipe the raw key bytes; the viem account keeps its own copy
  return { index, address: account.address, account };
}
