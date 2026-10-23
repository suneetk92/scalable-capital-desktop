import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";

/** Rust forwards a link that a widget tried to open in a new window (`src-tauri/src/links.rs`). It opens only after the user confirms. */
export function useExternalLink(onError: (text: string) => void) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<string>("external-link-request", (event) => setUrl(event.payload));
    return () => void unlisten.then((stop) => stop());
  }, []);

  const confirm = useCallback(() => {
    if (!url) return;
    setUrl(null);
    void openUrl(url).catch((error: unknown) => onError(String(error)));
  }, [url, onError]);

  return { url, confirm, cancel: useCallback(() => setUrl(null), []) };
}
