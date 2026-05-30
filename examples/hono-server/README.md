# Hono server: encrypted LightChain AI inference

A tiny [Hono](https://hono.dev) HTTP server that exposes `/inference` for
on-demand inference. Runs anywhere Hono runs with a Node runtime: Node, Bun,
Railway, Fly.io, anywhere with `node`.

```bash
npm install hono @hono/node-server lightnode-sdk viem ws
npm install -D @types/ws tsx typescript

PRIVATE_KEY=0x... NETWORK=testnet tsx server.ts
# server listening on http://localhost:3000/inference

curl -X POST http://localhost:3000/inference \
  -H 'content-type: application/json' \
  -d '{"prompt":"Reply with a one-sentence fun fact about the deep sea."}'
```

Response:

```json
{
  "answer": "Did you know that the deep sea...",
  "txs": {
    "createSession": "0x...",
    "submitJob":     "0x...",
    "jobCompleted":  "0x..."
  },
  "sessionId": "...",
  "jobId":     "...",
  "worker":    "0x..."
}
```

Identical contract surface to the Next.js variant — same env vars, same JSON
shape, same stalled-worker semantics. Use this when you want a small
standalone microservice rather than coupling inference to a Next.js app.
