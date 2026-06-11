# One-click install: publish LightNode Wallet to the Chrome Web Store

A browser extension can only "click → auto-install in the browser" through a web store. Chrome blocks installing extensions from a website download or a `.crx` file, so the **Chrome Web Store** is the only path to the one-click **Add to Chrome** button (and silent auto-updates).

Everything is automated except the parts that legally require your Google account. Here is exactly what you do, once.

## One-time setup (~15 minutes)

### 1. Create a developer account
- Go to https://chrome.google.com/webstore/devconsole, sign in, pay the one-time **$5** fee, accept the agreement, and (recommended for a wallet) complete publisher verification.

### 2. First upload (creates the item + gives you the Extension ID)
- Build the zip: `cd wallet && npm install && npm run build && npm run zip` (or download it from the latest GitHub Release).
- In the dev console click **New item**, upload `wallet/.output/lightnode-wallet-*-chrome.zip`, fill the listing using `wallet/STORE.md` (copy, category, privacy, the icon at `wallet/public/icon/128.png`, and screenshots), and **Submit for review**.
- Copy the **Item ID** (the long id in the item's URL). That is your `CWS_EXTENSION_ID`.

After Google approves (a few days for a wallet), the listing is live and the **Add to Chrome** button works. Set `STORE_URL` on the `/wallet` page (one line in `app/wallet/page.tsx`) to the listing URL and the site shows "Add to Chrome" instead of the download.

### 3. Get API credentials so CI auto-publishes every future version
You only do this once; afterwards every `wallet-v*` tag auto-uploads + publishes.

1. https://console.cloud.google.com -> create/pick a project.
2. **APIs & Services -> Library** -> enable **Chrome Web Store API**.
3. **APIs & Services -> OAuth consent screen** -> External -> add yourself as a test user.
4. **Credentials -> Create credentials -> OAuth client ID -> Desktop app**. Copy the **Client ID** (`CWS_CLIENT_ID`) and **Client secret** (`CWS_CLIENT_SECRET`).
5. Get a **refresh token** (`CWS_REFRESH_TOKEN`): open this URL (replace CLIENT_ID), approve, copy the `code`:
   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&redirect_uri=urn:ietf:wg:oauth:2.0:oob&client_id=CLIENT_ID
   ```
   then exchange it:
   ```
   curl -s "https://oauth2.googleapis.com/token" \
     -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \
     -d code=THE_CODE -d grant_type=authorization_code \
     -d redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```
   Copy the `refresh_token` from the response.

### 4. Add four GitHub repo secrets
**Settings -> Secrets and variables -> Actions -> New repository secret:**
- `CWS_EXTENSION_ID` (the Item ID from step 2)
- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`

## From then on: one command to ship an update

```
git tag wallet-v0.2.0 && git push origin wallet-v0.2.0
```

The **Wallet release** workflow rebuilds the download zip, and the **Publish wallet to Chrome Web Store** workflow uploads + publishes the new version automatically. Users get the update silently; new users click **Add to Chrome** once. No "Load unpacked", no developer mode.

> Note: Google reviews each version. Listing a wallet for real mainnet funds should follow the external security audit (see the wallet README); reference the audit in the listing once done.
