# Releasing

This repo ships three independently-versioned artifacts:

- **`lightnode-sdk`** (npm) - the SDK + CLI. `0.19.0` in the repo; the npm
  `latest` may lag until the next publish (the npm badge in the root README
  shows what is live).
- **The desktop worker app** (Tauri installers on a GitHub Release, `v*` tags).
  Currently `0.1.x`.
- **The LightNode Wallet extension** (`wallet/`, prebuilt zip on a GitHub
  Release, `wallet-v*` tags).

Their versions are unrelated; release them separately. The site's
`/api/download` resolves each product against its own tag family (desktop `v*`,
wallet `wallet-v*`), so one product's release never hijacks another's download
button.

## Releasing the SDK (npm)

The SDK builds from `sdk/` to `sdk/dist` (gitignored, rebuilt on publish). The
single source of version truth is `sdk/package.json`; keep `SDK_VERSION` in
`sdk/src/index.ts` in lockstep (a unit test guards against drift).

Publishing is automated by **`.github/workflows/publish-sdk.yml`**: pushing a
`sdk-v*` tag re-runs the gate, checks the tag matches `sdk/package.json`, then
`npm publish`es with provenance and opens a GitHub Release. You just bump + tag.

```bash
# 1. Bump the version in BOTH sdk/package.json and the SDK_VERSION constant
#    in sdk/src/index.ts (patch for fixes, minor for features - it's 0.x).
#    A unit test guards that the two stay in lockstep.
# 2. Add a changelog entry (app/build/reference/page.tsx CHANGELOG) + the
#    sdk/README.md notes for the new version. Merge to main.
# 3. Tag main at the new version and push - CI does the rest:
git tag sdk-v0.19.1 && git push origin sdk-v0.19.1
```

The workflow refuses to publish if the tag (`sdk-v0.19.1`) does not match the
package version (`0.19.1`), so a forgotten bump fails loudly instead of shipping
the wrong version. A **prerelease** version (e.g. `0.19.1-beta.0`) is published to
the `beta` dist-tag automatically, so a plain `npm install lightnode-sdk` (which
resolves `latest`) is unaffected. `create-lightnode-app` pins `^0.19.0`, so a new
minor reaches freshly-scaffolded projects automatically; bump that pin
(`create-lightnode-app/src/templates.ts`) on a new MAJOR.

**One-time setup:** add an automation npm token as the `NPM_TOKEN` repo secret
(Settings -> Secrets and variables -> Actions). Until that secret exists and a
tag is pushed, nothing publishes and the npm `latest` stays at the last
published version. **Manual fallback** (if CI is unavailable): verify locally,
then `cd sdk && npm publish` after a
`npx tsc --noEmit && npx vitest run && (cd sdk && npm run build)`.

## Releasing create-lightnode-app

Same pattern, its own tag family and workflow (`publish-cla.yml`, same
`NPM_TOKEN`):

```bash
# 1. Bump create-lightnode-app/package.json "version" (and SDK_VERSION in
#    src/templates.ts when the pinned SDK line moves).
# 2. Tag and push - CI verifies, publishes with provenance, cuts a release:
git tag create-lightnode-app-v0.2.3 && git push origin create-lightnode-app-v0.2.3
```

The workflow refuses to publish when the tag does not match the package
version, and also when the template's pinned `lightnode-sdk` range resolves to
nothing on npm - publish the SDK first, then the scaffolder.

## Releasing the desktop app

The desktop installers are built in CI (`.github/workflows/release.yml`) for
**macOS (universal), Linux, and Windows** and attached to a GitHub Release.

### Cut a release
```bash
# bump desktop/src-tauri/tauri.conf.json "version" + desktop/package.json, then:
git tag v0.1.1
git push origin v0.1.1
```
Or run the **Release Desktop** workflow manually (Actions tab -> Run workflow ->
enter a tag). The job builds all three OSes and publishes the release with:
- macOS: `.dmg` (universal - Intel + Apple Silicon)
- Linux: `.AppImage` + `.deb`
- Windows: `.msi` + NSIS `.exe`

Without signing secrets the installers still work; users just see a one-time OS
warning (macOS: right-click -> Open; Windows: SmartScreen -> More info -> Run).

## Releasing the wallet extension

Two workflows fire on a `wallet-v*` tag (the wallet is self-contained - its own
dependencies, no SDK build step):

- **`.github/workflows/wallet-release.yml`** builds + zips the extension and
  attaches `lightnode-wallet-chrome.zip` to a GitHub Release. The site's
  download button (`/api/download?product=wallet`, linked from
  `lightnode.app/wallet`) always serves the newest `wallet-v*` release.
- **`.github/workflows/wallet-publish.yml`** uploads + publishes the same build
  to the Chrome Web Store. It needs four repo secrets (see `wallet/PUBLISH.md`);
  until they are set, the job skips gracefully and the zip release still ships.

### Cut a wallet release
```bash
# bump wallet/package.json "version", then:
git tag wallet-v0.1.1
git push origin wallet-v0.1.1
```

## Enable code-signing + notarization (no more warnings)
Add these repository secrets (Settings -> Secrets and variables -> Actions), then
add the env block below to the `Build + release` step in
`.github/workflows/release.yml`.

> IMPORTANT: only add this block once the secrets actually exist. Tauri's macOS
> bundler treats a defined-but-empty `APPLE_CERTIFICATE` as "please sign" and then
> fails on `security import` of an empty cert. That is why the default workflow
> does NOT define these vars.

```yaml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

### macOS (Apple Developer Program required)
| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | base64 of your "Developer ID Application" cert `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | an app-specific password (appleid.apple.com) |
| `APPLE_TEAM_ID` | your 10-char Team ID |

`base64 -i cert.p12 | pbcopy` to get `APPLE_CERTIFICATE`.

### Windows (code-signing cert required)
Add a CI step to import your `.pfx`, then set
`bundle.windows.certificateThumbprint` (+ `timestampUrl`) in
`desktop/src-tauri/tauri.conf.json`. EV/OV certs remove the SmartScreen warning.

## Notes
- The app loads the hosted web UI (`lightnode.app`) in its window and
  talks to the native layer over Tauri IPC (allowed for that origin via
  `desktop/src-tauri/capabilities/default.json`). Update that URL + the
  capability if the deployment domain changes.

## macOS code-signing + notarization (Developer ID) - OPTIONAL

Signing is NOT required: the app is fully functional unsigned (the only costs
are the one-time Gatekeeper "right-click -> Open" on first launch, and that
secrets fall back to localStorage instead of the OS Keychain - still
device-local, never networked).

**Whoever publishes a given build signs it with their own Apple Developer ID.**
A code signature simply brands a build as coming from the account that signed it;
it has nothing to do with who owns the project. This project is authored and owned
by KykyRykyPaloma - if you publish the official builds, add your own `APPLE_*`
credentials below and they get signed under your identity. If a build is ever
published by someone else under a different brand, that publisher uses their own
credentials for their own builds; that does not transfer ownership of this project.
The workflow is identity-agnostic: it signs with whatever `APPLE_*` secrets are
present, and stays unsigned until they're added.

To enable, add these repo secrets (Settings -> Secrets and variables ->
Actions). The "Configure macOS signing" step is gated: with no
`APPLE_CERTIFICATE` it stays unsigned, so adding them is the only switch.

- `APPLE_CERTIFICATE` - base64 of your "Developer ID Application" cert exported
  as .p12: `base64 -i cert.p12 | pbcopy` (single line is fine; multi-line ok too).
- `APPLE_CERTIFICATE_PASSWORD` - the .p12 export password.
- `APPLE_SIGNING_IDENTITY` - e.g. `Developer ID Application: <Publisher> (<TEAMID>)`.
- `APPLE_ID` - the publisher's Apple ID email.
- `APPLE_PASSWORD` - an app-specific password (appleid.apple.com -> Sign-In and
  Security -> App-Specific Passwords), NOT the normal password.
- `APPLE_TEAM_ID` - the publisher's 10-char Apple Team ID.

Getting the cert: Apple Developer -> Certificates -> + -> "Developer ID
Application" -> create from a CSR (Keychain Access -> Certificate Assistant ->
Request a Certificate from a CA) -> download -> import to Keychain -> export the
private key + cert together as a .p12.

### Windows / Linux
- Windows: the secret store (Credential Manager) is reliable WITHOUT signing.
  An Authenticode cert (paid OV/EV) only removes the SmartScreen "unknown
  publisher" warning - optional, deferred.
- Linux: the Secret Service (GNOME Keyring / KWallet) is reliable without
  signing where a keyring daemon runs; falls back to localStorage on headless
  boxes. Package signing (deb/AppImage) is about download trust, not secrets.
