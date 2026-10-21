type SortDirection = "ascending" | "descending";
export type SortState = { key: string; direction: SortDirection } | null;

/** Click on a header: a new column sorts ascending, the same column then descending, then the original order again. */
export function nextSort(current: SortState, key: string): SortState {
  if (current === null || current.key !== key) return { key, direction: "ascending" };
  return current.direction === "ascending" ? { key, direction: "descending" } : null;
}

const isBlank = (value: unknown) => value === null || value === undefined || value === "" || (typeof value === "number" && Number.isNaN(value));

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** A sorted copy of `items`. Empty values always come last, and equal values keep their order. `state` of null keeps the original order. */
export function sortItems<T>(items: T[], state: SortState, valueOf: (item: T, key: string) => unknown): T[] {
  if (state === null) return items;
  const sign = state.direction === "ascending" ? 1 : -1;
  return items
    .map((item, index) => ({ item, index, value: valueOf(item, state.key) }))
    .sort((a, b) => {
      const blankA = isBlank(a.value);
      const blankB = isBlank(b.value);
      if (blankA || blankB) return blankA === blankB ? a.index - b.index : blankA ? 1 : -1;
      return sign * compare(a.value, b.value) || a.index - b.index;
    })
    .map((entry) => entry.item);
}
