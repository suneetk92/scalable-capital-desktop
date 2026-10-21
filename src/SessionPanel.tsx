import type { ReactNode } from "react";
import { ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { useNow } from "./hooks/useSessionInfo";
import { btn, cx, IconButton } from "./ui";
import { describeAccessToken, describeRefreshToken, formatTimestamp, type SessionInfo } from "./session";

export type SessionState = {
  info: SessionInfo | null;
  renewing: boolean;
  error: string | null;
  renew: () => Promise<void>;
};

/** Account-card subtitle whose tooltip counts down the access token. It re-renders itself every second. */
export function AccessTokenHint({ info }: { info: SessionInfo | null }) {
  const now = useNow(info?.signedIn === true);
  return (
    <small className="truncate text-[1em] text-ink-muted" title={`Access token: ${describeAccessToken(info, now)}`}>
      Manage account
    </small>
  );
}

function Line({ label, value, tone, action }: { label: string; value: string; tone?: "warn"; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3.5 last:border-b-0 max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-1">
      <dt className="text-ink-strong">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className={cx("text-right tabular-nums max-[640px]:text-left", tone === "warn" ? "text-warn-ink" : "text-ink-soft")}>{value}</span>
        {action}
      </dd>
    </div>
  );
}

/** Settings → Session: how long the access and refresh tokens stay valid, with a live countdown. */
export function SessionPanel({ session, showDiagnostics, onCopyToken, onSignOut }: { session: SessionState; showDiagnostics: boolean; onCopyToken: () => void; onSignOut: () => void }) {
  const { info, renewing, error, renew } = session;
  const now = useNow(info?.signedIn === true);
  const copyButton = showDiagnostics ? (
    <IconButton label="Copy full access token" icon={ClipboardDocumentIcon} title="Copy full access token" className="size-8" onClick={onCopyToken} disabled={!info?.signedIn} />
  ) : undefined;
  const expired = info?.signedIn === true && info.accessExpiresAt !== null && info.accessExpiresAt <= now;
  return (
    <>
      <dl>
        <Line label="Status" value={info?.signedIn ? "Signed in" : "Signed out"} />
        <Line label="Signed in since" value={info?.signedIn ? formatTimestamp(info.signedInAt) : "–"} />
        <Line label="Access token" value={describeAccessToken(info, now)} tone={expired ? "warn" : undefined} action={copyButton} />
        <Line label="Refresh token" value={describeRefreshToken(info, now)} />
      </dl>
      <p className="border-t border-line py-3 text-ink-muted">
        The access token lasts about 20 minutes and is renewed with the refresh token without signing in again. Scalable does not publish how long the refresh token lives, so the app shows when it was
        last renewed and never guesses an expiry.
      </p>
      {error && (
        <p className="pb-3 text-danger-ink" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pb-4">
        <button className={btn.secondary} type="button" onClick={() => void renew()} disabled={!info?.signedIn || renewing}>
          {renewing ? "Renewing…" : "Renew now"}
        </button>
        <button className={btn.secondary} type="button" onClick={onSignOut} disabled={!info?.signedIn}>
          Sign out
        </button>
      </div>
      {showDiagnostics && (
        <p className="border-t border-line py-3 text-ink-muted">
          Data diagnostics is on, so the access token has a copy button. It gives access to your Scalable account. Treat it like a password and sign out when you are done.
        </p>
      )}
    </>
  );
}
