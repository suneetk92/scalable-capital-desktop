import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";
import { errorText } from "../tools";

const DESKTOP_REQUIRED_MESSAGE =
  "Scalable Capital sign-in only works inside the Scalable Capital Desktop window. You are viewing this page in a normal browser. Stop the browser tab, then run `npm run tauri dev` from the project folder and use the window that opens.";

export function hasTauriRuntime() {
  return isTauri() || (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);
}

/** The `invoke` every page and hook receives; outside the desktop window it fails with a clear message. */
export function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriRuntime()) return Promise.reject(new Error(DESKTOP_REQUIRED_MESSAGE));
  return tauriInvoke<T>(command, args);
}

export function getErrorMessage(error: unknown) {
  return errorText(error, "Something went wrong while connecting to Scalable Capital.");
}
