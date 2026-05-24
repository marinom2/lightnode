import { test, expect } from "@playwright/test";

// Smoke tests assert static, network-independent content so they stay reliable
// even if the live subgraph is slow/unreachable in CI.

test("landing renders hero, preview, and CTAs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Become a LightChain AI worker/i })).toBeVisible();
  await expect(page.getByText("lightnode · dashboard")).toBeVisible(); // hero product preview
  await expect(page.getByRole("link", { name: /Start onboarding/i }).first()).toBeVisible();
  await expect(page.getByText(/What you'll serve/i)).toBeVisible(); // models section
});

test("nav: connect button + network toggle present", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Connect wallet/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Mainnet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Testnet" })).toBeVisible();
});

test("onboard wizard starts on the connect step", async ({ page }) => {
  await page.goto("/onboard");
  await expect(page.getByRole("heading", { name: /Become a worker/i })).toBeVisible();
  await expect(page.getByText(/Connect the wallet you'll fund from/i)).toBeVisible();
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

test("network page renders the leaderboard", async ({ page }) => {
  await page.goto("/network");
  await expect(page.getByRole("heading", { name: "Network", exact: true })).toBeVisible();
  await expect(page.getByText("Top workers")).toBeVisible();
});

test("theme toggle switches to light mode", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveClass(/dark/);
  await page.getByRole("button", { name: /Switch to light theme/i }).click();
  await expect(html).not.toHaveClass(/dark/);
});
