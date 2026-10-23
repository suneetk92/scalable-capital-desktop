import { Tab, TabGroup, TabList } from "@headlessui/react";
import { useMemo, useState } from "react";
import { extension, useExtensionIsinLogos } from "../extensions";
import { type Common } from "../types";
import { btn, cx, EMPTY, field, LIST, LIST_ITEM, SecurityCell, TABS, tabClass } from "../ui";
import { ToolRunnerPanel } from "../ToolViews";
import { humanize } from "../tools";
import { findRecords, pick, pickString, type Rec } from "../response";
import { Section } from "./shared";
import { TOOL } from "../commands";

export type FoundSecurity = { isin: string; name: string; type: string; record: Rec };

function foundSecurities(result: unknown): FoundSecurity[] {
  const seen = new Set<string>();
  return findRecords(result).flatMap((record) => {
    const isin = pickString(record, ["isin", "securityId"]) ?? pickString(pick(record, ["security"]), ["isin"]);
    if (!isin || seen.has(isin)) return [];
    seen.add(isin);
    return [{ isin, name: pickString(record, ["name", "securityName"]) ?? pickString(pick(record, ["security"]), ["name"]) ?? isin, type: pickString(record, ["securityType", "type"]) ?? "", record }];
  });
}

function Hits({
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
  const hits = useMemo(() => foundSecurities(result), [result]);
  const shown = hits.slice(0, 40);
  const logos = useExtensionIsinLogos({ invoke: common.invoke, isins: shown.map((hit) => hit.isin), enabled: Boolean(extension.logos?.useIsinLogos) });
  if (hits.length === 0) return <p className={EMPTY}>Nothing found.</p>;
  return (
    <ul className={LIST}>
      {shown.map((hit) => (
        <li key={hit.isin} className={LIST_ITEM}>
          <SecurityCell
            logo={logos.get(hit.isin.toUpperCase())}
            initials={hit.name.slice(0, 2).toUpperCase()}
            title={hit.isin}
            subtitle={hit.type ? `${hit.name} · ${humanize(hit.type)}` : hit.name}
          />
          <span className="flex shrink-0 items-center gap-1.5">
            <button className={btn.trade} type="button" onClick={() => onOpen(hit)}>
              Details
            </button>
            {watched && actions.has(TOOL.addWatchlistItem) && !watched.has(hit.isin) && !held.has(hit.isin) && (
              <button className={btn.trade} type="button" onClick={() => void actions.run(TOOL.addWatchlistItem, { isin: hit.isin }, { done: `${hit.name} added to your watchlist` })}>
                Add to watchlist
              </button>
            )}
            {watched?.has(hit.isin) && <small className={field.hint}>On watchlist</small>}
            {held.has(hit.isin) && <small className={field.hint}>In portfolio</small>}
            {!watched && (
              <small className={field.hint} title="Your watchlist could not be loaded. Refresh to check.">
                Watchlist unknown
              </small>
            )}
            {common.tradingEnabled && (
              <button className={btn.buy} type="button" onClick={() => onTrade(hit)}>
                Buy
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
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
  const [tool, setTool] = useState("search_securities");
  const def = defs.find((item) => item.name === tool);
  const tabs = ["search_securities", "search_derivatives"].filter((name) => defs.some((item) => item.name === name));
  return (
    <Section title="Discover" hint="Search Scalable’s securities and derivatives">
      <TabGroup selectedIndex={Math.max(0, tabs.indexOf(tool))} onChange={(index) => setTool(tabs[index] ?? tool)}>
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
          prefill={initialQuery && def.name === "search_securities" ? { query: initialQuery } : {}}
          autoRun={Boolean(initialQuery) && def.name === "search_securities"}
          portfolios={common.portfolios}
          hideHeader
          runLabel="Search"
          invoke={common.invoke}
          tradingEnabled={common.tradingEnabled}
          renderResult={(result) => <Hits result={result} common={common} watched={watched} held={held} onOpen={onOpen} onTrade={onTrade} />}
        />
      ) : (
        <p className={EMPTY}>Scalable did not offer a search tool for this sign-in.</p>
      )}
    </Section>
  );
}
