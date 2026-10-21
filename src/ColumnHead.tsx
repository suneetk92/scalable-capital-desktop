import { Fragment, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { ColumnLayout, ColumnWidths } from "./hooks/useTableLayout";
import { cx } from "./ui";

const MIN_WIDTH = 3;
const DEFAULT_WIDTH = 8;
const KEY_STEP = 0.5;
const DRAG_DISTANCE = 5;
const DRAGGING = ["select-none", "cursor-grabbing"];

const rootSize = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/** The widths of every column of the header's table as laid out now, in rem. */
function measure(head: HTMLElement): ColumnWidths {
  const unit = rootSize();
  const widths: ColumnWidths = {};
  head
    .closest("table")
    ?.querySelectorAll<HTMLElement>("th[data-col]")
    .forEach((cell) => {
      widths[cell.dataset.col ?? ""] = Math.max(MIN_WIDTH, cell.getBoundingClientRect().width / unit);
    });
  return widths;
}

/** Table attributes for a table whose columns have been resized: fixed layout, `extra` rem for the columns that are not resizable. */
export function resizedTable(widths: ColumnWidths | null, extra = 0) {
  if (!widths) return { className: undefined, style: undefined };
  const total = Object.values(widths).reduce((sum, width) => sum + width, 0) + extra;
  return { className: "table-fixed [&_td]:overflow-hidden [&_td]:text-ellipsis [&_th]:overflow-hidden [&_th]:text-ellipsis", style: { width: `${total}rem`, minWidth: "100%" } };
}

/** The cells of a row in the order of its columns. */
export function inOrder(order: readonly string[], cells: Record<string, ReactNode>) {
  return order.map((id) => <Fragment key={id}>{cells[id]}</Fragment>);
}

/**
 * A column header that can be dragged to another place in its row and resized by the handle on its right edge (double-click
 * restores the automatic widths of the table, arrow keys on the handle adjust it). Pointer events are used instead of HTML drag and drop, which the
 * Tauri window takes for file drops on Windows.
 */
export function ColumnHead({
  id,
  label,
  layout,
  className,
  sortState,
  children,
}: {
  id: string;
  label: string;
  layout: ColumnLayout;
  className?: string;
  sortState?: "ascending" | "descending" | "none";
  children: ReactNode;
}) {
  const head = useRef<HTMLTableCellElement>(null);
  const width = layout.widths?.[id] ?? (layout.widths ? DEFAULT_WIDTH : null);

  function startMove(event: PointerEvent<HTMLTableCellElement>) {
    const cell = head.current;
    if (event.button !== 0 || !cell || (event.target as HTMLElement).closest("[data-resize]")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let target: { cell: HTMLElement; after: boolean } | null = null;
    const clear = () => {
      document.querySelectorAll("[data-drop]").forEach((element) => element.removeAttribute("data-drop"));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      clear();
      cell.removeAttribute("data-dragging");
      document.body.classList.remove(...DRAGGING);
    };
    const move = (next: globalThis.PointerEvent) => {
      if (!active && Math.hypot(next.clientX - startX, next.clientY - startY) < DRAG_DISTANCE) return;
      if (!active) {
        active = true;
        cell.setAttribute("data-dragging", "");
        document.body.classList.add(...DRAGGING);
      }
      clear();
      const over = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>("th[data-col]");
      if (!over || over === cell || over.closest("table") !== cell.closest("table")) {
        target = null;
        return;
      }
      const box = over.getBoundingClientRect();
      const after = next.clientX > box.left + box.width / 2;
      over.setAttribute("data-drop", after ? "after" : "before");
      target = { cell: over, after };
    };
    const up = () => {
      const drop = active ? target : null;
      stop();
      if (!active) return;
      // The click that ends the drag must not sort the column.
      const swallow = (click: Event) => click.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      if (drop?.cell.dataset.col) layout.move(id, drop.cell.dataset.col, drop.after);
    };
    const key = (next: globalThis.KeyboardEvent) => {
      if (next.key === "Escape") {
        target = null;
        active = false;
        stop();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
  }

  function startResize(event: PointerEvent<HTMLElement>) {
    const cell = head.current;
    if (event.button !== 0 || !cell) return;
    event.preventDefault();
    event.stopPropagation();
    const base = { ...measure(cell), ...layout.widths };
    const startX = event.clientX;
    const start = base[id] ?? DEFAULT_WIDTH;
    const unit = rootSize();
    const move = (next: globalThis.PointerEvent) => layout.setWidths({ ...base, [id]: Math.max(MIN_WIDTH, start + (next.clientX - startX) / unit) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove(...DRAGGING);
    };
    document.body.classList.add(...DRAGGING);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function resizeByKey(event: KeyboardEvent<HTMLElement>) {
    const cell = head.current;
    if (!cell || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const base = { ...measure(cell), ...layout.widths };
    layout.setWidths({ ...base, [id]: Math.max(MIN_WIDTH, (base[id] ?? DEFAULT_WIDTH) + (event.key === "ArrowRight" ? KEY_STEP : -KEY_STEP)) });
  }

  return (
    <th
      ref={head}
      scope="col"
      data-col={id}
      aria-sort={sortState}
      className={cx(
        "relative cursor-grab data-dragging:opacity-50 data-[drop=after]:shadow-[inset_-0.1875rem_0_0_var(--color-accent)] data-[drop=before]:shadow-[inset_0.1875rem_0_0_var(--color-accent)]",
        className,
      )}
      style={width === null ? undefined : { width: `${width}rem`, minWidth: `${width}rem`, maxWidth: `${width}rem` }}
      onPointerDown={startMove}
    >
      {children}
      <span
        data-resize=""
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label}`}
        tabIndex={0}
        className="absolute inset-y-0 right-0 z-[2] w-2 cursor-col-resize touch-none hover:bg-accent/40 focus-visible:bg-accent/40"
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
        onDoubleClick={() => layout.setWidths(null)}
      />
    </th>
  );
}
