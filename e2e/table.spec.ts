import { expect, test, type Page } from "@playwright/test";
import { mockTauri } from "./mockTauri";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await mockTauri(page);
  await page.addInitScript(() => {
    const columns = ["price", "change", "bid", "ask", "spreadPct", "quantity", "value", "avgPrice", "sinceBuy", "sinceBuyPct", "weight", "exchange"];
    window.localStorage.setItem("scalable-capital-desktop.settings", JSON.stringify({ tableColumns: columns }));
  });
  await page.goto("/");
  await page
    .getByRole("link", { name: /^Portfolio/ })
    .or(page.getByRole("button", { name: /^Portfolio/ }))
    .first()
    .click();
  await page.locator("table tbody tr").first().waitFor();
});

/** Per column: where the header label and the first value end and start, in pixels. */
async function columns(page: Page) {
  return page.evaluate(() => {
    const heads = [...document.querySelectorAll<HTMLElement>("table thead th[data-col]")];
    const row = [...document.querySelectorAll<HTMLElement>("table tbody tr[data-index]")].find((tr) => tr.children.length === heads[0].parentElement!.children.length);
    return heads.map((head) => {
      const index = [...head.parentElement!.children].indexOf(head);
      const cell = row!.children[index] as HTMLElement;
      const label = head.querySelector("button")!.getBoundingClientRect();
      const content = document.createRange();
      content.selectNodeContents(cell);
      // A range also counts text that an ellipsis clips, so keep it inside the cell's content box.
      const range = content.getBoundingClientRect();
      const box = cell.getBoundingClientRect();
      const style = getComputedStyle(cell);
      const value = { left: Math.max(range.left, box.left + parseFloat(style.paddingLeft)), right: Math.min(range.right, box.right - parseFloat(style.paddingRight)) };
      return {
        id: head.dataset.col!,
        headAlign: getComputedStyle(head).textAlign,
        cellAlign: getComputedStyle(cell).textAlign,
        labelLeft: label.left,
        labelRight: label.right,
        valueLeft: value.left,
        valueRight: value.right,
      };
    });
  });
}

test("every header is aligned like the values under it", async ({ page }) => {
  for (const column of await columns(page)) {
    if (column.cellAlign === "right") {
      expect(column.headAlign, `${column.id} header`).toBe("right");
      expect(Math.abs(column.labelRight - column.valueRight), `${column.id}: right edges`).toBeLessThanOrEqual(2);
    } else {
      expect(Math.abs(column.labelLeft - column.valueLeft), `${column.id}: left edges`).toBeLessThanOrEqual(2);
    }
  }
});

test("headers stay aligned after a resize and after fitting to content", async ({ page }) => {
  const handle = page.getByRole("separator", { name: "Resize Price" });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.screenshot({ path: "e2e/output/resized.png" });
  for (const column of await columns(page)) {
    if (column.cellAlign === "right") expect(Math.abs(column.labelRight - column.valueRight), `${column.id} after resize`).toBeLessThanOrEqual(2);
  }
  await handle.dblclick();
  await page.screenshot({ path: "e2e/output/fitted.png" });
  for (const column of await columns(page)) {
    if (column.cellAlign === "right") expect(Math.abs(column.labelRight - column.valueRight), `${column.id} after fit`).toBeLessThanOrEqual(2);
  }
});

test("the table has no horizontal overflow of the page", async ({ page }) => {
  await page.screenshot({ path: "e2e/output/portfolio.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
