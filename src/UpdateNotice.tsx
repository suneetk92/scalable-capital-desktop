import { XMarkIcon } from "@heroicons/react/24/outline";
import { btn, cx, IconButton } from "./ui";
import { progressPercent, statusMessage, type UpdateInfo, type UpdateState } from "./updates";

type Props = {
  info: UpdateInfo;
  state: UpdateState;
  onInstall: () => void;
  onOpenReleasePage: () => void;
  onDismiss: () => void;
};

/** Dismissible notice for a newer version: installs it when this install can, otherwise links to the download page. */
export function UpdateNotice({ info, state, onInstall, onOpenReleasePage, onDismiss }: Props) {
  const downloading = state.status === "downloading";
  const percent = state.status === "downloading" ? progressPercent(state.received, state.total) : null;
  return (
    <div role="status" className="mb-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-accent-line bg-accent-bg px-3 py-2.5 text-ink-body">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink-strong">Version {info.version} is available</p>
        {state.status === "error" && <p className="break-words text-down">{state.message}</p>}
        {downloading && (
          <div className="mt-1 flex items-center gap-2.5">
            <progress className="h-1.5 w-48 accent-accent" max={100} value={percent ?? undefined} aria-label="Download progress" />
            <span className="text-ink-muted">{statusMessage(state)}</span>
          </div>
        )}
        {!downloading && !info.canInstall && <p className="text-ink-muted">This install cannot update itself. Download the new version from the download page.</p>}
      </div>
      {info.canInstall && (
        <button className={cx(btn.primary, "h-[2.2rem]")} type="button" onClick={onInstall} disabled={downloading}>
          Install and restart
        </button>
      )}
      {info.releaseUrl && (
        <button className={info.canInstall ? btn.link : btn.secondary} type="button" onClick={onOpenReleasePage}>
          {info.canInstall ? "Download page" : "Open download page"}
        </button>
      )}
      <IconButton label="Dismiss" icon={XMarkIcon} tone="muted" size="md" className="-m-1" onClick={onDismiss} disabled={downloading} />
    </div>
  );
}
