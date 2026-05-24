# Contributing to LightNode

Thanks for helping make joining LightChain's AI network easier.

## Setup
```bash
npm install
cp .env.example .env.local   # add your NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
npm run dev                  # http://localhost:3000
```

## Before you open a PR
Everything CI runs, locally:
```bash
npm run lint        # ESLint (next/core-web-vitals)
npm run typecheck   # tsc --noEmit
npm test            # Vitest unit tests
npm run build       # production build
npm run test:e2e    # Playwright smoke tests (builds + serves)
```

## Conventions
- TypeScript, no `any`. Keep functions small and single-purpose.
- Pure logic lives in `lib/` and must have a Vitest test in `tests/unit/`.
- UI uses the design tokens in `app/globals.css` (don't hardcode colors).
- Data is read live from the LightChain subgraph via the `/api/*` routes - never
  call the subgraph directly from a client component (CORS + caching).
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).

## Project layout
- `app/` - routes (landing, onboard wizard, dashboard) + `/api` subgraph proxy
- `components/` - UI (incl. `ui/` primitives)
- `lib/` - network constants, subgraph client, hardware scoring, script generator
- `tests/unit` - Vitest · `tests/e2e` - Playwright
