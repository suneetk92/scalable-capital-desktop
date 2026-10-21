/** Rows handled per slice; a slice of this size takes a few milliseconds, so the UI stays responsive between slices. */
export const CHUNK_SIZE = 500;

type Scheduler = { yield?: () => Promise<void> };

/** Gives the browser a turn: `scheduler.yield` where it exists, else a macrotask. */
function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Scheduler }).scheduler;
  return typeof scheduler?.yield === "function" ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve));
}

/**
 * `items.map(map)` done in slices of `size`, yielding between the slices. Resolves to null as soon as
 * `cancelled` turns true, so a newer request can take over.
 */
export async function mapChunked<T, R>(
  items: readonly T[],
  map: (item: T, index: number) => R,
  { size = CHUNK_SIZE, cancelled = () => false, yieldFn = yieldToMain }: { size?: number; cancelled?: () => boolean; yieldFn?: () => Promise<void> } = {},
): Promise<R[] | null> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    if (cancelled()) return null;
    if (start > 0) await yieldFn();
    if (cancelled()) return null;
    for (let index = start; index < Math.min(start + size, items.length); index += 1) out.push(map(items[index] as T, index));
  }
  return cancelled() ? null : out;
}
