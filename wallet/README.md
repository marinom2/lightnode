# LightChain Wallet

A **self-custodial** browser wallet for LightChain (EVM L1, chain 9200; testnet 8200). Like Phantom/MetaMask, it is a pure client-side **EOA wallet** - there is **no smart contract**, no relayer, and no server. Your keys are generated and encrypted **on your device and never leave it**. We are not an exchange and never custody funds.

> Status: the self-custody core (create/import, unlock, send LCAI, dapp connect + sign) is functional on testnet. Run an external security audit before holding meaningful mainnet funds - that gate applies to every wallet, ours included. The architecture and keyring were built to a written spec and passed a 15-point adversarial security review (see "Security" below).

## Run it

```bash
cd wallet
npm install
npm run build         # -> .output/chrome-mv3/
npm test              # keyring/vault unit tests (14)
npm run compile       # typecheck
```

Load it in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** → select `wallet/.output/chrome-mv3`. For live development with HMR: `npm run dev`.

## What it does

- **Create / import** a BIP-39 wallet (24 words), encrypted under your password.
- **Unlock / auto-lock**, **send LCAI**, view balance, copy address, open the explorer.
- **Connect to dapps** via EIP-1193 + **EIP-6963** (it appears *alongside* MetaMask, never clobbering `window.ethereum`), with a human approval window for `eth_requestAccounts`, `personal_sign`, and `eth_sendTransaction`.
- **Gas as a feature**: LightChain fees are negligible, so we drop the gwei theatre and show "negligible" instead of a scary number.

The LightChain superpowers that make this wallet worth switching to - one-click **worker staking + monitoring**, **encrypted pay-per-call AI inference**, in-wallet **DAO intelligence**, and the **Ethereum bridge** - are wired through `lightnode-sdk` and land next; the exact SDK surface for each is mapped and ready.

## Architecture

```
entrypoints/
  background.ts   MV3 service worker - the ONLY place plaintext keys exist (volatile memory)
  content.ts      isolated-world relay - holds no keys
  inpage.ts       MAIN-world EIP-1193 provider + EIP-6963 announce
  popup/          React UI (onboarding, unlock, account, send, dapp approval)
src/
  keyring/        mnemonic (BIP-39), hdwallet (BIP-44 m/44'/60'/0'/0/x), vault, keyring
  rpc/            viem LightChain chain defs (pinned RPCs)
  provider/       message protocol + RPC method policy
```

Only the background service worker ever touches plaintext key material; content/inpage are dumb relays, and the popup is UI. The dapp's origin is taken from the message sender, never from the page.

## Security

- **Vault**: the mnemonic is sealed with **AES-256-GCM**, key derived by **scrypt** (N=2¹⁶, r=8, p=1), random 16-byte salt + random 12-byte nonce per encryption. KDF params are recorded for future upgrade. A GCM auth-tag failure *is* the password check. Stored encrypted in `chrome.storage.local`; useless without the password.
- **Session**: while unlocked, the mnemonic lives in the background SW's volatile memory and in `chrome.storage.session` (in-memory, TRUSTED_CONTEXTS only, cleared on browser restart / extension reload). We deliberately do **not** "encrypt the seed with a key stored beside it" - that adds surface for zero gain. Auto-lock via `chrome.alarms`; the wallet boots locked after a browser restart.
- **Signing**: `eth_sendTransaction` signs exactly the transaction the approval window displayed (no field is recomputed between display and signature). `personal_sign` shows the decoded text, or a hard "unreadable data" warning for non-text payloads. Contract interactions are flagged.
- **Networks**: only the two pinned LightChain chains; we never honor a dapp-supplied RPC URL.
- **Keys**: derived via `@scure/bip39` + `@scure/bip32` (audited, 0-dep) and `viem`; raw key bytes are wiped after derivation. No private key is ever logged, persisted in plaintext, or sent anywhere.

Tested against the canonical BIP-44 vector (the standard "abandon…about" mnemonic derives `0x9858…aeda94`), vault round-trip + wrong-password rejection, and chunked base64 over inputs up to 500 KB.

### Known follow-ups before a production mainnet release
Tracked from the security review: decode + warn on dangerous calldata (`approve`/`setApprovalForAll`/`permit`/unlimited allowance) and add tx simulation; full EIP-712 domain display + `eth_signTypedData_v4`; Ledger/hardware support; relock on OS idle; an external audit + bug bounty. None of these affect the self-custody guarantee (keys never leave the device); they harden the dapp-signing surface.

---

Independent, community-built. Not an official LightChain product.
