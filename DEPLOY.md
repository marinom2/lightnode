# Deploying LightNode

LightNode is a standard Next.js 15 app - Vercel auto-detects everything. No
`vercel.json` needed.

## 1. Environment variables
Set these in the Vercel project (Settings → Environment Variables), for
Production + Preview:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | your Reown/WalletConnect project id |
| `NEXT_PUBLIC_SITE_URL` | the production URL (e.g. `https://lightnode.app`) - no trailing slash |

> Without the project id, the WalletConnect QR option is disabled but injected
> wallets (MetaMask, etc.) still work.

## 2. Reown / WalletConnect allowlist
In the [Reown dashboard](https://cloud.reown.com) for that project id, add your
deployment origins to the **allowlist** (otherwise the WC connector 403-spams and
the modal can fail):
- `https://<your-vercel-domain>.vercel.app`
- your custom domain, if any
- `http://localhost:3000` (for local dev)

## 3. Deploy

### Option A - CLI
```bash
npm i -g vercel
cd lightnode
vercel            # first run: links/creates the project, asks for settings
vercel --prod     # promote to production
```
Set the two env vars when prompted (or add them in the dashboard, then redeploy).

### Option B - Git
Push this repo to GitHub and "Import Project" in Vercel. It builds on every push;
`main` → Production, branches → Preview.

## 4. Post-deploy checklist
- [ ] Home, `/onboard`, `/dashboard` all load.
- [ ] Wallet connect modal opens; connecting on a fresh MetaMask auto-prompts to
      **add LightChain** (mainnet/testnet) - no manual network entry.
- [ ] Mainnet/Testnet toggle switches the live stats + dashboard data.
- [ ] `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest` resolve.

## Notes
- All worker/network data is read live from the LightChain subgraph via the
  `/api/*` routes (server-side; no CORS issues, short CDN cache).
- Security headers + `x-powered-by` removal are set in `next.config.ts`.
