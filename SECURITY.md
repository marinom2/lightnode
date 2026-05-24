# Security

## Key handling
LightNode is a **non-custodial** UX layer. It never sees, stores, or transmits
any private key:
- **Worker key** is generated locally by the official toolkit on the operator's
  machine and kept in the toolkit's gitignored `secrets.env` / keystore.
- **Funder key** is entered locally when the toolkit prompts for it - it never
  touches this web app or any LightNode server.
- The browser connects a wallet via WalletConnect/injected only to read the
  address and (optionally) add/switch the LightChain network.

## Data
The app reads public, on-chain-derived data from the LightChain workers subgraph
through server-side `/api/*` routes. No user data is persisted server-side;
"watched workers" and the "remember device" flag live in the browser's local
storage only.

## Reporting a vulnerability
Please open a private security advisory on the repository, or contact the
maintainer directly. Do not file public issues for sensitive reports.

## Scope notes
- This is an independent ecosystem tool, not an official LightChain product.
- It wraps the official `lightchain-worker-toolkit`; review that project for the
  worker runtime's own security model.
