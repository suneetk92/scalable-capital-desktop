import { XMarkIcon } from "@heroicons/react/20/solid";
import { BellIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Notifications } from "./hooks/useNotifications";
import { formatAge } from "./notifications";
import { btn, cx, iconButtonClass, TOAST_KINDS } from "./ui";

/** Bell button for the top bar with a panel that lists every notification of this session, newest first. */
export function NotificationCenter({ notifications }: { notifications: Notifications }) {
  const { items, remove, clear } = notifications;
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const count = items.length;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <div ref={root} className="relative">
      <button
        className={cx(iconButtonClass(), "relative", open && "bg-hover text-ink-strong")}
        type="button"
        aria-label={count > 0 ? `Notifications, ${count}` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Notifications"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <BellIcon aria-hidden="true" />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 grid h-[1.3em] min-w-[1.3em] place-items-center rounded-full bg-sell px-1 text-[0.75em] leading-none font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute top-full right-0 z-50 mt-2 w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-panel bg-surface shadow-[0_25px_50px_-12px_var(--pop-shadow)] outline-1 outline-ink-heading/10 animate-fade-in"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <strong className="font-semibold text-ink-heading">Notifications</strong>
            {items.length > 0 && (
              <button className={btn.link} type="button" onClick={clear}>
                Clear all
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="grid justify-items-center gap-2 px-6 py-10 text-center text-ink-muted">
              <BellIcon aria-hidden="true" className="size-8" />
              <p className="font-medium text-ink-body">No notifications yet</p>
              <p>Price alerts you add or remove, alerts that trigger and the results of your actions show up here.</p>
            </div>
          ) : (
            <ul className="max-h-[min(70vh,30rem)] divide-y divide-line overflow-y-auto">
              {items.map((item) => {
                const { Icon, color, title } = TOAST_KINDS[item.kind];
                return (
                  <li key={item.id} className={"group flex items-start gap-3 px-4 py-3"}>
                    <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-medium text-ink-heading">{item.title ?? title}</p>
                        <time className="shrink-0 text-[0.9em] text-ink-faint" dateTime={new Date(item.at).toISOString()}>
                          {formatAge(item.at, now)}
                        </time>
                      </div>
                      <p className="mt-0.5 break-words text-ink-body">{item.text}</p>
                      {item.detail && <p className="mt-0.5 text-[0.9em] text-ink-muted">{item.detail}</p>}
                    </div>
                    <button
                      type="button"
                      aria-label="Remove notification"
                      onClick={() => remove(item.id)}
                      className="-m-1 shrink-0 cursor-pointer rounded-control p-1 text-ink-faint opacity-0 group-hover:opacity-100 hover:text-ink-body focus-visible:opacity-100"
                    >
                      <XMarkIcon aria-hidden="true" className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
