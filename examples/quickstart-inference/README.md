# lightchain-quickstart-inference

A 120-line, dependency-light starter for **end-to-end encrypted inference** on
LightChain AI using [`lightnode-sdk`](https://www.npmjs.com/package/lightnode-sdk).
Same code path the [live playground](https://lightnode.app/playground) drives —
non-custodial, your wallet signs the on-chain calls, the SDK does the rest.

## Run it (≈30 seconds)

```bash
npm install
cp .env.example .env
# Edit .env: set PRIVATE_KEY to a funded testnet wallet
# (faucet at https://lightfaucet.ai). Testnet inference is free.

npm start "What is the colour of the sky?"
```

Expected output:

```
▶ network=testnet chainId=8200 wallet=0x...
✓ authenticated
✓ prepared. worker=0x... fee=0.02 LCAI
✓ createSession tx=0x...
✓ sessionId=...
✓ relay WebSocket open
✓ submitJob tx=0x...
✓ jobId=...

=== ANSWER ===
The sky appears blue because of how molecules in the atmosphere scatter
shorter (blue) wavelengths of sunlight more than longer ones...

createSession: 0x...
submitJob:     0x...
jobCompleted:  0x...
```

For mainnet:

```bash
NETWORK=mainnet npm start "your prompt"
```

Cost: ~0.022 LCAI per call on mainnet (0.02 worker fee + a tiny bit of gas).
Free on testnet.

## What the example does

| Step | What |
| --- | --- |
| 1 | SIWE handshake against the consumer gateway → JWT |
| 2 | `prepareSession` from the SDK (worker assignment + ECDH-P256 session-key wrap + dispatcher signature) |
| 3 | `createSession` on-chain (signed by your wallet, no LCAI value) |
| 4 | Open the relay WebSocket BEFORE submitting the job |
| 5 | `submitPrompt` from the SDK (AES-GCM-encrypts + uploads to the gateway as a blob) |
| 6 | `submitJob` on-chain, paying the per-call fee in LCAI |
| 7 | Decrypt each relay frame as it streams in with the session key |
| 8 | Wait for the on-chain `JobCompleted` commit (90s cap), then print the answer |

## Files

| File | What |
| --- | --- |
| `index.ts` | The full end-to-end flow. Read top to bottom. |
| `package.json` | Three runtime deps: `lightnode-sdk`, `viem`, `ws`. |
| `tsconfig.json` | Node ESM with `tsx`. |
| `.env.example` | The one secret you need: a funded `PRIVATE_KEY`. |

## Where this fits

- **SDK source + docs**: <https://github.com/marinom2/lightnode/tree/main/sdk>
- **npm package**: <https://www.npmjs.com/package/lightnode-sdk>
- **Live playground (browser, wallet-connect)**: <https://lightnode.app/playground>
- **Builder hub**: <https://lightnode.app/build>
- **Inspect the LightChain contracts in the IDE (Remix fork)**:
  <https://github.com/lightchain-protocol/lcai-ide>

## Stalled-worker handling

A small percentage of workers acknowledge a job and never produce a result. The
example caps the wait at 90 seconds and exits with a non-zero status if the
worker stalled; the protocol times the worker out after the dispute window and
refunds the fee to your wallet automatically. Re-run to be assigned a different
worker.

If you want automatic in-process retry, look at the playground's source for the
pattern: [app/playground/page.tsx](https://github.com/marinom2/lightnode/blob/main/app/playground/page.tsx)
in the main repo (`StalledWorkerError` + the surrounding retry loop).

## License

MIT.
