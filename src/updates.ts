/** What `check_for_update` returns when a newer signed version exists (see src-tauri/src/updates.rs). */
export type UpdateInfo = {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
  /** False for the portable exe, deb and rpm installs: the notice then links to the download page. */
  canInstall: boolean;
  releaseUrl: string | null;
};

/** Progress events `install_update` streams while it downloads. */
export type UpdateProgress = { event: "started"; total: number | null } | { event: "chunk"; received: number } | { event: "finished" };

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "upToDate" }
  | { status: "available"; info: UpdateInfo }
  | { status: "downloading"; info: UpdateInfo; received: number; total: number | null }
  /** `info` is kept when an install failed, so the notice can offer a retry. */
  | { status: "error"; message: string; info?: UpdateInfo };

export const IDLE: UpdateState = { status: "idle" };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Reads the command result defensively; anything without a version means "no update". */
export function parseUpdateInfo(raw: unknown): UpdateInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const version = text(record.version);
  if (!version) return null;
  return {
    version,
    currentVersion: text(record.currentVersion) ?? "",
    notes: text(record.notes),
    date: text(record.date),
    canInstall: record.canInstall === true,
    releaseUrl: text(record.releaseUrl),
  };
}

/** Result of a check: the notice for a new version, otherwise "up to date". */
export function checked(raw: unknown): UpdateState {
  const info = parseUpdateInfo(raw);
  return info ? { status: "available", info } : { status: "upToDate" };
}

export function withProgress(state: UpdateState, event: UpdateProgress): UpdateState {
  if (state.status !== "available" && state.status !== "downloading") return state;
  const { info } = state;
  const previous = state.status === "downloading" ? state : { received: 0, total: null };
  if (event.event === "started") return { status: "downloading", info, received: 0, total: event.total };
  if (event.event === "chunk") return { status: "downloading", info, received: event.received, total: previous.total };
  return { status: "downloading", info, received: previous.total ?? previous.received, total: previous.total };
}

/** The check found the running version again: installing it is a reinstall. */
export function isReinstall(info: UpdateInfo): boolean {
  return info.version === info.currentVersion;
}

/** The version a notice or an install failure is about, if any. */
export function pendingInfo(state: UpdateState): UpdateInfo | null {
  if (state.status === "available" || state.status === "downloading") return state.info;
  if (state.status === "error") return state.info ?? null;
  return null;
}

/** 0 to 100, or null while the size is unknown. */
export function progressPercent(received: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((received / total) * 100)));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One line for the Settings status row. */
export function statusMessage(state: UpdateState): string {
  switch (state.status) {
    case "idle":
      return "";
    case "checking":
      return "Checking for updates…";
    case "upToDate":
      return "You're up to date.";
    case "available":
      return isReinstall(state.info) ? `Version ${state.info.version} is ready to reinstall.` : `Version ${state.info.version} is available.`;
    case "downloading": {
      const percent = progressPercent(state.received, state.total);
      return percent === null ? `Downloading version ${state.info.version}… ${formatBytes(state.received)}` : `Downloading version ${state.info.version}… ${percent}%`;
    }
    case "error":
      return state.message;
  }
}
