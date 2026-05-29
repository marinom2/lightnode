import { test, expect } from "@playwright/test";

// Smoke tests assert static, network-independent content so they stay reliable
// even if the live subgraph is slow/unreachable in CI.

test("landing renders hero, preview, and CTAs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Run a LightChain AI worker/i })).toBeVisible();
  await expect(page.getByText(/lightnode\/(mainnet|testnet)/)).toBeVisible(); // hero product preview
  await expect(page.getByRole("link", { name: /Start onboarding/i }).first()).toBeVisible();
  await expect(page.getByText(/What you'll serve/i)).toBeVisible(); // models section
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

test("theme toggle switches to light mode", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveClass(/dark/);
  await page.getByRole("button", { name: /Switch to light theme/i }).click();
  await expect(html).not.toHaveClass(/dark/);
});
