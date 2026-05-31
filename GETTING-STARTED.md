# Getting Started (for first-timers)

Never built a blockchain or Node.js app before? Start here. This guide assumes
no prior experience and explains every term the first time it appears. Once
you've done this once, the [SDK README](sdk/README.md) and
[main README](README.md) will make sense.

## What this is, in plain words

LightChain AI is a network where you send a text prompt to an AI model and get
an answer back, like calling any hosted AI API, except:

- It runs on a blockchain (a shared, decentralized ledger), so no single company
  owns it.
- Your prompt is encrypted end-to-end, so the network sees only scrambled bytes,
  never your text.
- You pay per request from your own wallet instead of a monthly bill.

This repo (`lightnode`) is a community toolkit that makes that easy:
`lightnode-sdk` (a code library plus a `lightnode` command) and
`create-lightnode-app` (a project generator).

## The words you need to know

| Word | What it means here |
|---|---|
| Wallet | A secret number (your "private key") that signs and pays for requests. Its public "address" is where you receive funds. |
| Private key | The secret half of the wallet. Looks like `0x` followed by 64 characters. Anyone who has it controls the wallet, so never share it. |
| Gas | The small fee every blockchain action costs. On LightChain it's paid in LCAI. |
| LCAI | LightChain's coin. Free on testnet, real money on mainnet. |
| Testnet | A free practice copy of the network. Use this while learning. |
| Mainnet | The real network. Costs real LCAI. Don't use it until you're confident. |

While learning, always use testnet. It's free.

## One-time setup (about 5 minutes)

### 1. Install Node.js

You need Node.js 18 or newer. Check what you have:

```bash
node --version
```

If that errors or shows a version below 18, install the latest LTS from
<https://nodejs.org>. `npm` (the package manager) comes bundled with it.

### 2. Make a wallet

```bash
npx lightnode wallet new
```

This prints two things:

```
PRIVATE_KEY=0x... (64 hex characters)        your secret
# address: 0x...                             your public address
```

Copy both somewhere safe. This key is for testnet practice only. Never put real
money on a key you generated and pasted into a terminal.

### 3. Get free testnet funds

Go to <https://lightfaucet.ai>, paste your address (the `0x...` from the
`# address:` line, not the private key), and request LCAI. You get about 2 LCAI
per day, which is plenty for many test calls.

### 4. Check it arrived

```bash
PRIVATE_KEY=0x...your-key... npx lightnode wallet balance --net testnet
```

You should see a balance above 0 LCAI. Setup is done.

## Your first AI call (no project needed)

The fastest possible test is one command, straight from the terminal:

```bash
PRIVATE_KEY=0x...your-key... npx lightnode chat "Write a one-line fun fact about the ocean." --net testnet
```

It signs a request, runs it on testnet, and streams the answer back. If you see
text appear, everything works.

What just happened: the CLI created an on-chain session, submitted your prompt as
a transaction, and decrypted the worker's reply locally. The fees came out of
your free testnet LCAI.

## Two ways to build (don't mix them up)

This is the most common source of confusion for new users, so read it carefully.
There are two separate tools, for two different situations. Pick one.

### Tool A: `create-lightnode-app` (start a brand-new project)

Use this when you have no project yet and want a complete one generated for you
in a new folder.

```bash
npm create lightnode-app my-app
# answer the prompts: choose a template, choose testnet
```

This creates a new folder called `my-app/` with everything inside it. You must
go into it before running anything:

```bash
cd my-app                # the step that's easy to forget
cp .env.example .env     # then paste your PRIVATE_KEY into .env, keep NETWORK=testnet
npm install
npm run dev              # (nextjs template) then open http://localhost:3000
#   or: npm start "your prompt"   (node template)
```

If you see `npm error Missing script: "dev"`, you ran it in the wrong folder. The
commands only work inside `my-app/`. Run `cd my-app` first.

### Tool B: `lightnode add` (bolt onto a project you already have)

Use this when you already have a folder or project and want to drop AI files into
it. These commands write files into your current folder. They do not create a new
one.

```bash
npx lightnode add inference                  # a basic prompt-to-answer file
npx lightnode add nft-mint-with-inference     # generate NFT metadata with AI
```

After it runs, follow its printed steps (install, set up `.env`, then run with
`npx tsx <file>.ts`).

| | Tool A: `create-lightnode-app` | Tool B: `lightnode add` |
|---|---|---|
| When | Starting fresh | Adding to an existing folder |
| Creates a new folder? | Yes (`my-app/`) | No (writes into current folder) |
| You must `cd` after? | Yes | No |
| Run with | `npm run dev` / `npm start` | `npx tsx <file>.ts` |

Running both in the same folder (as the README's NFT example shows) is what
creates a confusing mix of loose files and a sub-project. For learning, use just
one.

## The `.env` file (where your secret lives)

Both tools expect a file named `.env` holding your key. It is git-ignored so it
never gets committed. A typical `.env`:

```
PRIVATE_KEY=0x...your-testnet-key...
NETWORK=testnet
MODEL=llama3-8b
```

You create it by copying the template the tool generated:

```bash
cp .env.example .env
```

Then open `.env` in your editor and paste your real key over the placeholder.
The placeholder `0x000...000` in `.env.example` is fake and will not work. You
must replace it with your real funded key.

## When something breaks

| Message you see | What it means | Fix |
|---|---|---|
| `npm error Missing script: "dev"` | You're in the wrong folder | `cd` into the project folder first |
| `command not found: tsx` | The script runner isn't available | Use `npx tsx <file>.ts` (the `npx` matters) |
| `set PRIVATE_KEY in .env` / `set PRIVATE_KEY=0x...` | No real key configured | Put your key in `.env` (or pass `--key 0x...`) |
| `under 0.05 LCAI - too low` | Wallet has no funds | Fund your address at <https://lightfaucet.ai> |
| `workers stalled` / `worker stalled` | A network worker didn't answer | Run it again (fees are refunded) |
| `auth ... failed` / `502` | Couldn't reach the network | Check your internet and retry |

## Where to go next

- [sdk/README.md](sdk/README.md): every SDK function and CLI command (the full
  reference). Has a 5-line "hello world".
- [create-lightnode-app/README.md](create-lightnode-app/README.md): all the
  project templates.
- Playground (no install, runs in your browser): <https://lightnode.app/playground>
- Builder docs: <https://lightnode.app/build>
- Runnable examples (open in your browser via StackBlitz):
  <https://github.com/marinom2/lightnode-examples>

Start with the first AI call above, then try Tool A to scaffold your first real
project.
