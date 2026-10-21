import { Bars3Icon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import type { Notifications } from "./hooks/useNotifications";
import { NotificationCenter } from "./NotificationCenter";
import { IconButton, LoadBar } from "./ui";

export function TopBar({
  busy,
  notifications,
  onOpenMenu,
  onOpenPalette,
}: {
  /** Anything is loading: the dashboard or extension data. */
  busy: boolean;
  notifications: Notifications;
  onOpenMenu: () => void;
  onOpenPalette: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-[3.8667rem] items-center border-b border-line bg-chrome px-[2.0667rem] max-[640px]:px-4">
      <LoadBar active={busy} />
      <div className="flex items-center gap-2.5">
        <IconButton label="Open menu" icon={Bars3Icon} className="min-[641px]:hidden" onClick={onOpenMenu} />
        <button
          className="flex h-9 w-72 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-inset px-2.5 text-ink-muted hover:border-line-hover max-[900px]:w-auto"
          type="button"
          onClick={onOpenPalette}
          aria-label="Open command palette (Ctrl+P)"
          title="Jump to a page, run an action or find a security (Ctrl+P)"
        >
          <MagnifyingGlassIcon className="size-[1.2rem] shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left max-[900px]:hidden">Search or jump to…</span>
          <kbd className="shrink-0 rounded-[0.2rem] border border-line-strong bg-raised px-1 py-px text-[1em] text-ink-faint max-[900px]:hidden">Ctrl+P</kbd>
        </button>
      </div>
      <div className="ml-auto">
        <NotificationCenter notifications={notifications} />
      </div>
    </header>
  );
}
