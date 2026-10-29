import { Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { invokeCommand } from "../commands";
import type { Invoke } from "../tools";
import { checked, IDLE, isReinstall, pendingInfo, withProgress, type UpdateInfo, type UpdateProgress, type UpdateState } from "../updates";

type Args = {
  invoke: Invoke;
  /** The "Check for updates on launch" setting. */
  launchCheck: boolean;
  /** Reports a failure of "Open download page". */
  onError: (text: string) => void;
};

/** A reinstall is the user's own request, so it needs no notice. */
function noticeInfo(info: UpdateInfo | null) {
  return info && !isReinstall(info) ? info : null;
}

function message(error: unknown) {
  return typeof error === "string" ? error : error instanceof Error ? error.message : "The update check failed.";
}

/**
 * Looks for a newer signed version through the Rust `check_for_update` command: once at launch
 * when the setting is on (silently, and never in a dev build), and whenever the user asks. The
 * install streams its download progress and restarts the app. Only Rust talks to the update server.
 */
export function useUpdater({ invoke, launchCheck, onError }: Args) {
  const [state, setState] = useState<UpdateState>(IDLE);
  const [dismissed, setDismissed] = useState(false);
  const busy = useRef(false);
  const launched = useRef(false);

  const check = useCallback(
    async (silent: boolean, reinstall = false) => {
      if (busy.current) return;
      busy.current = true;
      if (!silent) setState({ status: "checking" });
      try {
        const next = checked(await invokeCommand(invoke, "check_for_update", { reinstall }));
        setDismissed(false);
        setState(next);
      } catch (error) {
        setState(silent ? IDLE : { status: "error", message: message(error) });
      } finally {
        busy.current = false;
      }
    },
    [invoke],
  );

  useEffect(() => {
    if (!launchCheck || launched.current || import.meta.env.DEV) return;
    launched.current = true;
    void check(true);
  }, [launchCheck, check]);

  const install = useCallback(async () => {
    const info = pendingInfo(state);
    if (!info || !info.canInstall || busy.current) return;
    busy.current = true;
    const channel = new Channel<UpdateProgress>();
    channel.onmessage = (event) => setState((current) => withProgress(current, event));
    setState({ status: "downloading", info, received: 0, total: null });
    try {
      await invokeCommand(invoke, "install_update", { onProgress: channel });
      setState(IDLE);
    } catch (error) {
      setDismissed(false);
      setState({ status: "error", message: message(error), info });
    } finally {
      busy.current = false;
    }
  }, [invoke, state]);

  const openReleasePage = useCallback(() => {
    const url = pendingInfo(state)?.releaseUrl;
    if (url) void openUrl(url).catch((error: unknown) => onError(message(error)));
  }, [state, onError]);

  return {
    state,
    /** The version the notice is about, until the user dismisses it. */
    notice: dismissed ? null : noticeInfo(pendingInfo(state)),
    check: useCallback(() => check(false), [check]),
    reinstall: useCallback(() => check(false, true), [check]),
    install,
    openReleasePage,
    dismiss: useCallback(() => setDismissed(true), []),
  };
}
