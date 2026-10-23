// No imports on purpose: extensions use these while the core settings are still loading.
export const REFRESH_OPTIONS: [number, string][] = [
  [15, "15 seconds"],
  [30, "30 seconds"],
  [60, "1 minute"],
  [120, "2 minutes"],
  [300, "5 minutes"],
  [600, "10 minutes"],
];

/** "30 seconds", "1 minute" becomes "minute"; used in "every …". */
export const intervalLabel = (seconds: number) => (REFRESH_OPTIONS.find(([value]) => value === seconds)?.[1] ?? `${seconds} seconds`).replace(/^1 /, "");
