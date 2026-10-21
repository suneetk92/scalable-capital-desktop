/** The longest pause between two automatic reloads while Scalable keeps failing. */
export const MAX_REFRESH_BACKOFF_MS = 10 * 60_000;

/** Milliseconds until the next automatic reload: the chosen interval, doubled for every reload in a row that failed, up to the cap. */
export function nextRefreshDelay(baseMs: number, failures: number, maxMs = MAX_REFRESH_BACKOFF_MS): number {
  const doublings = Math.max(0, Math.min(failures, 16));
  return Math.min(maxMs, baseMs * 2 ** doublings);
}

/** Whether the periodic `ping` is worth sending: not when the account data itself loaded within the check interval, which already proved the connection. */
export function connectionCheckDue(lastLoadedAt: number | null, now: number, intervalMs: number): boolean {
  return lastLoadedAt === null || now - lastLoadedAt >= intervalMs;
}

/** Whether a delayed timer tick or foreground transition is consistent with the machine having slept. */
export function wokeFromSleep(lastTick: number, now: number, intervalMs: number): boolean {
  return now - lastTick > intervalMs + 60_000;
}
