import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** What is being dragged in a table divided into sections: a section header (to reorder) or a row (to move into another section). */
export type SectionDrag<Row> = { kind: "section"; key: string; label: string } | { kind: "row"; key: string; row: Row; label: string };

const START_DISTANCE = 5;
const SCROLL_EDGE = 48;
const MAX_SCROLL_STEP = 24;
// Set on the page while a drag is on: no text gets selected and the pointer shows the grab.
const DRAGGING = ["select-none", "cursor-grabbing"];

/**
 * Pointer-driven drag and drop between the `tr[data-section]` rows of a scroll container. Pointer events are used
 * instead of HTML drag and drop, which the Tauri window takes for file drops on Windows. The container scrolls when the
 * pointer nears its top or bottom edge, Escape cancels, and the click that ends a drag is swallowed.
 */
export function useSectionDrag<Row>({
  container,
  canDrop,
  onDrop,
}: {
  container: RefObject<HTMLElement | null>;
  canDrop: (drag: SectionDrag<Row>, section: string) => boolean;
  onDrop: (drag: SectionDrag<Row>, section: string) => void;
}) {
  const [drag, setDrag] = useState<SectionDrag<Row> | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const latest = useRef({ canDrop, onDrop });
  latest.current = { canDrop, onDrop };
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelRef.current?.(), []);

  const startDrag = useCallback(
    (event: { button: number; clientX: number; clientY: number }, item: SectionDrag<Row>) => {
      if (event.button !== 0) return;
      cancelRef.current?.();
      const startX = event.clientX;
      const startY = event.clientY;
      let x = startX;
      let y = startY;
      let active = false;
      let target: string | null = null;
      let frame = 0;

      const findTarget = () => {
        const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("tr[data-section]");
        const key = element && container.current?.contains(element) ? (element.dataset.section ?? null) : null;
        return key !== null && latest.current.canDrop(item, key) ? key : null;
      };
      const autoScroll = () => {
        const scroller = container.current;
        if (scroller) {
          const rect = scroller.getBoundingClientRect();
          const over = y < rect.top + SCROLL_EDGE ? y - (rect.top + SCROLL_EDGE) : y > rect.bottom - SCROLL_EDGE ? y - (rect.bottom - SCROLL_EDGE) : 0;
          if (over !== 0) {
            scroller.scrollTop += Math.max(-MAX_SCROLL_STEP, Math.min(MAX_SCROLL_STEP, over / 2));
            target = findTarget();
            setDropKey(target);
          }
        }
        frame = window.requestAnimationFrame(autoScroll);
      };
      const onMove = (moveEvent: PointerEvent) => {
        x = moveEvent.clientX;
        y = moveEvent.clientY;
        if (!active) {
          if (Math.hypot(x - startX, y - startY) < START_DISTANCE) return;
          active = true;
          document.documentElement.classList.add(...DRAGGING);
          window.getSelection()?.removeAllRanges();
          setDrag(item);
          frame = window.requestAnimationFrame(autoScroll);
        }
        setPointer({ x, y });
        target = findTarget();
        setDropKey(target);
      };
      const finish = (drop: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKeyDown, true);
        window.cancelAnimationFrame(frame);
        cancelRef.current = null;
        if (active) {
          document.documentElement.classList.remove(...DRAGGING);
          // The click that follows the release would open or close a section or a security.
          const swallow = (clickEvent: MouseEvent) => {
            clickEvent.stopPropagation();
            clickEvent.preventDefault();
          };
          window.addEventListener("click", swallow, true);
          window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
          if (drop && target !== null) latest.current.onDrop(item, target);
        }
        setDrag(null);
        setDropKey(null);
        setPointer(null);
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape" || !active) return;
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        finish(false);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKeyDown, true);
      cancelRef.current = () => finish(false);
    },
    [container],
  );

  return { drag, dropKey, pointer, startDrag };
}
