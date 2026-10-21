import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { SessionInfo } from "../session";
import { invokeCommand } from "../commands";

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Current time in whole seconds, updated every second while `active`. Use it only in small components. */
export function useNow(active: boolean) {
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    if (!active) return;
    setNow(nowSeconds());
    const timer = window.setInterval(() => setNow(nowSeconds()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** Token validity from the backend. Re-read whenever `reloadKey` changes (after every dashboard load). */
export function useSessionInfo(active: boolean, reloadKey: number) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !isTauri()) {
      setInfo(null);
      return;
    }
    let current = true;
    invokeCommand(invoke, "get_session_info")
      .then((value) => {
        if (current) {
          setInfo(value);
          setError(null);
        }
      })
      .catch((reason) => {
        if (current) setError(String(reason));
      });
    return () => {
      current = false;
    };
  }, [active, reloadKey]);

  const renew = useCallback(async () => {
    setRenewing(true);
    try {
      setInfo(await invokeCommand(invoke, "refresh_session"));
      setError(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRenewing(false);
    }
  }, []);

  return { info, renewing, error, renew };
}
