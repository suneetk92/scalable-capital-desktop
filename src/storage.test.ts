import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { readStored, readStoredJson, storageKey, writeStored, writeStoredJson } from "./storage";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) } });
});

describe("shared storage", () => {
  it("adds the application prefix and round-trips strings and JSON", () => {
    expect(storageKey("settings")).toBe("scalable-capital-desktop.settings");
    writeStored("raw", "text");
    expect(readStored("raw")).toBe("text");
    writeStoredJson("json", { count: 3 });
    expect(readStoredJson("json")).toEqual({ count: 3 });
  });

  it("returns null for absent, malformed or unavailable values", () => {
    expect(readStoredJson("absent")).toBeNull();
    memory.set(storageKey("broken"), "{not json");
    expect(readStoredJson("broken")).toBeNull();
    vi.stubGlobal("window", {
      get localStorage(): never {
        throw new Error("blocked");
      },
    });
    expect(readStored("blocked")).toBeNull();
    expect(() => writeStored("blocked", "value")).not.toThrow();
  });
});

describe("localStorage access boundary", () => {
  it("keeps direct localStorage use in the shared module and legacy history migration", () => {
    const sources = import.meta.glob("./**/*.{ts,tsx}", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
    const offenders = Object.entries(sources)
      .filter(([path, source]) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx") && /\blocalStorage\b/.test(source))
      .map(([path]) => path.replace("./", "src/"));
    expect(offenders.sort()).toEqual(["src/activityCache.ts", "src/storage.ts"]);
  });
});
