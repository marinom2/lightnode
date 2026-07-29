import { test, expect } from "@playwright/test";

// Smoke tests assert static, network-independent content so they stay reliable
// even if the live subgraph is slow/unreachable in CI.

test("landing renders the dual-track hero and CTAs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Build with, and run for/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Builder hub/i }).first()).toBeVisible(); // build track CTA
  // Both CTAs are <Button asChild><Link>…</Link></Button>. asChild swaps the
  // <button> for a Radix Slot that renders the child, so the DOM node is an <a>
  // and the accessible role is "link", not "button" - assert what ships, not
  // the component name that wraps it.
  await expect(page.getByRole("link", { name: /Get the app/i })).toBeVisible(); // worker track CTA
});

test("nav: connect button + network toggle present", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Connect wallet/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Mainnet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Testnet" })).toBeVisible();
});

test("footer links to the public GitHub repo", async ({ page }) => {
  await page.goto("/");
  const gh = page.getByRole("link", { name: /LightNode on GitHub/i });
  await expect(gh).toBeVisible();
  await expect(gh).toHaveAttribute("href", /github\.com\/marinom2\/lightnode/);
});

test("onboard (web) shows the download path + machine-check entry", async ({ page }) => {
  await page.goto("/onboard");
  await expect(page.getByRole("heading", { name: /Run a worker in one click/i })).toBeVisible();
  await expect(page.getByText(/Will my machine qualify/i)).toBeVisible();
});

test("machine check expands and renders detected specs", async ({ page }) => {
  await page.goto("/onboard");
  await page.getByText(/Will my machine qualify/i).click();
  // Whether it auto-detected or fell back to the edit form, the OS field is present.
  await expect(page.getByText("Operating system").first()).toBeVisible();
});

test("dashboard shows lookup + validates a bad address", async ({ page }) => {
  await page.goto("/dashboard");
  const input = page.getByPlaceholder(/worker address/i);
  await expect(input).toBeVisible();
  await input.fill("not-an-address");
  await page.getByRole("button", { name: /Look up/i }).click();
  await expect(page.getByText(/valid 0x worker address/i)).toBeVisible();
});

test("unknown route renders the 404 page", async ({ page }) => {
  const res = await page.goto("/this-route-does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /Page not found/i })).toBeVisible();
});

test("network page renders leaderboard + per-model analytics", async ({ page }) => {
  await page.goto("/network");
  await expect(page.getByRole("heading", { name: "Network", exact: true })).toBeVisible();
  await expect(page.getByText("Top workers")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Model performance/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /CSV/i })).toBeVisible();
});

test("build console renders overview, install, and capability nav", async ({ page }) => {
  await page.goto("/build");
  await expect(page.getByRole("heading", { name: /Build on LightChain AI/i })).toBeVisible();
  await expect(page.getByText("npm install lightnode-sdk viem")).toBeVisible();
  await expect(page.getByText("npm create lightnode-app my-app")).toBeVisible(); // scaffolder
  await expect(page.getByRole("link", { name: /Playground/i }).first()).toBeVisible();
  // The console rail + capability grid route into the live panels.
  await expect(page.getByRole("link", { name: /Inference/i }).first()).toBeVisible();
});

test("playground renders prompt UI and connect-wallet gating", async ({ page }) => {
  await page.goto("/playground");
  await expect(page.getByRole("heading", { name: /one real encrypted inference/i })).toBeVisible();
  await expect(page.getByLabel(/Prompt/i)).toBeVisible();
  // Without a wallet the Run button reads "Connect a wallet to run"
  await expect(page.getByRole("button", { name: /Connect a wallet to run/i })).toBeVisible();
});

test("network page shows the SDK code-snippet CTA under model performance", async ({ page }) => {
  await page.goto("/network");
  await expect(page.getByText(/Use this in your app/i).first()).toBeVisible();
});

test("nav surfaces the Build menu", async ({ page }) => {
  await page.goto("/");
  // Build is a dropdown trigger (button), not a plain link.
  await expect(page.getByRole("button", { name: "Build" }).first()).toBeVisible();
});

test("theme toggle switches to light mode", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveClass(/dark/);
  await page.getByRole("button", { name: /Switch to light theme/i }).click();
  await expect(html).not.toHaveClass(/dark/);
});
