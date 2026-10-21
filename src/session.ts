import { formatDateTime } from "./format";

/** What the backend reports about the sign-in. It never contains a token. */
export type SessionInfo = {
  signedIn: boolean;
  signedInAt: number | null;
  accessExpiresAt: number | null;
  refreshIssuedAt: number | null;
  /** `null` means Scalable does not publish the refresh-token lifetime. */
  refreshExpiresAt: number | null;
};

const NOT_PUBLISHED = "expiry not published by Scalable";

/** "45 s", "14 min 05 s", "3 h 12 min", "2 d 4 h". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")} min`;
  return `${Math.floor(seconds / 86400)} d ${Math.floor((seconds % 86400) / 3600)} h`;
}

export function describeAccessToken(info: SessionInfo | null, now: number): string {
  if (!info?.signedIn) return "Signed out";
  if (info.accessExpiresAt === null) return "Validity unknown";
  const left = info.accessExpiresAt - now;
  if (left <= 0) return "Expired, renews automatically on the next request";
  return `Valid for ${formatDuration(left)}, renews automatically`;
}

export function describeRefreshToken(info: SessionInfo | null, now: number): string {
  if (!info?.signedIn) return "Signed out";
  if (info.refreshExpiresAt !== null) {
    const left = info.refreshExpiresAt - now;
    return left <= 0 ? "Expired, sign in again" : `Expires in ${formatDuration(left)}`;
  }
  if (info.refreshIssuedAt !== null) return `Last renewed ${formatDuration(now - info.refreshIssuedAt)} ago, ${NOT_PUBLISHED}`;
  return `Renewal time unknown, ${NOT_PUBLISHED}`;
}

export function formatTimestamp(seconds: number | null): string {
  return formatDateTime(seconds === null ? null : seconds * 1000);
}
