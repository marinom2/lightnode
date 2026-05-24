# LightNode

**The friction-free way to join LightChain AI's decentralized worker network.**
Connect a wallet → check your machine → get a tailored setup → watch your rewards.

An independent ecosystem tool (not an official LightChain product). It's a UX layer
over the official [`lightchain-worker-toolkit`](https://github.com/lightchain-protocol/lightchain-worker-toolkit) —
no protocol changes, no consensus work.

## Stack
- Next.js 15 (App Router) · React 19 · Tailwind CSS v4
- Theme ported from `lcai-chat-v2` (dark-first, indigo `#6767e9` + purple→magenta gradient)
- wagmi + viem (injected wallet, LightChain mainnet/testnet chains)
- Live data from the LightChain workers subgraph (proxied via `/api/*`)

## Run
```bash
npm install
npm run dev   # http://localhost:3000
```

## Pages
- `/` — landing: live network stats, the pitch, how-it-works, Worker (now) / Validator (roadmap)
- `/onboard` — 4-step wizard: connect → machine score + reward estimate → tailored per-OS setup → run & verify
- `/dashboard` — live worker status/earnings/health from the subgraph (auto-refresh)

## Scope
Worker onboarding ships first (8GB GPU + 50k LCAI stake). Validator onboarding
(500k LCAI + full node) is intentionally deferred — it's a much heavier, capital-gated path.
