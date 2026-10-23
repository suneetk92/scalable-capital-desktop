import { useEffect, useMemo, useState } from "react";
import { ColumnHead, inOrder, resizedTable } from "../ColumnHead";
import { useTableLayout } from "../hooks/useTableLayout";
import { CheckboxField, Pagination } from "../controls";
import { VIEW_TITLES, type View } from "../nav";
import { extension } from "../extensions";
import { type Common } from "../types";
import { btn, cx, EMPTY, RECORD_TABLE, SCROLL_X } from "../ui";
import { invokeCommand, TOOL } from "../commands";
import { isTradingTool, isWriteTool, callTools, BACKEND_TOOLS, DIALOG_ONLY_TOOLS, subscribeToolStats, toolStats, TOOL_USAGE } from "../tools";
import { type PublishedTool } from "../toolSchema";
import { SearchToolbar, Section } from "./shared";
import { matchesText } from "../textSearch";
import { ToolSchemaModal } from "./ToolSchema";
import { pluralize } from "../format";
import { useAsyncQuery } from "../hooks/useAsyncQuery";

const COLUMN_IDS = ["tool", "usedFor", "actions"];
const HEADS: Record<string, { label: string; className?: string }> = {
  tool: { label: "Tool · group · access · calls" },
  usedFor: { label: "Used for" },
  actions: { label: "Actions", className: "text-right" },
};

function status(row: { usage?: unknown; offered: boolean }) {
  return !row.offered ? "Not offered by this connection" : row.usage ? "Used by the app" : "Not used by the app";
}

function callsText(name: string, stat: { calls: number; failures: number } | undefined) {
  const backend = BACKEND_TOOLS.has(name);
  const count = stat ? `${pluralize(stat.calls, "call")}${stat.failures > 0 ? ` (${stat.failures} failed)` : ""}` : backend ? "" : pluralize(0, "call");
  return [backend ? "backend" : "", count].filter(Boolean).join(" + ");
}

function accessOf(name: string) {
  return isTradingTool(name) ? "Trading" : isWriteTool(name) ? "Changes data" : "Read-only";
}

export function ToolsPage({ common, onSelectView }: { common: Common; onSelectView: (view: View) => void }) {
  const { defs, actions, invoke } = common;
  const [, force] = useState(0);
  const { order, layout } = useTableLayout("tools", COLUMN_IDS);
  const resized = resizedTable(layout.widths);
  const [onlyUnused, setOnlyUnused] = useState(false);
  const [search, setSearch] = useState("");
  const [ping, setPing] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(1);
  const [schemaTool, setSchemaTool] = useState<string | null>(null);
  const schemas = useAsyncQuery(async () => (await invokeCommand(invoke, "load_tool_schemas")) as PublishedTool[], [invoke], schemaTool !== null);
  useEffect(() => setPage(1), [common.pageSize, onlyUnused, search]);
  useEffect(() => subscribeToolStats(() => force((value) => value + 1)), []);

  const offered = useMemo(() => new Set(defs.map((tool) => tool.name)), [defs]);
  const names = useMemo(() => [...new Set([...defs.map((tool) => tool.name), ...Object.keys(TOOL_USAGE)])], [defs]);
  const rows = useMemo(
    () =>
      names
        .map((name) => {
          const usage = TOOL_USAGE[name];
          return { name, usage, offered: offered.has(name), access: accessOf(name), description: defs.find((tool) => tool.name === name)?.description ?? "" };
        })
        .sort((a, b) => (a.usage?.category ?? "~").localeCompare(b.usage?.category ?? "~") || a.name.localeCompare(b.name)),
    [names, offered, defs],
  );
  const used = rows.filter((row) => row.usage && row.offered).length;
  const unused = rows.filter((row) => row.offered && !row.usage).length;
  const shown = rows.filter(
    (row) => (!onlyUnused || !row.usage || !row.offered) && matchesText(search, [row.name, row.description, row.access, row.usage?.category, row.usage?.feature, row.usage?.where]),
  );
  const stats = toolStats();
  const rowsPerPage = common.pageSize > 0 ? common.pageSize : Math.max(shown.length, 1);
  const pageCount = Math.max(1, Math.ceil(shown.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const pageRows = shown.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  function openSchema(name: string) {
    setSchemaTool(name);
  }

  async function testConnection() {
    setPing("Testing…");
    const started = performance.now();
    try {
      const [result] = await callTools(invoke, [{ name: TOOL.ping, arguments: {} }]);
      setPing(result?.ok ? `Connected · ${Math.round(performance.now() - started)} ms` : `Failed: ${result?.error ?? "no answer"}`);
    } catch (error) {
      setPing(`Failed: ${typeof error === "string" ? error : error instanceof Error ? error.message : "no answer"}`);
    }
  }

  async function copyMarkdown() {
    const lines = [
      "| Tool | Group | Access | Status | Used for | Where |",
      "|---|---|---|---|---|---|",
      ...rows.map((row) => `| ${row.name} | ${row.usage?.category ?? "—"} | ${row.access} | ${status(row)} | ${row.usage?.feature ?? "—"} | ${row.usage?.where ?? "—"} |`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      actions.notify({ kind: "error", text: "Could not copy to the clipboard." });
    }
  }

  return (
    <Section
      title="Scalable MCP tools"
      toolbar={<SearchToolbar value={search} onChange={setSearch} placeholder="Search tools" label="Search Scalable tools by name, group or use" />}
      hint={`${used} of ${rows.filter((row) => row.offered).length} offered tools used · ${unused} not used`}
      actions={
        <>
          {offered.has(TOOL.ping) && (
            <button className={cx(btn.secondary, "whitespace-nowrap")} type="button" onClick={() => void testConnection()}>
              Test connection
            </button>
          )}
          <button className={cx(btn.secondary, "whitespace-nowrap")} type="button" onClick={() => void copyMarkdown()}>
            {copied ? "Copied" : "Copy as table"}
          </button>
        </>
      }
    >
      {ping && <p className="mb-2 text-ink-accent-bright">{ping}</p>}
      <CheckboxField checked={onlyUnused} onChange={setOnlyUnused}>
        Show only tools the app does not use
      </CheckboxField>
      <div className={SCROLL_X}>
        <table className={cx(RECORD_TABLE, resized.className)} style={resized.style}>
          <thead>
            <tr>
              {order.map((id) => (
                <ColumnHead key={id} id={id} label={HEADS[id].label} layout={layout} className={HEADS[id].className}>
                  {HEADS[id].label}
                </ColumnHead>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const stat = stats.get(row.name);
              return (
                <tr key={row.name} title={row.description}>
                  {inOrder(order, {
                    tool: (
                      <td>
                        <code className={cx("font-semibold", row.usage && row.offered ? "text-up!" : "text-down!")} title={status(row)}>
                          {row.name}
                        </code>
                        <div className="text-caption text-ink-muted">{[row.usage?.category, row.access, callsText(row.name, stat)].filter(Boolean).join(" · ")}</div>
                      </td>
                    ),
                    usedFor: (
                      <td className="min-w-48 whitespace-normal">
                        {row.usage ? (
                          <>
                            {row.usage.feature}
                            <div className="text-caption">
                              <button
                                className={cx(btn.link, "max-w-full truncate text-right hover:underline")}
                                type="button"
                                title={`Open ${VIEW_TITLES[row.usage.view as keyof typeof VIEW_TITLES] ?? extension.views?.find((view) => view.id === row.usage?.view)?.title ?? row.usage.view}`}
                                onClick={() => onSelectView(row.usage!.view)}
                              >
                                {row.usage.where} ↗
                              </button>
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    ),
                    actions: (
                      <td className="text-right whitespace-nowrap">
                        <span className="inline-flex gap-1">
                          <button
                            className={cx(btn.trade, "px-2! py-0.5! text-caption!")}
                            type="button"
                            disabled={!row.offered}
                            aria-label={`Schema of ${row.name}`}
                            onClick={() => openSchema(row.name)}
                          >
                            Schema
                          </button>
                          <button
                            className={cx(btn.trade, "px-2! py-0.5! text-caption!")}
                            type="button"
                            disabled={!row.offered || row.name in DIALOG_ONLY_TOOLS || !actions.has(row.name)}
                            title={
                              row.name in DIALOG_ONLY_TOOLS
                                ? `Only sent from ${DIALOG_ONLY_TOOLS[row.name]}, after a preview`
                                : row.offered && !actions.has(row.name)
                                  ? "Turn on Trading (top right) to run tools that change data"
                                  : undefined
                            }
                            aria-label={`Run ${row.name}`}
                            onClick={() => actions.openRunner(row.name)}
                          >
                            Run
                          </button>
                        </span>
                      </td>
                    ),
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className={EMPTY}>No tools match.</p>}
      <Pagination page={currentPage} pageCount={pageCount} total={shown.length} pageSize={rowsPerPage} onPage={setPage} />
      <p className={EMPTY}>
        A tool name in green is used by the app; red means it is not used or not offered. The link opens the page where the tool is used. Under each name are its group, its access level and how many
        calls this window has sent since it was opened. “backend” marks tools the app calls itself, at startup and in the order dialog; they are not counted here. Schema fetches the tool’s arguments,
        input schema and output schema from Scalable when you open it. Run opens a form built from the tool’s own input schema, so tools without a dedicated screen can still be tried.
      </p>
      {schemaTool && (
        <ToolSchemaModal
          key={schemaTool}
          name={schemaTool}
          tool={schemas.data?.find((tool) => tool.name === schemaTool)}
          loading={schemas.loading}
          error={schemas.error}
          onReload={schemas.retry}
          onNotify={(text) => actions.notify({ kind: "ok", text })}
          onClose={() => setSchemaTool(null)}
        />
      )}
    </Section>
  );
}
