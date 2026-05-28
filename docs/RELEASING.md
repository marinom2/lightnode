# Releasing the desktop app

The desktop installers are built in CI (`.github/workflows/release.yml`) for
**macOS (universal), Linux, and Windows** and attached to a GitHub Release.

## Cut a release
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
