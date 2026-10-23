import { expect, test } from "@playwright/test";
import { mockTauri } from "./mockTauri";

const PAGES = ["Overview", "Portfolio", "Watchlist", "Groups", "Discover", "Price alerts", "Trailing stops", "Savings plans", "Transactions", "Settings"];

// Tool answers are generated from the published output schemas, so a page that misreads a response shows up here.
test("every page renders with schema-generated data and no errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockTauri(page);
  await page.goto("/");
  for (const name of PAGES) {
    await page.getByRole("link", { name: new RegExp(`^${name}`) }).or(page.getByRole("button", { name: new RegExp(`^${name}`) })).first().click();
    await expect(page.getByRole("heading", { name }).first()).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByRole("status", { name: "Loading page…" })).toHaveCount(0, { timeout: 20_000 });
    await page.waitForTimeout(300);
    // The app scrolls inside its own container, so grow the window by what is hidden to capture the whole page.
    const hidden = await page.evaluate(() =>
      Math.max(0, ...[...document.querySelectorAll<HTMLElement>("*")].filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY)).map((el) => el.scrollHeight - el.clientHeight)),
    );
    await page.setViewportSize({ width: 1600, height: 900 + hidden });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/output/page-${name.toLowerCase().replace(/ /g, "-")}.png` });
    await page.setViewportSize({ width: 1600, height: 900 });
  }
  expect(errors).toEqual([]);
});
