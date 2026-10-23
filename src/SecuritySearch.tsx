import { useEffect, useState } from "react";
import { invokeCommand } from "./commands";
import type { SecurityHit } from "./OrderDialog";
import { parseSearch } from "./screener";
import { errorText, type Invoke } from "./tools";
import { btn, EMPTY, field } from "./ui";

/** Fewest characters that start a Scalable security search from a table's search box. */
const MIN_CHARS = 3;
const MAX_HITS = 6;

/** Scalable's `search_securities` results for what is typed; nothing is asked for under three characters. */
function useSecurityHits(text: string, invoke: Invoke, enabled: boolean) {
  const query = text.trim();
  const active = enabled && query.length >= MIN_CHARS;
  const [state, setState] = useState<{
    query: string;
    hits: SecurityHit[];
    error: string | null;
  }>({ query: "", hits: [], error: null });

  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = window.setTimeout(() => {
      invokeCommand(invoke, "search_securities", { query })
        .then(
          (payload) =>
            current &&
            setState({
              query,
              hits: parseSearch(payload).slice(0, MAX_HITS),
              error: null,
            }),
        )
        .catch((failure: unknown) => current && setState({ query, hits: [], error: errorText(failure) }));
    }, 350);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [active, query, invoke]);

  return {
    active,
    loading: active && state.query !== query,
    hits: state.hits,
    error: state.error,
  };
}

/** A list of Scalable securities under a search box, so a table's search also finds what is not in it yet. */
export function SecuritySearchResults({
  text,
  invoke,
  enabled,
  watched,
  held,
  onOpen,
  onAddToWatchlist,
}: {
  text: string;
  invoke: Invoke;
  enabled: boolean;
  /** ISINs on the watchlist, or null when it could not be loaded. */
  watched: ReadonlySet<string> | null;
  held: ReadonlySet<string>;
  onOpen: (hit: SecurityHit) => void;
  /** Left out when the tool is not offered. */
  onAddToWatchlist?: (hit: SecurityHit) => void;
}) {
  const { active, loading, hits, error } = useSecurityHits(text, invoke, enabled);
  if (!active) return null;
  return (
    <div
      className="absolute top-[calc(100%+0.25rem)] right-0 z-[70] w-[min(26rem,calc(100vw-2rem))] rounded-panel border border-line-strong bg-surface p-1.5 shadow-[0_14px_40px_var(--pop-shadow)]"
      role="region"
      aria-label="Security search results"
    >
      <div className="px-2 pt-1 pb-1.5 font-title tracking-[.1em] text-ink-muted uppercase">Discover</div>
      {error ? (
        <p className={`${EMPTY} px-2 py-2`}>{error}</p>
      ) : loading ? (
        <p className={`${EMPTY} px-2 py-2`}>Searching…</p>
      ) : hits.length === 0 ? (
        <p className={`${EMPTY} px-2 py-2`}>No securities found.</p>
      ) : (
        <ul>
          {hits.map((hit) => (
            <li key={hit.isin} className="flex items-center justify-between gap-2 rounded-control px-2 py-1.5 hover:bg-hover">
              <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => onOpen(hit)}>
                <strong className="block truncate text-ink-strong">{hit.name}</strong>
                <small className={field.hint}>{hit.isin}</small>
              </button>
              {held.has(hit.isin) ? (
                <small className={field.hint}>In portfolio</small>
              ) : watched?.has(hit.isin) ? (
                <small className={field.hint}>On watchlist</small>
              ) : (
                watched &&
                onAddToWatchlist && (
                  <button className={btn.trade} type="button" onClick={() => onAddToWatchlist(hit)}>
                    Add to watchlist
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
