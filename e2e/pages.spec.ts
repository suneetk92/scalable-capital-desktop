import { expect, test, type Page } from "@playwright/test";
import { mockTauri } from "./mockTauri";

const PAGES = ["Overview", "Portfolio", "Watchlist", "Groups", "Discover", "Price alerts", "Trailing stops", "Savings plans", "Transactions", "Settings"];

/** Waits until the browser has painted twice, so the layout after the last change is on screen. */
function nextFrames(page: Page) {
  return page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

// Tool answers are generated from the published output schemas, so a page that misreads a response shows up here.
test("every page renders with schema-generated data and no errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockTauri(page);
  await page.goto("/");
  for (const name of PAGES) {
    await page
      .getByRole("link", { name: new RegExp(`^${name}`) })
      .or(page.getByRole("button", { name: new RegExp(`^${name}`) }))
      .first()
      .click();
    await expect(page.getByRole("heading", { name }).first()).toBeVisible();
    // The lazy page chunks and the mocked data have arrived once the dev server is idle and no loader is left.
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("status", { name: "Loading page…" })).toHaveCount(0, { timeout: 20_000 });
    await nextFrames(page);
    // The app scrolls inside its own container, so grow the window by what is hidden to capture the whole page.
    const hidden = await page.evaluate(() =>
      Math.max(0, ...[...document.querySelectorAll<HTMLElement>("*")].filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY)).map((el) => el.scrollHeight - el.clientHeight)),
    );
    await page.setViewportSize({ width: 1600, height: 900 + hidden });
    await nextFrames(page);
    await page.screenshot({ path: `e2e/output/page-${name.toLowerCase().replace(/ /g, "-")}.png` });
    await page.setViewportSize({ width: 1600, height: 900 });
  }
  expect(errors).toEqual([]);
});
