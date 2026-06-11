## What

<!-- What changes and why. Link the issue if one exists. -->

## How it was verified

<!-- Tests run, manual checks, screenshots for UI changes. -->

## Checklist

- [ ] `npm run typecheck` and `npm test` pass (root); `npm --prefix sdk run build` if the SDK changed; `cd wallet && npm test` if the wallet changed
- [ ] Docs updated where behavior changed (README / sdk/README / wallet/README / site copy)
- [ ] No secrets, keys, or .env files in the diff
- [ ] Conventional commit title (`feat:`, `fix:`, `docs:`, ...)
