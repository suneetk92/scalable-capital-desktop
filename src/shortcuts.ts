import { useSyncExternalStore } from "react";
import { readStoredJson, writeStoredJson } from "./storage";

const STORAGE_NAME = "shortcuts";

/** The shortcuts the app has built in; a custom one may not reuse them. */
const BUILT_IN_SHORTCUTS: [string, string][] = [
  ["Ctrl+K", "Focus the table search"],
  ["Alt+K", "Focus the table search"],
  ["Ctrl+P", "Open the command palette"],
  ["Ctrl+,", "Open these settings"],
  ["Alt+ArrowUp", "Move the focused sidebar item"],
  ["Alt+ArrowDown", "Move the focused sidebar item"],
  ["Escape", "Close the open menu, dialog or panel"],
];

/** Combinations the webview, the text fields or the system already use for something else. */
const RESERVED = new Set(
  [..."ACVXZYFRWTNQSLOH"].map((letter) => `Ctrl+${letter}`).concat(["Ctrl+Shift+I", "Ctrl+Shift+R", "Ctrl+Shift+Z", "Ctrl+Tab", "Ctrl+=", "Ctrl+-", "Ctrl+0", "Alt+F4", "Alt+Tab", "F5", "F11", "F12"]),
);

const KEY_LABELS: Record<string, string> = { Comma: ",", Period: ".", Slash: "/", Minus: "-", Equal: "=", Semicolon: ";", Quote: "'", Backquote: "`" };

function keyOf(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Arrow(Up|Down|Left|Right)$/.test(code) || code === "Escape") return code;
  return KEY_LABELS[code] ?? null;
}

/** The combination of a key press as text, like "Ctrl+Shift+G"; Ctrl and Cmd count as one. Null for a modifier alone or an unsupported key. */
export function comboOf(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string | null {
  const key = keyOf(event.code);
  if (!key) return null;
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  return [...parts, key].join("+");
}

/** Why the combination cannot be used for the page `id`, or null when it is free. `taken` maps each page to its custom shortcut. */
export function shortcutProblem(combo: string, id: string, taken: Record<string, string>): string | null {
  const parts = combo.split("+");
  const key = parts[parts.length - 1] === "" ? "+" : parts[parts.length - 1];
  const hasCtrl = parts.includes("Ctrl");
  const hasAlt = parts.includes("Alt");
  if (!hasCtrl && !hasAlt) return "Use Ctrl or Alt with the key, so typing in a field is not affected.";
  if (hasCtrl && hasAlt) return "Ctrl+Alt is AltGr on many keyboards and types characters. Use Ctrl or Alt alone.";
  if (key === "Escape") return "Escape closes menus and dialogs.";
  const builtIn = BUILT_IN_SHORTCUTS.find(([keys]) => keys === combo);
  if (builtIn) return `${combo} is already used to ${builtIn[1].charAt(0).toLowerCase()}${builtIn[1].slice(1)}.`;
  if (RESERVED.has(combo)) return `${combo} is reserved by the window or the system.`;
  const other = Object.entries(taken).find(([page, existing]) => page !== id && existing === combo);
  if (other) return `${combo} is already assigned to another page.`;
  return null;
}

type Shortcuts = Record<string, string>;

const listeners = new Set<() => void>();
let current: Shortcuts | null = null;

function load(): Shortcuts {
  const raw = readStoredJson(STORAGE_NAME);
  const result: Shortcuts = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, combo] of Object.entries(raw)) {
      if (typeof combo === "string" && shortcutProblem(combo, id, result) === null) result[id] = combo;
    }
  }
  return result;
}

function snapshot(): Shortcuts {
  current ??= load();
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The custom "open this page" shortcuts, by page id. */
export function useShortcuts(): Shortcuts {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Saves the shortcut of a page, or clears it with null. Returns the problem when it is refused; nothing is saved then. */
export function setShortcut(id: string, combo: string | null): string | null {
  const next = { ...snapshot() };
  if (combo === null) delete next[id];
  else {
    const problem = shortcutProblem(combo, id, next);
    if (problem) return problem;
    next[id] = combo;
  }
  current = next;
  writeStoredJson(STORAGE_NAME, next);
  listeners.forEach((listener) => listener());
  return null;
}

/** The page that a key press opens, if any. */
export function pageForCombo(combo: string, shortcuts: Shortcuts): string | undefined {
  return Object.entries(shortcuts).find(([, existing]) => existing === combo)?.[0];
}
