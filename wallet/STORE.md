# Publishing Lightchain AI Wallet to the Chrome Web Store

This is everything needed to get the wallet listed so users can install it with one click ("Add to Chrome"). Only you can do the actual submission (it needs your Chrome Web Store developer account); this file is the ready-to-paste package.

## 1. Build the upload zip

```
cd wallet
npm install
npm run build
npm run zip     # produces wallet/.output/lightnode-wallet-<version>-chrome.zip
```

Upload that zip in the dashboard. (The same zip is attached to each GitHub Release by `.github/workflows/wallet-release.yml`.)

## 2. Developer account

- Go to https://chrome.google.com/webstore/devconsole, sign in, pay the one-time **$5** registration fee, and verify your identity.
- For a wallet, also complete the **publisher verification** (a verified publisher builds trust and reduces impersonation risk).

## 3. Store listing (copy-paste)

- **Name:** Lightchain AI Wallet
- **Summary (≤132 chars):** Self-custodial wallet for Lightchain AI. Hold LCAI, vote in governance with reminders, run a worker, use AI. Keys stay on device.
- **Category:** Productivity (or Developer Tools)
- **Language:** English

**Description:**

```
Lightchain AI Wallet is the self-custodial browser wallet for Lightchain AI and every EVM chain.

Your keys are generated and encrypted on your device with AES-256-GCM and a scrypt-derived key. They never leave it - no server, no custody, no smart contract. Only your password can unlock the vault.

What's inside:
- Multi-chain: Lightchain AI, Ethereum, Base, Arbitrum, Optimism, and Polygon, with code-pinned RPCs.
- Live LCAI market: real price, 24h change, and volume from the BitMart LCAI/USDT market.
- Governance built in: read Lightchain AI proposals and vote For/Against/Abstain in the wallet, with a reminder and toolbar badge when a proposal is open and you have not voted.
- Send and receive the native coin and ERC-20 tokens; add any token by address; QR receive.
- Multiple accounts from one recovery phrase, with a one-tap account switcher.
- Connect to dapps (EIP-1193 + EIP-6963) with human-readable approvals: dangerous-calldata warnings (unlimited approvals, setApprovalForAll) and EIP-712 typed-data display.
- Worker hub: see your worker's stake, headroom, and claimable rewards, and withdraw in the wallet.
- Auto-locks on inactivity and after a browser restart. Reveal your recovery phrase any time (password-gated).

Self-custodial: your keys never leave your device.
```

## 4. Privacy (required for wallets)

In **Privacy practices**, declare honestly:

- **Single purpose:** "A self-custodial crypto wallet to hold assets and connect to web3 sites."
- **Permission justifications:**
  - `storage` - store the password-encrypted vault and settings locally.
  - `alarms` - auto-lock the wallet after inactivity.
  - `notifications` - (optional) alert on request activity.
  - host access via the content script - inject the EIP-1193 provider so sites can request a connection.
- **Data usage:** Check **does NOT collect or transmit** user data. The wallet is non-custodial and sends nothing to any server we run; on-chain reads/writes go directly to public RPCs. No analytics, no tracking.
- **Privacy policy URL:** host `PRIVACY.md` (below) at a public URL, e.g. `https://<your-site>/wallet/privacy`, and paste that link.

## 5. Graphics to upload

Everything is pre-made in `wallet/store-assets/` - upload as-is:

- **Store icon:** 128×128 PNG - use `wallet/public/icon/128.png`.
- **Screenshots (1280×800, upload in this order):**
  1. `store-assets/01-home.png` - home on LightChain (balance hero, actions, tokens, worker).
  2. `store-assets/02-networks.png` - the network switcher open (multi-chain with official logos).
  3. `store-assets/03-send.png` - the Send sheet with fee preview and recipient check.
  4. `store-assets/04-approve.png` - a dapp approval with the decoded-calldata danger warning.
  5. `store-assets/05-ecosystem.png` - worker, governance, and the bridge on LightChain.
- **Small promo tile:** `store-assets/promo-tile-440x280.png`.

(If you ever want fresh captures instead: load `wallet/.output/chrome-mv3` unpacked, open the popup, use the expand icon for a full-tab view, and screenshot at 1280×800.)

## 6. Submit

Upload the zip, fill the listing + privacy, attach graphics, and submit for review. Wallet reviews can take a few days. Before listing real mainnet funds, get an external security audit (the keyring/signing path) - it's the standard bar for a wallet, and it's worth referencing the audit in the listing once done.
