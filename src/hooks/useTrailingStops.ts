import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { invokeCommand } from "../commands";
import { parseTrailingList, type TrailingList } from "../trailing";
import type { Invoke } from "../tools";

/** Sent by the backend whenever a stop or the problem line changes (`src-tauri/src/mcp/trailing`). */
const CHANGED_EVENT = "trailing-stops-changed";
/** A safety net only, in case an event is missed; it runs only while visible with an active or selling stop. */
const FALLBACK_MS = 60_000;

/** The trailing stops the Rust backend keeps and watches; re-read on changes, focus and visibility, with a slow fallback while visible and active. */
export function useTrailingStops(invoke: Invoke) {
  const [list, setList] = useState<TrailingList>({ stops: [], problem: null, lastChecked: null });
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");

  const reload = useCallback(async () => {
    try {
      setList(parseTrailingList(await invokeCommand(invoke, "list_trailing_stops")));
    } catch {
      // The next refresh tries again.
    } finally {
      setLoaded(true);
    }
  }, [invoke]);

  useEffect(() => {
    if (document.visibilityState === "visible") void reload();
    const onFocus = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const onVisibilityChange = () => {
      const nextVisible = document.visibilityState === "visible";
      setVisible(nextVisible);
      if (nextVisible) void reload();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    let stopped = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      listen(CHANGED_EVENT, () => {
        if (document.visibilityState === "visible") void reload();
      })
        .then((off) => {
          if (stopped) off();
          else unlisten = off;
        })
        .catch(() => undefined);
    }
    return () => {
      stopped = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unlisten?.();
    };
  }, [reload]);

  const watching = list.stops.some((stop) => stop.status === "active" || stop.status === "selling");
  useEffect(() => {
    if (!visible || !watching) return;
    const timer = window.setInterval(() => void reload(), FALLBACK_MS);
    return () => window.clearInterval(timer);
  }, [visible, watching, reload]);

  return { ...list, loaded, reload };
}
