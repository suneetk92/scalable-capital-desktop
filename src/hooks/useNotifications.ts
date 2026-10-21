import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addNotification, removeNotification, type Notice, type NotificationItem } from "../notifications";
import { invokeCommand } from "../commands";
import type { Invoke } from "../tools";

const TOAST_MS = 6000;
const MAX_TOASTS = 4;

const KIND_TITLES = { ok: "Done", error: "Something went wrong", info: "Note" } as const;

type NotifyOptions = {
  /** Overrides whether the in-app toast is shown (default: the "Also show in the app" setting). */
  toast?: boolean;
  /** false when the caller already sent the Windows notification itself (default true). */
  desktop?: boolean;
};

/**
 * Keeps every notice in a history for the notification center. Each notice is sent as a Windows
 * notification; the in-app toast (the newest few, stacked) appears only when `inApp` is on or when
 * Windows could not show the notification. Toasts go away after a few seconds, except errors, which
 * stay until dismissed.
 */
export function useNotifications(invoke: Invoke, inApp: boolean) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [toastIds, setToastIds] = useState<number[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());
  const latest = useRef({ invoke, inApp });
  latest.current = { invoke, inApp };

  const dismissToast = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToastIds((current) => current.filter((item) => item !== id));
  }, []);

  const showToast = useCallback(
    (id: number, notice: Notice) => {
      setToastIds((current) => [...current, id].slice(-MAX_TOASTS));
      if (notice.kind !== "error")
        timers.current.set(
          id,
          window.setTimeout(() => dismissToast(id), TOAST_MS),
        );
    },
    [dismissToast],
  );

  const notify = useCallback(
    (notice: Notice, options?: NotifyOptions) => {
      const id = nextId.current++;
      setItems((current) => addNotification(current, notice, id, Date.now()));
      const wantsToast = options?.toast ?? latest.current.inApp;
      if (options?.desktop === false) {
        if (wantsToast) showToast(id, notice);
        return;
      }
      if (wantsToast) showToast(id, notice);
      // A Windows notification that cannot be shown falls back to the in-app toast.
      invokeCommand(latest.current.invoke, "show_notification", { title: notice.title ?? KIND_TITLES[notice.kind], body: notice.text }).catch(() => {
        if (!wantsToast) showToast(id, notice);
      });
    },
    [showToast],
  );

  const remove = useCallback(
    (id: number) => {
      dismissToast(id);
      setItems((current) => removeNotification(current, id));
    },
    [dismissToast],
  );

  const clear = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
    setToastIds([]);
    setItems([]);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const toasts = useMemo(() => toastIds.flatMap((id) => items.find((item) => item.id === id) ?? []), [toastIds, items]);
  return { items, toasts, notify, dismissToast, remove, clear };
}

export type Notifications = ReturnType<typeof useNotifications>;
