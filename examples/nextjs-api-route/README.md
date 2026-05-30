# Next.js API route: encrypted LightChain AI inference

Drop-in **App Router** API route that exposes one encrypted inference per
request. POST a prompt, get back the decrypted answer plus the three on-chain
tx hashes. Wallet stays server-side.

## Install

In your existing Next.js app:

```bash
npm install lightnode-sdk viem ws
npm install -D @types/ws
```

Copy [`route.ts`](./route.ts) to `app/api/inference/route.ts`.

Add to `.env.local`:

```
PRIVATE_KEY=0x...   # funded testnet or mainnet wallet
NETWORK=testnet     # or mainnet
MODEL=llama3-8b
```

## Call it from your dApp

```ts
const r = await fetch("/api/inference", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "Reply with a one-sentence fun fact about space." }),
}).then((r) => r.json());

console.log(r.answer);
console.log(r.txs); // { createSession, submitJob, jobCompleted }
```

## What the route does

1. Validates input + reads `PRIVATE_KEY` from env.
2. SIWE handshake against the consumer gateway → JWT.
3. `prepareSession` (worker assignment + ECDH-P256 session-key wrap).
4. Signs `createSession` on-chain with the server-side wallet.
5. Opens the relay WebSocket and listens for chunk/complete frames.
6. AES-GCM-encrypts the prompt and uploads to `/api/blobs`.
7. Signs `submitJob` on-chain, paying the per-call fee.
8. Polls for `JobCompleted` (90s cap), decrypts each frame as it arrives.
9. Returns `{ answer, txs, sessionId, jobId, worker }` as JSON.

## Notes

- **Runtime is Node, not Edge** (`viem` + `ws` need it).
- **maxDuration is 120s** so the route can wait for the worker.
- **Wallet stays on the server** — your prompt and answer pass through the
  function, but the funded private key never reaches the browser.
- **Stalled workers** return HTTP 504 with the partial tx hashes; the
  protocol refunds the fee after the dispute window. Re-run to pick a
  different worker.
- For client-side wallet signing (user pays per call), see the in-browser
  [playground](https://lightnode.app/playground).
