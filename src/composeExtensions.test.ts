import { describe, expect, it } from "vite-plus/test";
import { composeExtensions } from "./composeExtensions";
import type { AppExtension, ExtensionContext } from "./extensions";

const base = { version: "1.0.0" };
const view = (id: string, count: number) => ({ id, after: "alerts", label: id, title: id, description: "", icon: (() => null) as never, count: () => count, render: () => null });
const context = (extensionData: unknown) => ({ data: { extensionData }, commands: {} }) as unknown as ExtensionContext;

describe("composeExtensions", () => {
  const first: AppExtension = { ...base, id: "first", name: "First", views: [view("one", 1)], useData: () => "first-data", migrateLegacy: (raw) => void (raw.first = true) };
  const second: AppExtension = { ...base, id: "second", name: "Second", variantName: "with second", views: [view("two", 2)], useData: () => "second-data", dock: () => null };

  it("keeps the data of each extension apart and hands each its own", () => {
    const composed = composeExtensions([first, second]);
    const data = { first: "first-data", second: "second-data" };
    expect(composed.views?.map((item) => item.id)).toEqual(["one", "two"]);
    expect(composed.views?.[0].count?.(context(data))).toBe(1);
    expect(composed.views?.[1].count?.(context(data))).toBe(2);
  });

  it("knows which extension owns the side panel", () => {
    const composed = composeExtensions([first, second]);
    expect(composed.hasDock("one")).toBe(false);
    expect(composed.hasDock("two")).toBe(true);
    expect(composed.variantName).toBe("with second");
  });

  it("runs every legacy migration and leaves absent slots empty", () => {
    const composed = composeExtensions([first, second]);
    const raw: Record<string, unknown> = {};
    composed.migrateLegacy?.(raw);
    expect(raw.first).toBe(true);
    expect(composed.providers).toBeUndefined();
    expect(composed.orderProtection).toBeUndefined();
    expect(composeExtensions([]).views).toBeUndefined();
  });
});
