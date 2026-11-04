import { Tab, TabGroup, TabList } from "@headlessui/react";
import { useMemo, useState } from "react";
import { oneOf, useStoredState } from "../hooks/useStoredState";
import { readStoredJson, writeStoredJson } from "../storage";
import { isRec, type Rec } from "../response";
import { extension, useExtensionIsinLogos } from "../extensions";
import { formatDateTime, formatMoney } from "../format";
import { type Common } from "../types";
import { Badge, btn, cx, EMPTY, field, RECORD_TABLE, SCROLL_X, SecurityCell, securityTypeTone, TABS, TD_NUM, tabClass } from "../ui";
import { ToolRunnerPanel } from "../ToolViews";
import { humanize } from "../tools";
import { parseFoundDerivatives, parseFoundSecurities, type FoundDerivative, type FoundSecurity } from "../discover";
import { Section } from "./shared";
import { TOOL } from "../commands";

export type { FoundSecurity } from "../discover";

type DiscoverTool = "search_securities" | "search_derivatives";

function savedSearch(tool: DiscoverTool): Rec | null {
  const value = readStoredJson(`discover.last-search.${tool}`);
  return isRec(value) ? value : null;
}

function SecurityResults({
  result,
  common,
  watched,
  held,
  onOpen,
  onTrade,
}: {
  result: unknown;
  common: Common;
  watched: Set<string> | null;
  held: ReadonlySet<string>;
  onOpen: (security: FoundSecurity) => void;
  onTrade: (security: FoundSecurity) => void;
}) {
  const { actions } = common;
  const hits = useMemo(() => parseFoundSecurities(result), [result]);
  const shown = hits.slice(0, 40);
  const logos = useExtensionIsinLogos({ invoke: common.invoke, isins: shown.map((hit) => hit.isin), enabled: Boolean(extension.logos?.useIsinLogos) });
  if (hits.length === 0) return <p className={EMPTY}>Nothing found.</p>;
  return (
    <div className={SCROLL_X}>
      <table className={RECORD_TABLE}>
        <thead>
          <tr>
            <th>Security</th>
            <th>Type</th>
            <th className={TD_NUM}>Price</th>
            <th>Quote</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((hit) => (
            <tr
              key={hit.isin}
              className="cursor-pointer"
              tabIndex={0}
              aria-label={`Open ${hit.name} details`}
              onClick={() => onOpen(hit)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                onOpen(hit);
              }}
            >
              <td>
                <SecurityCell
                  logo={logos.get(hit.isin.toUpperCase())}
                  initials={(hit.symbol || hit.name).slice(0, 2).toUpperCase()}
                  title={
                    <button
                      className="cursor-pointer text-right hover:text-ink-accent-bright hover:underline"
                      type="button"
                      title="Open details, chart and news"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(hit);
                      }}
                    >
                      {hit.symbol || hit.name}
                    </button>
                  }
                  subtitle={hit.symbol && hit.name !== hit.symbol ? `${hit.name} · ${hit.isin}` : hit.isin}
                />
              </td>
              <td>{hit.type ? <Badge tone={securityTypeTone(hit.type)}>{humanize(hit.type)}</Badge> : "—"}</td>
              <td className={TD_NUM}>{hit.lastPrice === null || hit.lastPrice === undefined ? "—" : formatMoney(hit.lastPrice, hit.currency)}</td>
              <td>
                <span className="flex items-center gap-1.5">
                  {hit.quoteAt ? formatDateTime(hit.quoteAt) : "—"}
                  {hit.isOutdated && <Badge>Delayed</Badge>}
                </span>
              </td>
              <td>
                {watched === null ? (
                  <small className={field.hint} title="Your watchlist could not be loaded. Refresh to check.">
                    Watchlist unknown
                  </small>
                ) : watched.has(hit.isin) ? (
                  <small className={field.hint}>On watchlist</small>
                ) : held.has(hit.isin) ? (
                  <small className={field.hint}>In portfolio</small>
                ) : (
                  "—"
                )}
              </td>
              <td>
                <span className="flex items-center gap-1.5">
                  {watched && actions.has(TOOL.addWatchlistItem) && !watched.has(hit.isin) && !held.has(hit.isin) && (
                    <button
                      className={btn.trade}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void actions.run(TOOL.addWatchlistItem, { isin: hit.isin }, { done: `${hit.name} added to your watchlist` });
                      }}
                    >
                      Add to watchlist
                    </button>
                  )}
                  {common.tradingEnabled && (
                    <button
                      className={btn.buy}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onTrade(hit);
                      }}
                    >
                      Buy
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DerivativeResults({ result, common, onOpen }: { result: unknown; common: Common; onOpen: (security: FoundSecurity) => void }) {
  const products = useMemo(() => parseFoundDerivatives(result), [result]);
  const logos = useExtensionIsinLogos({
    invoke: common.invoke,
    isins: products.slice(0, 40).flatMap((product) => (product.isin ? [product.isin] : [])),
    enabled: Boolean(extension.logos?.useIsinLogos),
  });
  if (products.length === 0) return <p className={EMPTY}>Nothing found.</p>;
  return (
    <div className={SCROLL_X}>
      <table className={RECORD_TABLE}>
        <thead>
          <tr>
            <th>Product</th>
            <th>Strategy</th>
            <th>Leverage</th>
            <th className={TD_NUM}>Strike</th>
            <th className={TD_NUM}>Knockout barrier</th>
            <th>Expiry</th>
            <th className={TD_NUM}>Premium</th>
          </tr>
        </thead>
        <tbody>
          {products.slice(0, 40).map((product, index) => (
            <DerivativeRow key={product.isin ?? `${product.name}-${index}`} product={product} logo={product.isin ? logos.get(product.isin.toUpperCase()) : undefined} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DerivativeRow({ product, logo, onOpen }: { product: FoundDerivative; logo?: string; onOpen: (security: FoundSecurity) => void }) {
  const open = () => {
    if (!product.isin) return;
    onOpen({ isin: product.isin, name: product.name, symbol: product.name, type: "DERIVATIVE", currency: product.currency, lastPrice: null, quoteAt: null, isOutdated: false, record: product.record });
  };
  return (
    <tr
      className={product.isin ? "cursor-pointer" : ""}
      tabIndex={product.isin ? 0 : undefined}
      aria-label={product.isin ? `Open ${product.name} details` : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (!product.isin || event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        open();
      }}
    >
      <td>
        <SecurityCell
          logo={logo}
          initials={(product.issuer || product.name).slice(0, 2).toUpperCase()}
          title={
            product.isin ? (
              <button
                className="cursor-pointer text-right hover:text-ink-accent-bright hover:underline"
                type="button"
                title="Open details, chart and news"
                onClick={(event) => {
                  event.stopPropagation();
                  open();
                }}
              >
                {product.name}
              </button>
            ) : (
              product.name
            )
          }
          subtitle={product.isin ?? undefined}
        />
      </td>
      <td>{product.strategy ? humanize(product.strategy) : "—"}</td>
      <td>{product.leverage ?? "—"}</td>
      <td className={TD_NUM}>{product.strike ?? "—"}</td>
      <td className={TD_NUM}>{product.knockoutBarrier ?? "—"}</td>
      <td>{product.expiry ?? "—"}</td>
      <td className={TD_NUM}>{product.premium ?? "—"}</td>
    </tr>
  );
}

export function DiscoverPage({
  common,
  watched,
  held,
  initialQuery,
  onOpen,
  onTrade,
}: {
  common: Common;
  /** Searched at once when the page opens from a table's search box. */
  initialQuery?: string;
  /** ISINs on the watchlist, or null when the watchlist could not be loaded. */
  watched: Set<string> | null;
  /** ISINs held in a portfolio; Scalable does not put these on the watchlist. */
  held: ReadonlySet<string>;
  onOpen: (security: FoundSecurity) => void;
  onTrade: (security: FoundSecurity) => void;
}) {
  const { defs } = common;
  const tabs: DiscoverTool[] = ["search_securities", "search_derivatives"].filter((name) => defs.some((item) => item.name === name)) as DiscoverTool[];
  const [storedTool, setStoredTool] = useStoredState<DiscoverTool>("discover.tab", "search_securities", oneOf(["search_securities", "search_derivatives"] as const));
  const [tool, setTool] = useState<DiscoverTool>(() => {
    const preferred = initialQuery ? "search_securities" : storedTool;
    return tabs.includes(preferred) ? preferred : (tabs[0] ?? preferred);
  });
  const selectTool = (next: DiscoverTool) => {
    setTool(next);
    setStoredTool(next);
  };
  const def = defs.find((item) => item.name === tool);
  const lastSearch = savedSearch(tool);
  return (
    <Section title="Discover" hint="Search Scalable’s securities and derivatives">
      <TabGroup selectedIndex={Math.max(0, tabs.indexOf(tool))} onChange={(index) => selectTool(tabs[index] ?? tool)}>
        <TabList className={`${TABS} -mt-1 mb-3 min-h-10 border-b border-line`}>
          {tabs.map((name) => (
            <Tab key={name} className={({ selected }) => cx(tabClass(selected, "px-1"), "outline-none data-focus:outline-2 data-focus:outline-accent")}>
              {name === "search_securities" ? "Securities" : "Derivatives"}
            </Tab>
          ))}
        </TabList>
      </TabGroup>
      {def ? (
        <ToolRunnerPanel
          key={def.name}
          tool={def}
          prefill={initialQuery && def.name === "search_securities" ? { query: initialQuery } : (lastSearch ?? {})}
          autoRun={(Boolean(initialQuery) && def.name === "search_securities") || lastSearch !== null}
          portfolios={common.portfolios}
          hideHeader
          runLabel="Search"
          invoke={common.invoke}
          tradingEnabled={common.tradingEnabled}
          manageEnabled={common.manageEnabled}
          showRaw={false}
          onResult={(outcome, args) => {
            if (outcome.ok) writeStoredJson(`discover.last-search.${def.name}`, args);
          }}
          renderResult={(result) =>
            def.name === "search_securities" ? (
              <SecurityResults result={result} common={common} watched={watched} held={held} onOpen={onOpen} onTrade={onTrade} />
            ) : (
              <DerivativeResults result={result} common={common} onOpen={onOpen} />
            )
          }
        />
      ) : (
        <p className={EMPTY}>Scalable did not offer a search tool for this sign-in.</p>
      )}
    </Section>
  );
}
