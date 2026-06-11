# LightNode Wallet

A **self-custodial** browser wallet for LightChain (EVM L1, chain 9200; testnet 8200), with pinned support for Ethereum, Base, Arbitrum, Optimism, and Polygon. It is a pure client-side **EOA wallet** - there is **no smart contract**, no relayer, and no server. Your keys are generated and encrypted **on your device and never leave it**. We are not an exchange and never custody funds.

> Status: the self-custody core (create/import, unlock, send, dapp connect + sign) and the LightChain extras (encrypted AI chat, DAO voting, worker hub, swap, bridge) are functional. Run an external security audit before holding meaningful mainnet funds - that gate applies to every wallet, ours included. The architecture and keyring were built to a written spec and passed a 15-point adversarial security review (see "Security" below).

## Download

- **Prebuilt zip**: <https://lightnode.app/wallet> - the download button serves
  `lightnode-wallet-chrome.zip` from the newest `wallet-v*` GitHub release.
  Unzip it, then `chrome://extensions` → Developer mode → **Load unpacked**.
- **Chrome Web Store**: listing in preparation (one-click install and silent
  auto-updates once live).

## Run it

```bash
cd wallet
npm install
npm run build         # -> .output/chrome-mv3/
npm test              # unit tests (125 across 16 files: keyring, vault,
                      #   provider/typed-data, rpc inference/swap/governance/
                      #   history/spam and more)
npm run compile       # typecheck
```

Load it in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** → select `wallet/.output/chrome-mv3`. For live development with HMR: `npm run dev`.

## What it does

- **Create / import** a BIP-39 wallet (24 words), encrypted under your password.
- **Unlock / auto-lock**, **send**, view balances, copy address, open the explorer - across LightChain (mainnet + testnet) and the pinned Ethereum/Base/Arbitrum/Optimism/Polygon RPCs.
- **Encrypted AI chat** (`entrypoints/popup/sheets-chat.tsx` + `src/rpc/inference.ts`): pay-per-call inference against the LightChain gateway with ECDH + AES-256-GCM session encryption and **one consent per session**, not per message.
- **DAO** (`entrypoints/popup/sheets-dao.tsx` + `src/rpc/governance.ts`): reads proposals and live tallies from **both** LCAI governors (Ethereum and LightChain) and casts votes in-wallet.
- **Worker hub**: your worker's status and lifetime stats, plus the network-wide picture and fee split.
- **Swap** (Uniswap V3 on Ethereum: QuoterV2 quotes, SwapRouter02 execution) and **bridge** (LightChain ↔ Ethereum).
- **Scam protection**: token/NFT spam heuristics quarantine flagged assets (never auto-trusted), dangerous calldata is decoded and warned about (`approve` / `setApprovalForAll` / `permit` / unlimited allowances), and an `eth_simulateV1` balance-change preview shows what you send and receive before you sign.
- **NFTs**: a gallery, plus set any owned NFT as your account avatar.
- **Connect to dapps** via EIP-1193 + **EIP-6963** (it appears *alongside* MetaMask, never clobbering `window.ethereum`), with a human approval window for `eth_requestAccounts`, `personal_sign`, `eth_signTypedData_v4`, and `eth_sendTransaction`. Approving a **SIWE** sign-in auto-follows the dapp's stated chain - only for supported chains, and only when the SIWE domain matches the requesting origin.
- **Gas as a feature**: LightChain fees are negligible, so we drop the gwei theatre and show "negligible" instead of a scary number.

The LightChain superpowers that make this wallet worth switching to - encrypted pay-per-call **AI inference**, in-wallet **DAO voting**, the **worker hub**, and the **Ethereum bridge** - shipped in-wallet and self-contained: the wallet has no dependency on `lightnode-sdk` (see `entrypoints/popup/sheets-*.tsx` and `src/rpc/`).

## Architecture

```
entrypoints/
  background.ts   MV3 service worker - the ONLY place plaintext keys exist (volatile memory)
  content.ts      isolated-world relay - holds no keys
  inpage.ts       MAIN-world EIP-1193 provider + EIP-6963 announce
  popup/          React UI (onboarding, unlock, home, send, dapp approval, and the
                  sheets: assets, chat, DAO, swap, worker, settings)
src/
  keyring/        mnemonic (BIP-39), hdwallet (BIP-44 m/44'/60'/0'/0/x), vault, keyring
  rpc/            viem chain defs (pinned RPCs: LightChain + the EVM majors), plus
                  inference, governance, swap, bridge, tokens/NFTs, spam + risk
                  heuristics, simulation, history, gas, prices
  provider/       message protocol + RPC method policy + typed-data and calldata decoding
```

Only the background service worker ever touches plaintext key material; content/inpage are dumb relays, and the popup is UI. The dapp's origin is taken from the message sender, never from the page.

## Security

- **Vault**: the mnemonic is sealed with **AES-256-GCM**, key derived by **scrypt** (N=2¹⁶, r=8, p=1), random 16-byte salt + random 12-byte nonce per encryption. KDF params are recorded for future upgrade. A GCM auth-tag failure *is* the password check. Stored encrypted in `chrome.storage.local`; useless without the password.
- **Session**: while unlocked, the mnemonic lives in the background SW's volatile memory and in `chrome.storage.session` (in-memory, TRUSTED_CONTEXTS only, cleared on browser restart / extension reload). We deliberately do **not** "encrypt the seed with a key stored beside it" - that adds surface for zero gain. Auto-lock via `chrome.alarms`; the wallet boots locked after a browser restart.
- **Signing**: `eth_sendTransaction` signs exactly the transaction the approval window displayed (no field is recomputed between display and signature). `personal_sign` shows the decoded text, or a hard "unreadable data" warning for non-text payloads. Contract interactions are flagged.
- **Networks**: a fixed allowlist of chains (LightChain mainnet/testnet + Ethereum, Base, Arbitrum, Optimism, Polygon), each with a code-pinned RPC; we never honor a dapp-supplied RPC URL.
- **Keys**: derived via `@scure/bip39` + `@scure/bip32` (audited, 0-dep) and `viem`; raw key bytes are wiped after derivation. No private key is ever logged, persisted in plaintext, or sent anywhere.

Tested against the canonical BIP-44 vector (the standard "abandon…about" mnemonic derives `0x9858…aeda94`), vault round-trip + wrong-password rejection, and chunked base64 over inputs up to 500 KB - plus suites over typed-data, calldata decoding, spam/risk heuristics, simulation, swap, governance, and history (125 tests across 16 files).

### Known follow-ups before a production mainnet release
From the security review, now shipped: dangerous-calldata decode + warnings (`approve`/`setApprovalForAll`/`permit`/unlimited allowance), the `eth_simulateV1` balance-change preview, and `eth_signTypedData_v4` with full EIP-712 domain display. Still open: Ledger/hardware support, relock on OS idle, and an external audit + bug bounty. None of these affect the self-custody guarantee (keys never leave the device); they harden the dapp-signing surface.

---

Independent, community-built. Not an official LightChain product.
