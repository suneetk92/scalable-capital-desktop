import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { ArrowRightStartOnRectangleIcon, EllipsisHorizontalIcon, ShieldCheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { AVATAR, Brand } from "./Brand";
import { DropdownMenu, type MenuEntry } from "./controls";
import type { NavOrderState } from "./hooks/useNavOrder";
import { NAV_ITEMS, type CoreView, type NavCounts, type NavId, type View } from "./nav";
import { extension, type ExtensionView } from "./extensions";
import { AccessTokenHint } from "./SessionPanel";
import type { SessionInfo } from "./session";
import { isRateLimited, type Connection } from "./types";
import { btn, cx, IconButton } from "./ui";

const NAV_ITEM =
  "flex h-10 w-full cursor-pointer select-none items-center gap-[0.7333rem] rounded-control px-2.5 text-left transition-colors max-[900px]:justify-center max-[900px]:px-0 [&>svg]:size-[1.4rem] [&>svg]:shrink-0 [&>svg]:stroke-[1.65] max-[900px]:[&>svg]:size-[1.2rem] [&>span]:max-[900px]:hidden [&>span:nth-child(2)]:flex-1";

const MOBILE_NAV_ITEM = "flex h-11 w-full cursor-pointer items-center gap-3 rounded-control px-2.5 text-left [&>svg]:size-5 [&>svg]:shrink-0 [&>span:nth-child(2)]:flex-1";

function navItemClass(active: boolean, dragging: boolean, mobile = false) {
  if (mobile) return cx(MOBILE_NAV_ITEM, active ? "bg-hover text-ink-heading shadow-[inset_2px_0_var(--color-accent)]" : "text-ink-soft hover:bg-raised hover:text-ink-strong");
  if (dragging) return cx(NAV_ITEM, "cursor-grabbing! bg-hover text-ink-heading opacity-[.85] shadow-[0_0_0_1px_var(--color-accent)]");
  return cx(NAV_ITEM, active ? "bg-hover text-ink-heading shadow-[inset_2px_0_var(--color-accent)]" : "text-ink-soft hover:bg-raised hover:text-ink-strong");
}

type AccountMenu = { header: ReactNode; items: (MenuEntry | "divider")[]; name: string; initials: string };

export function Sidebar({
  view,
  counts,
  nav,
  connection,
  sessionInfo,
  account,
  onSelect,
  onCheckConnection,
}: {
  view: View;
  counts: NavCounts;
  nav: NavOrderState;
  connection: Connection;
  sessionInfo: SessionInfo | null;
  account: AccountMenu;
  onSelect: (id: NavId) => void;
  onCheckConnection: () => void;
}) {
  const { navOrder, navDragId, navRef, navSuppressClick, startNavDrag, onNavKeyDown } = nav;
  const navItems: Record<string, { label: string; icon: (typeof NAV_ITEMS)[CoreView]["icon"] }> = {
    ...NAV_ITEMS,
    ...Object.fromEntries((extension.views ?? []).map(({ id, label, icon }: ExtensionView) => [id, { label, icon }])),
  };
  return (
    <aside className="flex h-screen w-[16.6667rem] flex-none flex-col overflow-y-auto border-r border-line bg-chrome px-3.5 pt-[1.4667rem] pb-3.5 max-[1080px]:w-[14.2667rem] max-[900px]:w-[4.1333rem] max-[900px]:px-2.5 max-[640px]:hidden">
      <Brand size="sm" collapsible className="shrink-0 max-[900px]:justify-center" />
      <div className="mx-2.5 mt-12 mb-[0.7333rem] shrink-0 font-bold tracking-[.15em] text-ink-faint uppercase max-[900px]:hidden">Workspace</div>
      <nav
        className={cx("grid min-h-0 flex-1 content-start gap-1 overflow-y-auto max-[900px]:mt-8", navDragId && "cursor-grabbing [&_button]:cursor-grabbing")}
        aria-label="Main navigation"
        ref={navRef}
      >
        {navOrder
          .filter((id) => id in navItems)
          .map((id) => {
            const item = navItems[id];
            if (!item) return null;
            const Icon = item.icon;
            const count = counts[id];
            return (
              <button
                key={id}
                data-nav-id={id}
                className={navItemClass(view === id, navDragId === id)}
                type="button"
                aria-label={count === undefined ? item.label : `${item.label}, ${count}`}
                title={`${item.label}. Drag to reorder, or use Alt+↑ and Alt+↓`}
                onPointerDown={(event) => startNavDrag(event, id)}
                onKeyDown={(event) => onNavKeyDown(event, id)}
                onClick={() => {
                  if (navSuppressClick.current) return;
                  onSelect(id);
                }}
              >
                <Icon />
                <span>{item.label}</span>
                {count !== undefined && <span className="text-ink-muted">{count}</span>}
              </button>
            );
          })}
      </nav>
      <div className="mt-auto shrink-0 pt-3">
        <button
          type="button"
          onClick={() => onCheckConnection()}
          title={connection.state === "error" ? `${connection.detail ?? "Connection problem"} (click to retry)` : "Check connection to Scalable (MCP ping)"}
          aria-label={`Scalable connection: ${connection.state === "connected" ? "connected" : connection.state === "error" ? "problem" : "checking"}`}
          className="mx-0.5 mb-3 flex w-[calc(100%-0.2667rem)] cursor-pointer items-center gap-[0.6rem] rounded-panel border border-line bg-surface px-[0.6rem] py-2.5 text-left font-[inherit] text-[length:inherit] transition hover:bg-hover max-[900px]:justify-center max-[900px]:px-0 max-[900px]:py-[0.6rem]"
        >
          <span
            className={`size-[0.4667rem] shrink-0 rounded-full ${connection.state === "connected" ? "bg-accent shadow-[0_0_9px_color-mix(in_srgb,var(--color-accent)_55%,transparent)]" : connection.state === "error" ? "bg-sell shadow-[0_0_9px_color-mix(in_srgb,var(--color-sell)_55%,transparent)]" : "animate-pulse bg-ink-faint"}`}
          />
          <div className="grid min-w-0 flex-1 gap-[0.2rem] max-[900px]:hidden">
            <strong className="font-semibold text-ink-body">Scalable Capital</strong>
            <small className={`truncate text-[1em] ${connection.state === "error" ? "text-danger-ink" : "text-ink-muted"}`}>
              {connection.state === "connected"
                ? "Account connected"
                : isRateLimited(connection)
                  ? "Rate limited, retry soon"
                  : connection.state === "error"
                    ? "Connection problem"
                    : "Checking connection…"}
            </small>
          </div>
          <ShieldCheckIcon className={`size-5 max-[900px]:hidden ${connection.state === "error" ? "text-danger-ink" : "text-ink-accent"}`} aria-hidden="true" />
        </button>
        <DropdownMenu
          anchor={{ to: "top start", gap: 6, padding: 8 }}
          panelClassName="w-60"
          header={account.header}
          items={account.items}
          buttonLabel={`${account.name}, account menu`}
          buttonClassName="group flex w-full cursor-pointer items-center gap-[0.6rem] border-t border-line px-[0.3333rem] pt-[0.6rem] pb-0.5 text-left hover:bg-raised max-[900px]:justify-center max-[900px]:pt-2.5"
          button={
            <>
              <span className={AVATAR}>{account.initials}</span>
              <span className="grid min-w-0 flex-1 gap-[0.2rem] max-[900px]:hidden">
                <strong className="truncate font-semibold text-ink-body">{account.name}</strong>
                <AccessTokenHint info={sessionInfo} />
              </span>
              <span
                className="grid size-7 place-items-center rounded-control text-ink-muted group-hover:bg-hover group-hover:text-ink-strong max-[900px]:hidden [&_svg]:size-[1.4667rem]"
                aria-hidden="true"
              >
                <EllipsisHorizontalIcon />
              </span>
            </>
          }
        />
      </div>
    </aside>
  );
}

export function MobileNav({
  view,
  counts,
  navOrder,
  onSelect,
  onClose,
  onSignOut,
}: {
  view: View;
  counts: NavCounts;
  navOrder: NavId[];
  onSelect: (id: NavId) => void;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const navItems: Record<string, { label: string; icon: (typeof NAV_ITEMS)[CoreView]["icon"] }> = {
    ...NAV_ITEMS,
    ...Object.fromEntries((extension.views ?? []).map(({ id, label, icon }: ExtensionView) => [id, { label, icon }])),
  };
  return (
    <Dialog open onClose={onClose} className="relative z-50 min-[641px]:hidden">
      <DialogBackdrop className="fixed inset-0 bg-gray-900/60 animate-fade-in" />
      <div className="fixed inset-y-0 left-0 flex w-[19.3333rem] max-w-full">
        <DialogPanel className="flex w-full flex-col overflow-y-auto border-r border-line bg-chrome px-3.5 pt-[1.4667rem] pb-3.5 animate-slide-in-left">
          <div className="flex items-center justify-between">
            <Brand size="sm" />
            <IconButton label="Close menu" icon={XMarkIcon} onClick={onClose} />
          </div>
          <nav className="mt-8 grid gap-1" aria-label="Main navigation">
            {navOrder
              .filter((id) => id in navItems)
              .map((id) => {
                const item = navItems[id];
                if (!item) return null;
                const Icon = item.icon;
                const count = counts[id];
                return (
                  <button key={id} className={navItemClass(view === id, false, true)} type="button" onClick={() => onSelect(id)}>
                    <Icon />
                    <span>{item.label}</span>
                    {count !== undefined && <span className="text-ink-muted">{count}</span>}
                  </button>
                );
              })}
          </nav>
          <div className="mt-auto pt-6">
            <button className={cx(btn.secondary, "w-full justify-center")} type="button" onClick={onSignOut}>
              <ArrowRightStartOnRectangleIcon /> Sign out
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
