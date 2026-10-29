/**
 * Orders overlapping loads: only the result of the newest load is used, and none from before the last
 * `invalidate` (a sign-out, or a change already applied on screen). `busy` stays true until every load
 * that is still running has finished, so the loading state clears with the last of them.
 */
export function loadSequence() {
  let latest = 0;
  let running = 0;
  return {
    /** Starts a load; pass the number to `current` and `finish` when it ends. */
    start(): number {
      running += 1;
      latest += 1;
      return latest;
    },
    /** Whether the load is still the newest one and nothing invalidated it, so its result may be shown. */
    current(id: number): boolean {
      return id === latest;
    },
    /** Ends a load; true when no other load is running any more. */
    finish(): boolean {
      running = Math.max(0, running - 1);
      return running === 0;
    },
    /** Makes the result of every load that is running now stale. */
    invalidate() {
      latest += 1;
    },
    busy(): boolean {
      return running > 0;
    },
  };
}
