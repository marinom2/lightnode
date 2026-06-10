# LightNode Wallet - Privacy Policy

LightNode Wallet is a **self-custodial** browser extension. It is built so that we never see your money or your data.

## What we collect

**Nothing.** The extension has no backend that we operate, no analytics, and no telemetry. We do not collect, store, or transmit any personal information, wallet addresses, balances, or activity to any server we control.

## Where your data lives

- Your recovery phrase is encrypted on your device (AES-256-GCM with a scrypt-derived key) and stored only in your browser's local extension storage. It never leaves your device. Only your password can decrypt it; we cannot recover it.
- Settings (selected network, added tokens, local activity list) are stored locally in your browser.

## Network requests

To show balances and broadcast transactions, the extension talks **directly** to public blockchain RPC endpoints (e.g. LightChain, Ethereum, Base, Arbitrum, Optimism, Polygon) and, on the LightChain network, the public worker-registry contracts. These requests go from your browser to those public endpoints; they are not routed through any server we run. Public RPC providers may log requests under their own policies.

## Permissions

- `storage` - keep the encrypted vault and your settings on your device.
- `alarms` - auto-lock after inactivity.
- `notifications` - optional request alerts.
- Page access (content script) - inject the standard wallet provider so websites can request to connect; it holds no keys.

## Your control

You can reveal your recovery phrase (password-gated) or remove the wallet from the device at any time in Settings. Removing it deletes the encrypted vault from your browser.

## Contact

This is independent, community-built software (not an official LightChain product). Questions: open an issue at the project repository.
