# UI and design

This document covers what LightNode looks like and why: the design language and
where it comes from, the tokens that drive it, and a screen-by-screen walkthrough
of the actual UI (onboarding, picking a model, the dashboard, and every operation
including withdrawing funds).

---

## Design language and provenance

LightNode is built to feel **native to the LightChain AI ecosystem**, so a worker
operator never feels like they left LightChain to use a third-party tool. The
visual language - dark-first surfaces, the indigo accent, and the signature
purple-to-magenta gradient - is adapted to match LightChain's own product look
(its chat/app styling) and its wallet stack.

- **Accent / primary:** indigo `#7064e9` (a touch lighter, `#6767e9`, in light mode).
- **Signature gradient:** `linear-gradient(270deg, #7064e9 0%, #dd00ac 100%)` -
  used on primary buttons, the wordmark, and ambient glows.
- **Wallet:** [Reown AppKit](https://reown.com) (wagmi + viem) - the same wallet
  stack LightChain uses - so connect/network-switch feels identical to the rest of
  the ecosystem and works inside the desktop webview.
- **Typeface:** Inter.
- **Mode:** dark-first, with a subtle radial gradient "mesh" behind every page.

> **Brand note.** The LightChain name, logo, and brand are the property of the
> LightChain project; LightNode only adapts the *visual language* to fit in. The
> hero device renders in `public/images/` are exported assets, and the glow/ray
> effects are hand-built CSS. LightNode's own source is MIT-licensed
> (see [LICENSE](../LICENSE)); the LightChain AI branding is not claimed under it.

### Where the design lives
All design tokens are CSS variables in [`app/globals.css`](../app/globals.css)
(colors, the gradient, the ambient background, focus rings). UI is built from small
primitives in [`components/ui/`](../components/ui/) (buttons, cards, badges, the
icon chip, the radial gauge). **Rule:** components use the tokens, never hardcoded
colors - so a palette change is one place.

---

## Screen-by-screen walkthrough

### Landing (`/`)
Explains what LightNode is, shows live network stats and the models the network
pays for, and points you to the app. On the web the primary call to action is
**Download the app**; inside the desktop app it becomes **Set up your worker** (the
landing adapts to where it runs).

### Onboarding (`/onboard`)
On the web this is a clean download funnel (no manual steps). **In the desktop app**
it's the real one-click flow:

1. **Connect a wallet** - only to read your address and fund the worker. Optional;
   you can also fund by QR or from any wallet.
2. **Check your machine** - auto-detects your CPU / RAM / GPU (unified memory on
   Apple Silicon is handled correctly), scores you against the requirements, and
   shows a reward estimate. A **Speed test** runs a real local inference and draws a
   gauge of your worst-case job time against the on-chain deadline, so you see slash
   risk *before* going live.
3. **Pick the model(s) to serve** - the **model picker** lists the network's *live,
   whitelisted* models (so testnet and mainnet show their own, and the list grows
   automatically as LightChain adds models). It is multi-select: a worker can serve
   several models at once. Each option shows its per-job fee and rough memory need,
   and the picker sums the footprints of your selection and warns when the set won't
   stay resident in your machine's memory (every served model has to be loaded at the
   same time). The app pre-selects the lightest model that fits.
4. **Set the keystore password + fund the worker** - generate (or type) a password
   that encrypts your worker key (masked by default; reveal to back it up), then
   fund the generated worker address by scanning the prefilled QR with a phone
   wallet or clicking "Fund from wallet". The balance updates automatically; install
   begins once it's funded.
5. **Install + run** - one click sets up Docker, Ollama, the keystore, on-chain
   registration with your stake, the keep-online watchdog, model pre-warm, and sleep
   prevention. Then it goes live.

### Dashboard (`/dashboard`)
Look up any worker, or open your own. For a worker it shows:

- **Overview:** registered/active status, local "running on this machine" state,
  and an Earnings card (settled vs. pending-release).
- **Stats:** jobs completed, success rate, stake, last on-chain activity.
- **Supported models** table (model, fee, max output, status) and **Job history**
  (recent jobs with state, reward, and age).
- **Live health** (desktop, for your own worker): real-time telemetry the chain
  can't see - a live "Processing N jobs now / Idle" banner, model warm/cold, Ollama
  status, releases, heartbeat, and uptime, refreshed every few seconds.

### Operations (on the dashboard)
The worker's control surface. On desktop each tile runs natively and streams its
log; on the web it hands you the exact command to copy.

| Tile | What it does |
|---|---|
| **Status** | Local container health + recent log. |
| **Restart** | Recovers a stalled worker, pre-warms the model, re-arms the watchdog + sleep prevention. |
| **Stop** | Pauses the worker (Docker + model stay loaded for a fast restart; lets the machine sleep again). |
| **Tail jobs** | Live-follows the job log. |
| **Speed test** | Benchmarks this machine's inference speed vs. the on-chain deadline. |
| **Settle earnings** | Releases your completed jobs and claims the rewards into the worker wallet. |
| **Deregister** | Settles + claims, exits the network, returns your stake, stops the container. |
| **Free up memory** | Stops the worker, unloads the model, and quits Docker to give the machine its RAM back. |
| **Models this worker serves** | Add/remove served models live: updates the set on-chain (no re-stake), then restarts with it. Same memory gate as setup. |
| **Recover a replaced key** | Lists keys you replaced (archived on-device), flags any still staked on-chain, and restores one as the active worker. |

**Why "Free up memory" exists (and why operators like it):** a worker keeps its
model **pinned in Ollama** (often ~5 GB) so jobs never cold-load, and Docker keeps a
multi-GB VM running. That's great while you're earning, but it means even a *stopped*
worker can sit on ~9 GB of RAM - enough to make a laptop crawl. **Stop** pauses the
worker but deliberately keeps the model + Docker loaded for a fast restart; **Free up
memory** is the "I want my machine back" button that actually releases it all. Your
stake and registration are untouched - Restart brings the worker back. It's the one
thing other worker tools make you hunt through Docker and Ollama to do by hand.

### Withdrawing funds
The **Withdraw Funds** card moves the worker wallet's spendable LCAI (returned stake
after deregister + leftover gas + claimed earnings) to any wallet you choose - it
defaults to your connected wallet but you can enter a different address. It signs
**locally**, two ways picked automatically:

- if the app holds the key for that worker, it signs in the browser with precise gas;
- otherwise it derives the worker key from the on-disk keystore and signs there.

Either way the raw key never leaves your machine. (See
[WORKER_LIFECYCLE.md](WORKER_LIFECYCLE.md) for how earnings move from a completed job
into a withdrawable balance, and [SECURITY.md](../SECURITY.md) for the key model.)

---

## Accessibility
Visible focus rings, `aria-pressed` on toggles, labelled icon buttons, and
`prefers-reduced-motion` is honored (animations like the processing spinner and
gauge fills back off). Color is never the only signal - states also carry text and
icons.
