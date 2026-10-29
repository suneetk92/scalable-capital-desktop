import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredJson, writeStoredJson } from "../storage";

/** Column widths in rem, keyed by column id. A table either has the widths of all its columns or none (automatic layout). */
export type ColumnWidths = Record<string, number>;

/** What a column header needs to resize and move its column. */
export type ColumnLayout = {
  widths: ColumnWidths | null;
  setWidths: (widths: ColumnWidths | null) => void;
  /** Moves column `from` just before or after column `to`. */
  move: (from: string, to: string, after: boolean) => void;
};

type Stored = { order: string[]; widths: ColumnWidths | null };

/** The stored order restricted to the columns that exist, with new columns placed after the column that precedes them by default. */
export function mergeOrder(stored: readonly string[], ids: readonly string[]): string[] {
  const known = new Set(ids);
  const order = stored.filter((id, index) => known.has(id) && stored.indexOf(id) === index);
  ids.forEach((id, index) => {
    if (order.includes(id)) return;
    const previous = ids[index - 1];
    const at = previous === undefined ? -1 : order.indexOf(previous);
    order.splice(at + 1, 0, id);
  });
  return order;
}

export function moveColumn(order: readonly string[], from: string, to: string, after: boolean): string[] {
  if (from === to || !order.includes(from) || !order.includes(to)) return [...order];
  const rest = order.filter((id) => id !== from);
  rest.splice(rest.indexOf(to) + (after ? 1 : 0), 0, from);
  return rest;
}

function readLayout(name: string): Stored {
  const raw = readStoredJson(`table.${name}`);
  const record = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const order = Array.isArray(record.order) ? record.order.filter((id): id is string => typeof id === "string") : [];
  let widths: ColumnWidths | null = null;
  if (record.widths !== null && typeof record.widths === "object") {
    const entries = Object.entries(record.widths as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0);
    if (entries.length > 0) widths = Object.fromEntries(entries);
  }
  return { order, widths };
}

/**
 * A value read from the stored layout of the table `name`. When the same component shows another table (the name
 * changes), the value is read again for that name before anything is written, so one table's layout is never saved
 * under another's name.
 */
function useStoredPart<T>(name: string, read: (layout: Stored) => T) {
  const [state, setState] = useState(() => ({ name, value: read(readLayout(name)) }));
  if (state.name !== name) setState({ name, value: read(readLayout(name)) });
  const set = useCallback((value: T) => setState((current) => ({ ...current, value })), []);
  return [state.value, set, state.name === name] as const;
}

/** Column widths of a table, remembered per table name. */
export function useColumnWidths(name: string) {
  const [widths, setWidths, loaded] = useStoredPart(name, (layout) => layout.widths);
  useEffect(() => {
    if (loaded) writeStoredJson(`table.${name}`, { ...readLayout(name), widths });
  }, [name, widths, loaded]);
  return [widths, setWidths] as const;
}

/** Column order and widths of a table, remembered per table name; `ids` are the columns in their default order. */
export function useTableLayout(name: string, ids: readonly string[]) {
  const [order, setOrder, loaded] = useStoredPart(name, (layout) => layout.order);
  const [widths, setWidths] = useColumnWidths(name);
  useEffect(() => {
    if (loaded) writeStoredJson(`table.${name}`, { ...readLayout(name), order });
  }, [name, order, loaded]);
  const key = ids.join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the contents of `ids`
  const columns = useMemo(() => mergeOrder(order, ids), [order, key]);
  const move = useCallback((from: string, to: string, after: boolean) => setOrder(moveColumn(columns, from, to, after)), [columns, setOrder]);
  const layout: ColumnLayout = useMemo(() => ({ widths, setWidths, move }), [widths, setWidths, move]);
  return { order: columns, layout };
}
