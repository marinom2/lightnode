import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

/** New 24-word (256-bit) mnemonic - the safer default for a wallet that may hold value. */
export function createMnemonic(): string {
  return generateMnemonic(wordlist, 256);
}

export function isValidMnemonic(phrase: string): boolean {
  return validateMnemonic(phrase.trim(), wordlist);
}

/**
 * BIP-39 seed. The optional passphrase ("25th word") is NEVER persisted; if a user
 * sets one it must be supplied at every unlock. Returns the raw 64-byte seed.
 */
export function mnemonicToSeed(phrase: string, passphrase = ""): Uint8Array {
  return mnemonicToSeedSync(phrase.trim(), passphrase);
}
