# LightNode Wallet - Internal Security Review

**What this is, plainly:** an internal, AI-assisted adversarial security review of the
LightNode Wallet, conducted in five passes whose scopes mirror the *methodologies* of
well-known audit firms (key-lifecycle, browser-extension architecture, signing safety,
anti-phishing UX, and protocol/trust-model review). Every high-impact finding was then
independently re-checked by two skeptics against the real code before any fix landed.

**What this is NOT:** this was **not** performed by, commissioned from, or endorsed by
Trail of Bits, Cure53, OpenZeppelin, ConsenSys Diligence, NCC Group, Kudelski, or any
other firm. The firm names below describe the *lens* applied, nothing more. The wallet
has **not** had an external, independent human audit. Until it does, treat it as a
testnet-grade preview and do not hold meaningful mainnet funds in it.

Date: 2026-06-12. Reviewed at commit on `main` after PR #127.

## Method

| Lens (modeled on) | Scope |
| --- | --- |
| Cryptography & key lifecycle (Trail of Bits style) | vault, keyring, scrypt/AES-GCM, randomness, secret-exposure window, session crypto |
| Browser-extension architecture (Cure53 style) | MV3 boundaries, content/inpage/SW trust, CSP, EIP-6963, message-sender validation |
| On-chain signing safety (OpenZeppelin style) | calldata integrity, permit/approval decode, chain-id binding, swap/bridge, recognizer |
| Anti-phishing UX (ConsenSys Diligence style) | per-origin permissions, approval-queue races, scam flagging, address poisoning, NFT SSRF |
| Protocol & trust model (NCC Group / Kudelski style) | encrypted-inference crypto, gateway/relay trust, untrusted-data parsing |

26 findings were raised; the 2 rated high/critical were both confirmed by adversarial
verification (0 refuted). All confirmed findings are fixed below, with regression tests.

## Findings and remediation

### HIGH - Encrypted inference was not truly end-to-end (`unauthenticated-worker-key-mitm`)
The gateway is untrusted, but the wallet wrapped each session key to whatever worker
encryption key the gateway returned, with no on-chain binding. A malicious or compromised
proxy could substitute its own key, decrypt the "E2E" prompt, and forge the streamed
answer (it held the session key it chose).

**Fixed** (`src/rpc/inference.ts`): the wallet now reads the worker's encryption key from
the on-chain `WorkerRegistry.getWorkerEncryptionKey` and requires the gateway's key to
match it byte-for-byte before wrapping the session key (fail closed if absent or
mismatched); it asserts the prepared worker equals the selected worker; and it refuses to
blind-sign the gateway's SIWE challenge unless that challenge names this gateway host and
this account. The "end-to-end encrypted" claim is now backed by an on-chain trust anchor.

### MEDIUM
- **Privileged wallet channel trusted its sender implicitly** (`background.ts`). The
  `kind:"wallet"` message branch (send/swap/bridge/reveal, no per-call approval) did not
  verify the sender. Not remotely exploitable today (no `externally_connectable`, CSP-locked
  pages), but a latent confused-deputy risk. **Fixed:** the branch now requires the
  extension's own id and origin and the absence of a tab; anything else is rejected.
- **Typed-data domain chain was not shown** (`approve.tsx`). A Permit aimed at another chain
  was not obvious. **Fixed:** the signing popup always renders the domain chain as a network
  name and warns when it differs from the wallet's active chain.
- **"No tokens move" banner ignored msg.value** on payable `createSession` (`lightchain-calls.ts`).
  **Fixed:** the banner is value-aware and states the exact amount when value > 0; the
  submitJob/registerWorker labels no longer assert an attacker-chosen value "is the fee/stake".
- **Bridge fee re-read could be inflated by a hostile RPC** (`bridge.ts`). **Fixed:** the
  execution-time fee must stay within 50% of the quoted fee or the transfer aborts.
- **Scam-token heuristic bypassed by a homoglyph** (`spam.ts`). **Fixed:** symbols are
  NFKC-normalized and folded to a Latin skeleton (Cyrillic/Greek/fullwidth) before the
  blue-chip impersonation check.
- **NFT images leaked IP / online status** (`sheets-assets.tsx`, `wxt.config.ts`). **Fixed:**
  an `img-src 'self' data: https:` CSP, and spam-flagged NFTs no longer auto-load their
  remote image (a click opts in). The residual IP leak on opted-in remote images is inherent
  to a no-server wallet and is documented.
- **Address-poisoning check skipped dapp transactions** (`approve.tsx`). **Fixed:** the same
  recipient-risk assessment used for wallet sends now runs on dapp `eth_sendTransaction`
  recipients.
- **SIWE auth signed whatever the gateway returned** (`inference.ts`). **Fixed** as part of
  the HIGH remediation (domain/account validation before signing).

### LOW
- Session keyring not zeroed before re-unlock/re-import (`background.ts`): added a `setLive`
  helper that wipes the previous seed first.
- Stack-overflow-prone base64 on large prompts (`inference.ts`): switched to the chunked,
  stack-safe encoder.
- `use_dynamic_url` missing despite the comment (`wxt.config.ts`): flag added.
- Permit2 "unlimited" matched only the exact max (`typed-data.ts`): now flags at a high floor.
- SIWE detection was bypassable by whitespace/reorder (`typed-data.ts`): made robust.
- Non-https dapp origins could connect (`background.ts`): now rejected (https + localhost only),
  which also removes the http/https grant-key ambiguity.
- Token USD price defaulted to a fake 0 (`background.ts`): unpriced is now absent, not zero.
- `setActiveAccount` index unbounded (`background.ts`): now validated.
- Auto-lock not re-armed on a secret reveal (`background.ts`): reveals now bump the timer.

### INFO (documented, no code change)
- scrypt N = 2^16 is deliberate (raising to 2^17 risks OOM on low-RAM/MV3 service workers);
  the per-blob KDF versioning supports a future bump with lazy re-encrypt. Rationale is now
  documented in `vault.ts`.
- Revealed private-key/mnemonic strings are unwipeable JS strings (inherent); the popup
  clears them from state promptly.

## Controls verified correct (not exhaustive)
- Vault: AES-256-GCM with a fresh random salt + nonce per encryption; scryptAsync;
  auth-tag failure is the password check; params stored per blob.
- Keys never leave the device and never touch the network; plaintext keys live only in the
  background service worker's volatile memory.
- Dapp signing is gated per-origin through a single approval window; calldata is preserved
  through to signing; account switches never over-grant; the inpage provider never clobbers
  an existing `window.ethereum`.

## Status
All confirmed findings from this review are remediated with regression tests
(155 wallet tests pass). This internal review **does not replace** an external,
independent audit, which remains the gate before holding meaningful mainnet funds.
