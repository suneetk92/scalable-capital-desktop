import { beforeEach, describe, expect, it, vi } from "vitest";
import { clampPanelWidth, clampSplit, loadPanelWidth, loadSplit, PANEL_DEFAULT_WIDTH, PANEL_MIN_WIDTH, saveSplit, savePanelWidth, SPLIT_DEFAULT } from "./panel";

describe("clampPanelWidth", () => {
  it("keeps a width inside the limits", () => {
    expect(clampPanelWidth(500, 1600)).toBe(500);
  });
  it("raises a narrow width to the minimum", () => {
    expect(clampPanelWidth(100, 1600)).toBe(PANEL_MIN_WIDTH);
  });
  it("caps the width at 80% of the window", () => {
    expect(clampPanelWidth(5000, 1000)).toBe(800);
  });
  it("keeps the minimum in a very small window", () => {
    expect(clampPanelWidth(500, 300)).toBe(PANEL_MIN_WIDTH);
  });
  it("falls back to the default for a width that is not a number", () => {
    expect(clampPanelWidth(Number.NaN, 1600)).toBe(PANEL_DEFAULT_WIDTH);
  });
});

describe("panel width storage", () => {
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) } });
  });
  it("returns the default when nothing was saved", () => {
    expect(loadPanelWidth()).toBe(PANEL_DEFAULT_WIDTH);
  });
  it("returns the saved width", () => {
    savePanelWidth(612);
    expect(loadPanelWidth()).toBe(612);
  });
  it("ignores a stored value that is not a number", () => {
    memory.set("scalable-capital-desktop.panel-width", "wide");
    expect(loadPanelWidth()).toBe(PANEL_DEFAULT_WIDTH);
  });
});

describe("clampSplit", () => {
  it("keeps a share inside the limits", () => {
    expect(clampSplit(0.5)).toBe(0.5);
    expect(clampSplit(0)).toBe(0.15);
    expect(clampSplit(2)).toBe(0.85);
  });
  it("falls back to the default for a share that is not a number", () => {
    expect(clampSplit(Number.NaN)).toBe(SPLIT_DEFAULT);
  });
});

describe("split storage", () => {
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) } });
  });
  it("returns the default when nothing was saved", () => {
    expect(loadSplit()).toBe(SPLIT_DEFAULT);
  });
  it("returns the saved share", () => {
    saveSplit(0.3);
    expect(loadSplit()).toBe(0.3);
  });
});
