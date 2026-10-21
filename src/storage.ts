export const STORAGE_PREFIX = "scalable-capital-desktop.";

export function storageKey(name: string): string {
  return `${STORAGE_PREFIX}${name}`;
}

export function readStored(name: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey(name));
  } catch {
    return null;
  }
}

export function writeStored(name: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(name), value);
  } catch {
    // Storage can be unavailable; callers keep their in-memory state for this session.
  }
}

export function readStoredJson(name: string): unknown {
  const stored = readStored(name);
  if (stored === null || stored === "") return null;
  try {
    return JSON.parse(stored) as unknown;
  } catch {
    return null;
  }
}

export function writeStoredJson(name: string, value: unknown): void {
  try {
    const stored = JSON.stringify(value);
    if (stored !== undefined) writeStored(name, stored);
  } catch {
    // Storage can be unavailable or the value can be cyclic.
  }
}
