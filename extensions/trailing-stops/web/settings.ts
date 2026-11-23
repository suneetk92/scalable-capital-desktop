import { useSyncExternalStore } from "react";
import { REFRESH_OPTIONS } from "../../../src/refreshOptions";

type TrailingSettings = { checkSeconds: number; maxStops: number };

export const STOP_LIMITS = [10, 25, 50, 100, 200, 500];

const KEY = "scalable-capital-desktop.trailing-stops";
const DEFAULTS: TrailingSettings = { checkSeconds: 30, maxStops: 50 };

const validSeconds = (value: unknown) => REFRESH_OPTIONS.find(([seconds]) => seconds === value)?.[0];

function read(): TrailingSettings {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULTS;
    const stored = value as Partial<TrailingSettings>;
    return {
      checkSeconds: validSeconds(stored.checkSeconds) ?? DEFAULTS.checkSeconds,
      maxStops: STOP_LIMITS.find((limit) => limit === stored.maxStops) ?? DEFAULTS.maxStops,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: TrailingSettings) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in a restricted webview; the in-memory value still applies for this session.
  }
  listeners.forEach((listener) => listener());
}

export function useTrailingSettings(): TrailingSettings {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULTS,
  );
}

export function updateTrailingSettings(patch: Partial<TrailingSettings>) {
  publish({ ...current, ...patch });
}

/** Moves the check frequency out of the app's own settings, where it was kept before the trailing stops became an extension. */
export function migrateLegacySettings(raw: Record<string, unknown>) {
  if (!("trailingSeconds" in raw)) return;
  const hasStored = typeof localStorage !== "undefined" && localStorage.getItem(KEY) !== null;
  const seconds = validSeconds(raw.trailingSeconds);
  if (!hasStored && seconds !== undefined) publish({ ...DEFAULTS, checkSeconds: seconds });
  delete raw.trailingSeconds;
}
