import { useCallback, useEffect, useRef, useState } from "react";
import { invokeCommand } from "../commands";
import type { Invoke } from "../tools";

/** What Rust keeps for running in the background (`background.rs`); start on boot is read from the OS. */
export type BackgroundStatus = {
  closeToTray: boolean;
  startMinimized: boolean;
  launchAtStartup: boolean;
};

type Args = {
  invoke: Invoke;
  /** Reports a failure to save an option. */
  onError: (text: string) => void;
};

function message(error: unknown) {
  return typeof error === "string" ? error : error instanceof Error ? error.message : "The setting could not be saved.";
}

/**
 * The tray options: read once through `get_background` and saved through `set_background`. The
 * status stays `null` where the commands do not exist (the Settings page then hides the section).
 * A failed save puts the previous value back.
 */
export function useBackground({ invoke, onError }: Args) {
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  const current = useRef<BackgroundStatus | null>(null);
  current.current = status;

  useEffect(() => {
    let active = true;
    invokeCommand(invoke, "get_background")
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [invoke]);

  const update = useCallback(
    async (patch: Partial<BackgroundStatus>) => {
      const before = current.current;
      if (!before) return;
      const next = { ...before, ...patch };
      setStatus(next);
      try {
        setStatus(await invokeCommand(invoke, "set_background", next));
      } catch (error) {
        setStatus(before);
        onError(message(error));
      }
    },
    [invoke, onError],
  );

  const sendTest = useCallback(async () => {
    try {
      await invokeCommand(invoke, "show_notification", { title: "Scalable Capital Desktop", body: "Windows notifications are working." });
    } catch (error) {
      onError(`The Windows notification could not be shown: ${message(error)}`);
    }
  }, [invoke, onError]);

  return { status, update, sendTest };
}
