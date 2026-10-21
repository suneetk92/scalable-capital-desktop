import { describe, expect, it } from "vitest";
import { findUnusedExports } from "./check-exports.mjs";

describe("findUnusedExports", () => {
  it("reports an unused export and ignores one imported and used elsewhere", () => {
    const unused = findUnusedExports([
      { fileName: "/src/a.ts", text: "export const unused = 1; export const used = 2;" },
      { fileName: "/src/b.ts", text: 'import { used } from "./a"; console.log(used);' },
    ]);
    expect(unused).toEqual([{ fileName: "/src/a.ts", name: "unused" }]);
  });

  it("counts only the symbol referenced by a dynamic import callback", () => {
    const unused = findUnusedExports([
      { fileName: "/src/a.ts", text: "export const usedPage = 1; export const unusedPage = 2;" },
      { fileName: "/src/b.ts", text: 'void import("./a").then((module) => module.usedPage);' },
    ]);
    expect(unused).toEqual([{ fileName: "/src/a.ts", name: "unusedPage" }]);
  });

  it("does not report the exports of an API file, but counts its re-exports as uses", () => {
    const unused = findUnusedExports(
      [
        { fileName: "/src/api.ts", text: 'export type Slot = string; export { shared } from "./a";' },
        { fileName: "/src/a.ts", text: "export const shared = 1; export const unused = 2;" },
      ],
      ["/src/api.ts"],
    );
    expect(unused).toEqual([{ fileName: "/src/a.ts", name: "unused" }]);
  });
});
