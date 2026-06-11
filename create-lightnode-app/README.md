# create-lightnode-app

Scaffold a new project with **end-to-end encrypted LightChain AI inference**
in one command. Like `create-next-app`, for LightChain dApps.

```bash
npm create lightnode-app my-app
```

Pick a template, set a private key, you're inference-enabled in ~2 minutes.

First time? Read the [Getting Started guide](../GETTING-STARTED.md). It walks you
through making a wallet, getting free testnet funds, and your first AI call with
no prior experience.

Note: this command creates a new folder (`my-app/`). You must `cd my-app` before
running `npm install` or `npm run dev`. Running them in the parent folder fails
with `npm error Missing script: "dev"`.

Want to add inference to a folder you already have instead of making a new
project? Use `npx lightnode-sdk add inference` (see
[the SDK](https://www.npmjs.com/package/lightnode-sdk)). That writes files into
your current folder and does not create a subfolder.

## Templates

| Template | What you get | Run |
| --- | --- | --- |
| `node` (default) | A 120-line `index.ts` that runs one end-to-end inference and prints the answer + three on-chain tx hashes. | `npm start "your prompt"` |
| `nextjs-api` | A Next.js 15 app with `app/api/inference/route.ts` wired up + a minimal page UI that calls it. | `npm run dev` |
| `hono` | A standalone Hono server exposing `POST /inference`. Deploys to Bun / Railway / Fly / any Node host. | `npm start` |

Not sure which? Pick **`node`** to get to a first inference fastest (just a
script + a key), **`nextjs-api`** if you want a web UI, or **`hono`** for a
standalone API server you can host anywhere Node runs.

## Non-interactive

```bash
npm create lightnode-app my-app -- --template nextjs-api --network testnet
```

Both `--template` and `--network` are validated; unknown values error out.

## What gets installed

The scaffolded `package.json` already includes:

| | Why |
| --- | --- |
| `lightnode-sdk` | The client (`prepareSession`, `submitPrompt`, `decryptResponse`, etc.) |
| `viem` | On-chain signing for `createSession` + `submitJob` |
| `ws` | Relay WebSocket (Node-side) |

Plus framework deps for `nextjs-api` (`next`, `react`, `react-dom`) or `hono`
(`hono`, `@hono/node-server`).

The project is **SDK-ready the moment it scaffolds**: `lightnode-sdk` (pinned to
the current `^0.19.0` line; npm may lag the repo until the next publish), `viem`,
and `ws` are already in `package.json`, so
you just `import { ... } from "lightnode-sdk"` and start building. See the
[SDK README](https://www.npmjs.com/package/lightnode-sdk) for the full API
surface (read client, inference, the `WorkerOperator`, the CLI).

## After scaffolding

```
my-app/
  .env.example       # set PRIVATE_KEY here
  README.md          # template-specific run instructions
  package.json
  ...
```

```bash
cd my-app
cp .env.example .env
# put a funded testnet (or mainnet) private key into .env
npm install
npm start            # or `npm run dev` for the nextjs-api template
```

Testnet inference is **free** - get LCAI at <https://lightfaucet.ai>. Mainnet
inference costs ~0.022 LCAI per call.

## Want to add inference to an existing project?

Use the CLI from the `lightnode-sdk` package instead:

```bash
npx lightnode-sdk add inference --template nextjs-api
```

It detects your stack and patches the right files. (Once `lightnode-sdk` is
installed in the project, bare `npx lightnode <cmd>` works too; standalone,
`npx lightnode` resolves to an unrelated npm package, so use `npx lightnode-sdk`.)

## Where this fits

- **Live playground**: <https://lightnode.app/playground>
- **Builder docs**: <https://lightnode.app/build>
- **SDK reference**: <https://www.npmjs.com/package/lightnode-sdk>
- **Source**: <https://github.com/marinom2/lightnode/tree/main/create-lightnode-app>

## License

MIT.
