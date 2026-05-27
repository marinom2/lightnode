# Security

LightNode is **non-custodial**: no private key is ever sent to, or stored on, any
LightNode server. Everything that touches a key happens locally on the operator's
machine. This document describes exactly where keys live and how they are used.

## Key handling

### Worker key
The worker key is the on-chain identity that stakes, earns, and gets paid. The
desktop app generates it locally and uses it to sign worker transactions on your
machine - it is never transmitted off-device.

- **Generation.** On desktop the key is generated natively in the Rust layer; only
  the public address is returned to the UI. (On web, the toolkit generates it during
  the copied setup.)
- **At rest.** It is held in two places, both local: the OS keychain (Keychain /
  Credential Manager / Secret Service) and the toolkit's encrypted keystore on disk
  (`~/lightchain-worker/keys`). On unsigned desktop builds the OS keychain is not
  reliable across launches, so a localStorage copy is also kept as a fallback. The
  authoritative copy for signing is the on-disk keystore.
- **In use.** Worker actions (settle, deregister, withdraw) are signed locally. The
  signing key is preferentially derived from the on-disk keystore using the
  container's keystore password, and the derived address is verified against the
  targeted worker before any transaction is sent. This prevents signing one
  network's action with another network's key.
- **Per-network isolation.** Secrets are stored strictly per network; a key or
  password for one network is never returned for another.

### Funding wallet
The wallet you connect (via Reown AppKit / WalletConnect / injected) is used only to
read your address and to send LCAI to the worker address. It never signs worker
operations, and its private key never touches LightNode.

## Data

The app reads only public, on-chain-derived data from the LightChain workers
subgraph, through server-side `/api/*` routes (so there is no client CORS exposure
and responses can be briefly CDN-cached). No user data is persisted on any server.
Watchlists and UI preferences live in the browser's local storage only.

## Transport and headers

The web app sets standard security headers (`X-Frame-Options`, `nosniff`,
`Referrer-Policy`, `Permissions-Policy`, HSTS) and removes `x-powered-by`. All
subgraph access is server-side with a timeout and graceful degradation.

## Reporting a vulnerability

Please open a private security advisory on the repository, or contact the maintainer
directly. Do not file public issues for sensitive reports. We will acknowledge,
investigate, and coordinate a fix and disclosure.

## Scope notes

- LightNode is an independent ecosystem tool, not an official LightChain product.
- It wraps the official
  [`lightchain-worker-toolkit`](https://github.com/lightchain-protocol/lightchain-worker-toolkit)
  and the worker's Docker image; review that project for the worker runtime's own
  security model.
- The desktop app loads the hosted web UI and grants a minimal, explicitly declared
  set of native commands (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)); it does
  not grant arbitrary shell or filesystem access to the page beyond those commands.
