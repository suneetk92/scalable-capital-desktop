import { describe, expect, it } from "vite-plus/test";
import { comboOf, pageForCombo, shortcutProblem } from "./shortcuts";

const press = (code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("shortcuts", () => {
  it("reads a key press as one combination, counting Cmd as Ctrl", () => {
    expect(comboOf(press("KeyG", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+G");
    expect(comboOf(press("Digit1", { metaKey: true }))).toBe("Ctrl+1");
    expect(comboOf(press("ShiftLeft", { shiftKey: true }))).toBeNull();
  });

  it("refuses built-in, reserved, duplicate and unsafe combinations", () => {
    expect(shortcutProblem("Ctrl+K", "groups", {})).toContain("already used");
    expect(shortcutProblem("Ctrl+,", "groups", {})).toContain("already used");
    expect(shortcutProblem("Ctrl+C", "groups", {})).toContain("reserved");
    expect(shortcutProblem("G", "groups", {})).toContain("Ctrl or Alt");
    expect(shortcutProblem("Ctrl+Alt+G", "groups", {})).toContain("AltGr");
    expect(shortcutProblem("Ctrl+G", "alerts", { groups: "Ctrl+G" })).toContain("another page");
  });

  it("allows a free combination, also for the page that already owns it", () => {
    expect(shortcutProblem("Ctrl+G", "groups", {})).toBeNull();
    expect(shortcutProblem("Ctrl+G", "groups", { groups: "Ctrl+G" })).toBeNull();
    expect(pageForCombo("Ctrl+G", { groups: "Ctrl+G" })).toBe("groups");
    expect(pageForCombo("Ctrl+H", { groups: "Ctrl+G" })).toBeUndefined();
  });
});
