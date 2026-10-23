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
    await page.screenshot({ path: `e2e/output/page-${name.toLowerCase().replace(/ /g, "-")}.png` });
  }
  expect(errors).toEqual([]);
});
