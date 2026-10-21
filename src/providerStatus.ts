/** The outside services the app depends on, each of which can fail on its own. */
export type Provider = "scalable" | "updater" | (string & {});

/** `ok`: the last attempt worked (or none was made); `stale`: it failed, the data from an earlier success is kept; `failed`: it failed and there is nothing earlier. */
type ProviderState = "ok" | "stale" | "failed";

type ProviderInfo = {
  state: ProviderState;
  /** When the data last arrived, as epoch milliseconds. */
  lastSuccess: number | null;
  /** What the last failure said, without anything that looks like a secret. */
  lastError: string | null;
};

export type ProviderStatuses = Record<string, ProviderInfo>;

export type ProviderEvent = { type: "success"; provider: Provider; at: number } | { type: "failure"; provider: Provider; message: string };

const CORE_PROVIDERS: readonly Provider[] = ["scalable", "updater"];

const IDLE_INFO: ProviderInfo = { state: "ok", lastSuccess: null, lastError: null };

export const INITIAL_STATUSES: ProviderStatuses = { scalable: IDLE_INFO, updater: IDLE_INFO };

const MAX_ERROR_LENGTH = 160;

/** One line of an error message: tokens, bearer headers and long key-like strings are masked, and it is cut short. */
export function sanitizeError(message: string): string {
  const clean = message
    .replace(/\bBearer\s+\S+/gi, "Bearer [hidden]")
    .replace(/\b(access_token|refresh_token|id_token|token|authorization|api[_-]?key|secret|password)(\s*[=:]\s*)\S+/gi, "$1$2[hidden]")
    .replace(/\beyJ[\w-]*\.[\w-]*\.[\w-]*/g, "[hidden]")
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, "[hidden]")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > MAX_ERROR_LENGTH ? `${clean.slice(0, MAX_ERROR_LENGTH - 1)}…` : clean;
}

/** A success clears the error; a failure keeps the time of the last success, so the data it stands for can still be dated. */
export function reduceProviderStatus(statuses: ProviderStatuses, event: ProviderEvent): ProviderStatuses {
  const current = statuses[event.provider] ?? IDLE_INFO;
  if (event.type === "success") return { ...statuses, [event.provider]: { state: "ok", lastSuccess: event.at, lastError: null } };
  const next: ProviderInfo = { state: current.lastSuccess === null ? "failed" : "stale", lastSuccess: current.lastSuccess, lastError: sanitizeError(event.message) };
  return { ...statuses, [event.provider]: next };
}

/** HH:MM in the local time zone. */
function clockTime(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

type StatusLine = { provider: Provider; state: ProviderState; text: string; detail: string | null };

function providerName(provider: Provider, names: Readonly<Record<string, string>>): string {
  if (provider === "scalable") return "Scalable";
  if (provider === "updater") return "Update check";
  return names[provider] ?? provider.replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function textOf(provider: Provider, info: ProviderInfo, names: Readonly<Record<string, string>>): string {
  const since = info.lastSuccess === null ? "" : clockTime(info.lastSuccess);
  if (provider === "updater") return info.state === "stale" ? `Update check failed · last checked ${since}` : "Update check failed";
  return info.state === "stale" ? `${providerName(provider, names)} data as of ${since} · refresh failed` : `${providerName(provider, names)} unavailable`;
}

/** The providers that are not fine, one line each, for the status indicator. Empty when everything works. */
export function statusLines(statuses: ProviderStatuses, names: Readonly<Record<string, string>> = {}): StatusLine[] {
  return [...CORE_PROVIDERS, ...Object.keys(statuses).filter((provider) => !CORE_PROVIDERS.includes(provider))]
    .filter((provider) => statuses[provider]?.state !== "ok")
    .map((provider) => {
      const info = statuses[provider];
      return { provider, state: info.state, text: textOf(provider, info, names), detail: info.lastError };
    });
}
