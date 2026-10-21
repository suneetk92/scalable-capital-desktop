import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { loadNavOrder, moveItem, type NavId } from "../nav";
import { writeStoredJson } from "../storage";
import { extension } from "../extensions";

/** The sidebar order (persisted) plus the drag-to-reorder and Alt+Up/Down handlers that change it. */
export function useNavOrder() {
  const [navOrder, setNavOrder] = useState<NavId[]>(() => loadNavOrder(extension.views ?? []));
  const [navDragId, setNavDragId] = useState<NavId | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const navSuppressClick = useRef(false);

  useEffect(() => {
    writeStoredJson("nav-order", navOrder);
  }, [navOrder]);

  function startNavDrag(event: ReactPointerEvent<HTMLButtonElement>, id: NavId) {
    if (event.button !== 0) return;
    const startY = event.clientY;
    let active = false;
    const onMove = (moveEvent: PointerEvent) => {
      if (!active) {
        if (Math.abs(moveEvent.clientY - startY) < 5) return;
        active = true;
        setNavDragId(id);
      }
      const items = Array.from(navRef.current?.querySelectorAll<HTMLElement>("[data-nav-id]") ?? []);
      const target = items.find((item) => {
        const rect = item.getBoundingClientRect();
        return moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom;
      });
      const targetId = target?.dataset.navId as NavId | undefined;
      if (targetId && targetId !== id) setNavOrder((current) => moveItem(current, id, targetId));
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (active) {
        navSuppressClick.current = true;
        window.setTimeout(() => {
          navSuppressClick.current = false;
        }, 0);
      }
      setNavDragId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  function onNavKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, id: NavId) {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    setNavOrder((current) => {
      const index = current.indexOf(id);
      const target = current[index + (event.key === "ArrowUp" ? -1 : 1)];
      return target ? moveItem(current, id, target) : current;
    });
    const button = event.currentTarget;
    window.requestAnimationFrame(() => button.focus());
  }

  return { navOrder, navDragId, navRef, navSuppressClick, startNavDrag, onNavKeyDown };
}

export type NavOrderState = ReturnType<typeof useNavOrder>;
