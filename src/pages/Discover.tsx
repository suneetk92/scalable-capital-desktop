import { Tab, TabGroup, TabList } from "@headlessui/react";
import { useState } from "react";
import { type Common } from "../types";
import { btn, cx, EMPTY, field, LIST, LIST_ITEM, TABS, tabClass } from "../ui";
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

export function DiscoverPage({
  common,
  watched,
  held,
  onOpen,
  onTrade,
}: {
  common: Common;
  /** ISINs on the watchlist, or null when the watchlist could not be loaded. */
  watched: Set<string> | null;
  /** ISINs held in a portfolio; Scalable does not put these on the watchlist. */
  held: ReadonlySet<string>;
  onOpen: (security: FoundSecurity) => void;
  onTrade: (security: FoundSecurity) => void;
}) {
  const { actions, defs } = common;
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
          prefill={{}}
          portfolios={common.portfolios}
          hideHeader
          runLabel="Search"
          invoke={common.invoke}
          tradingEnabled={common.tradingEnabled}
          renderResult={(result) => {
            const hits = foundSecurities(result);
            return hits.length === 0 ? (
              <p className={EMPTY}>Nothing found.</p>
            ) : (
              <ul className={LIST}>
                {hits.slice(0, 40).map((hit) => (
                  <li key={hit.isin} className={LIST_ITEM}>
                    <span>
                      {hit.name}
                      <small className={field.hint}>
                        {" "}
                        {hit.isin}
                        {hit.type ? ` · ${humanize(hit.type)}` : ""}
                      </small>
                    </span>
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
          }}
        />
      ) : (
        <p className={EMPTY}>Scalable did not offer a search tool for this sign-in.</p>
      )}
    </Section>
  );
}
