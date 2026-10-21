import { useLayoutEffect, useReducer, useRef, useState, type RefObject } from "react";
import { windowOf } from "../rowWindow";

/** Tracks and measures the visible rows inside a scrollable table. */
export function useRowWindow(keys: readonly string[], scrollRef: RefObject<HTMLDivElement | null>, enabled = true) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const heights = useRef(new Map<string, number>());
  const estimate = useRef(56);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const [, measureAgain] = useReducer((value: number) => value + 1, 0);

  const window = windowOf({
    count: keys.length,
    scrollTop: viewport.scrollTop,
    viewport: viewport.height,
    heightOf: (index) => heights.current.get(keys[index] ?? "") ?? estimate.current,
  });

  useLayoutEffect(() => {
    if (!enabled) return;
    const container = scrollRef.current;
    const body = bodyRef.current;
    if (!container || !body) return;

    const updateViewport = () => {
      const bodyTop = body.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      const headerHeight = body.closest("table")?.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      const scrollTop = Math.max(0, container.scrollTop + headerHeight - bodyTop);
      const height = Math.max(0, container.clientHeight - headerHeight);
      setViewport((current) => (current.scrollTop === scrollTop && current.height === height ? current : { scrollTop, height }));
    };

    updateViewport();
    container.addEventListener("scroll", updateViewport, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateViewport);
    observer?.observe(container);
    observer?.observe(body);
    globalThis.window.addEventListener("resize", updateViewport);
    return () => {
      container.removeEventListener("scroll", updateViewport);
      observer?.disconnect();
      globalThis.window.removeEventListener("resize", updateViewport);
    };
  }, [keys.length, enabled, scrollRef]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let changed = false;
    for (const row of body.querySelectorAll<HTMLTableRowElement>("tr[data-index]")) {
      const index = Number(row.dataset.index);
      const key = keys[index];
      const height = row.getBoundingClientRect().height;
      if (key && Number.isFinite(height) && height > 0 && Math.abs((heights.current.get(key) ?? 0) - height) > 0.5) {
        heights.current.set(key, height);
        if (heights.current.size === 1) estimate.current = height;
        changed = true;
      }
    }
    if (changed) measureAgain();
  });

  return { scrollRef, bodyRef, window };
}
