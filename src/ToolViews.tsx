import { Field, Label } from "@headlessui/react";
import { InboxIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { ColumnHead, resizedTable } from "./ColumnHead";
import { useTableLayout } from "./hooks/useTableLayout";
import { CheckboxField, EmptyState, Pagination, Select, SortHeader } from "./controls";
import { nextSort, sortItems, type SortState } from "./sorting";
import { useShowDiagnostics } from "./settings";
import type { PagePortfolio } from "./types";
import {
  Alert,
  Badge,
  btn,
  ConfirmDialog,
  cx,
  DescriptionList,
  DescriptionRow,
  EMPTY,
  field,
  DialogFooter,
  ModalFrame,
  ModalHeader,
  MODAL_TEXT,
  RECORD_TABLE,
  SCROLL_X,
  SecurityCell,
  securityTypeTone,
  TD_NUM,
  TH_NUM,
} from "./ui";
import {
  actionLabel,
  callTools,
  coerce,
  DIALOG_ONLY_TOOLS,
  exampleJson,
  formatCell,
  humanize,
  INSTRUMENT_EXAMPLES,
  isTradingTool,
  isWriteTool,
  pretty,
  scalarFields,
  type Invoke,
  type SchemaProp,
  type ToolDef,
  type ToolOutcome,
} from "./tools";
import { useExtensionIsinLogos } from "./extensions";
import { isRec, parseMaybeJson, recordsOf, type Rec } from "./response";

export function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  return (
    <ModalFrame size={wide ? "lg" : "md"} onClose={onClose}>
      <ModalHeader title={title} closeLabel="Close" onClose={onClose} />
      {children}
    </ModalFrame>
  );
}

export function ConfirmModal({ text, label, onResult }: { text: string; label: string; onResult: (confirmed: boolean) => void }) {
  return <ConfirmDialog title="Please confirm" text={text} confirmLabel={label} onConfirm={() => onResult(true)} onCancel={() => onResult(false)} />;
}

export function JsonView({ value, label = "Raw data" }: { value: unknown; label?: string }) {
  const visible = useShowDiagnostics();
  if (!visible) return null;
  return (
    <details className="mt-3 text-ink-muted [&_pre]:mt-2 [&_pre]:max-h-[17.3333rem] [&_pre]:overflow-auto [&_pre]:rounded-control [&_pre]:bg-inset [&_pre]:p-2.5 [&_pre]:break-words [&_pre]:whitespace-pre-wrap [&_pre]:select-text">
      <summary className="cursor-pointer">{label}</summary>
      <pre>{pretty(value)}</pre>
    </details>
  );
}

/** Flat "label: value" list of everything simple inside a result. */
export function KeyValues({ value, limit = 14 }: { value: unknown; limit?: number }) {
  const parsed = parseMaybeJson(value);
  const records = recordsOf(parsed);
  const fields = isRec(parsed) ? scalarFields(parsed) : records.length > 0 ? scalarFields(records[0]) : [];
  if (fields.length === 0) {
    return typeof parsed === "string" ? <p className={EMPTY}>{parsed}</p> : <p className={EMPTY}>Nothing to show.</p>;
  }
  return (
    <DescriptionList>
      {fields.slice(0, limit).map((field) => (
        <DescriptionRow key={field.path} label={humanize(field.path.split(".").slice(-2).join(" "))}>
          {formatCell(field.value)}
        </DescriptionRow>
      ))}
    </DescriptionList>
  );
}

const COLUMN_PRIORITY: RegExp[] = [
  /name|title|label|security/i,
  /isin/i,
  /type|side|kind|direction|status|state/i,
  /date|time|created|executed/i,
  /amount|price|value|quantity|shares|rate|interval|frequency|balance/i,
  /id$/i,
];

type RecordColumn = { path: string; label: string };

const SECURITY_NAME_PATH = /^((instrument|security)Name|(instrument|security)\.name)$/i;

/** The column that names a security: shown like the Symbol / Name column of the Portfolio table. */
const isSecurityName = (path: string) => SECURITY_NAME_PATH.test(path);

function pickColumns(records: Rec[], max = 6): RecordColumn[] {
  const counts = new Map<string, number>();
  for (const record of records.slice(0, 25)) {
    for (const field of scalarFields(record)) {
      if (typeof field.value === "string" && field.value.length > 60) continue;
      counts.set(field.path, (counts.get(field.path) ?? 0) + 1);
    }
  }
  const paths = [...counts.keys()];
  const ordered: string[] = [];
  for (const pattern of COLUMN_PRIORITY) {
    for (const path of paths) {
      if (ordered.length < max && !ordered.includes(path) && pattern.test(path.split(".").slice(-1)[0])) ordered.push(path);
    }
  }
  for (const path of paths) if (ordered.length < max && !ordered.includes(path)) ordered.push(path);
  // The ISIN is shown under the name, so it needs no column of its own.
  const named = ordered.some(isSecurityName);
  return ordered
    .filter((path) => !(named && ["isin", "identifier"].includes(path.split(".").slice(-1)[0].toLowerCase())))
    .map((path) => ({ path, label: isSecurityName(path) ? "Symbol / Name" : humanize(path.split(".").slice(-2).join(" ")) }));
}

function valueAt(record: Rec, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => (isRec(current) ? current[key] : undefined), record);
}

/** The first non-empty text among the dotted paths. */
function textAt(record: Rec, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = valueAt(record, path);
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/** A security name is a symbol-over-name cell and a security type a coloured badge, like the Portfolio table's; every other value is plain text. */
function cellOf(record: Rec, path: string, logos?: ReadonlyMap<string, string>, onOpenSecurity?: (security: { isin: string; name: string }) => void): ReactNode {
  const value = valueAt(record, path);
  if (isSecurityName(path) && typeof value === "string" && value !== "") {
    const scope = path.includes(".") ? path.slice(0, path.lastIndexOf(".") + 1) : "";
    const symbol = textAt(record, [`${scope}symbol`, `${scope}ticker`, "symbol", "ticker"]);
    const isin = textAt(record, [`${scope}isin`, `${scope}identifier`, "isin"]);
    const title = symbol ?? isin ?? value;
    const label =
      isin && onOpenSecurity ? (
        <button
          className="cursor-pointer text-left hover:text-ink-accent-bright hover:underline"
          type="button"
          onClick={() => onOpenSecurity({ isin, name: value })}
          title="Open details, chart and news"
        >
          {title}
        </button>
      ) : (
        title
      );
    return (
      <SecurityCell initials={(symbol ?? value).slice(0, 2).toUpperCase()} logo={isin ? logos?.get(isin.toUpperCase()) : undefined} title={label} subtitle={title === value ? undefined : value} />
    );
  }
  if (path.split(".").slice(-1)[0].toLowerCase() === "securitytype" && typeof value === "string" && value !== "") return <Badge tone={securityTypeTone(value)}>{value.replace(/_/g, " ")}</Badge>;
  return formatCell(value);
}

/** Page size for tables that are not on a page with the "Rows per page" setting (security drawer, details dialogs). */
const DEFAULT_RECORD_PAGE_SIZE = 25;

/** Table for any list of records; columns are picked from what the records contain. Long lists are paged. */
const unusedInvoke: Invoke = () => Promise.reject(new Error("No invoke"));
const ACTIONS_COLUMN = "__actions";

export function RecordTable({
  records,
  actions,
  empty,
  emptyTitle = "Nothing to show",
  emptyIcon,
  emptyAction,
  onRow,
  onOpenSecurity,
  pageSize = DEFAULT_RECORD_PAGE_SIZE,
  invoke,
}: {
  records: Rec[];
  actions?: (record: Rec) => ReactNode;
  empty: string;
  emptyTitle?: string;
  emptyIcon?: ComponentType<SVGProps<SVGSVGElement>>;
  emptyAction?: ReactNode;
  onRow?: (record: Rec) => void;
  /** Makes the security names open the security details. */
  onOpenSecurity?: (security: { isin: string; name: string }) => void;
  /** Rows per page; 0 shows every row. */
  pageSize?: number;
  /** Lets the extension supply ISIN logos for the securities shown. */
  invoke?: Invoke;
}) {
  const columns = useMemo(() => pickColumns(records), [records]);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>(null);
  const columnIds = useMemo(() => [...columns.map((column) => column.path), ...(actions ? [ACTIONS_COLUMN] : [])], [columns, actions]);
  // Tables of the same shape (the same columns) share their layout.
  const { order, layout } = useTableLayout(`records:${columns.map((column) => column.path).join("|")}`, columnIds);
  const resized = resizedTable(layout.widths);
  const isins = useMemo(() => records.flatMap((record) => textAt(record, ["instrument.identifier", "instrument.isin", "isin"]) ?? []), [records]);
  const logos = useExtensionIsinLogos({ invoke: invoke ?? unusedInvoke, isins, enabled: invoke !== undefined });
  const sorted = useMemo(
    () =>
      sortItems(records, sort, (record, path) => {
        const value = valueAt(record, path);
        return typeof value === "string" || typeof value === "number" ? value : formatCell(value);
      }),
    [records, sort],
  );
  const sortColumn = (path: string) => {
    setSort((current) => nextSort(current, path));
    setPage(1);
  };
  if (records.length === 0) return empty === "" ? null : <EmptyState icon={emptyIcon ?? InboxIcon} title={emptyTitle} text={empty} action={emptyAction} />;
  const rowsPerPage = pageSize > 0 ? pageSize : records.length;
  const pageCount = Math.ceil(records.length / rowsPerPage);
  const current = Math.min(page, pageCount);
  const offset = (current - 1) * rowsPerPage;
  return (
    <>
      <div className={SCROLL_X}>
        <table className={cx(RECORD_TABLE, resized.className)} style={resized.style}>
          <thead>
            <tr>
              {order.map((id) => {
                const column = columns.find((item) => item.path === id);
                return column ? (
                  <SortHeader key={id} layout={layout} label={column.label} iconAfter={isSecurityName(column.path)} column={id} sort={sort} onSort={sortColumn} />
                ) : (
                  <ColumnHead key={id} id={id} label="Actions" layout={layout} className={TH_NUM}>
                    Actions
                  </ColumnHead>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(offset, offset + rowsPerPage).map((record, index) => (
              <tr key={offset + index} className={onRow ? "cursor-pointer" : ""} onClick={onRow ? () => onRow(record) : undefined}>
                {order.map((id) =>
                  id === ACTIONS_COLUMN && actions ? (
                    <td key={id} className={TD_NUM} onClick={(event) => event.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">{actions(record)}</div>
                    </td>
                  ) : (
                    <td key={id}>{cellOf(record, id, logos, onOpenSecurity)}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={current} pageCount={pageCount} total={records.length} pageSize={rowsPerPage} onPage={setPage} />
    </>
  );
}

type FormValues = Record<string, string>;

function propKind(prop: SchemaProp | undefined) {
  const type = prop?.type;
  if (!type && (prop?.properties || prop?.oneOf?.some((option) => option.type === "object" || option.properties))) return "object";
  return Array.isArray(type) ? (type.find((item) => item !== "null") ?? "string") : (type ?? "string");
}

const isPortfolioKey = (key: string) => key.toLowerCase().replace(/[^a-z]/g, "") === "portfolioid";

/** `portfolios` has the main portfolio first; it is preselected for the portfolio id field. */
function initialValues(tool: ToolDef, prefill: Rec, portfolios: PagePortfolio[] = []): FormValues {
  const values: FormValues = {};
  for (const [key, value] of Object.entries(prefill)) {
    if (value === undefined || value === null) continue;
    values[key] = Array.isArray(value) ? value.map((item) => (isRec(item) ? JSON.stringify(item) : String(item))).join(", ") : isRec(value) ? JSON.stringify(value) : String(value);
  }
  for (const [key, prop] of Object.entries(tool.inputSchema?.properties ?? {})) {
    if (!(key in values) && prop.default !== undefined && typeof prop.default !== "object") values[key] = String(prop.default);
    if (!values[key] && isPortfolioKey(key) && portfolios.length > 0) values[key] = portfolios[0].portfolioId;
  }
  return values;
}

function formToArgs(tool: ToolDef, values: FormValues): { args: Rec; error?: string } {
  const properties = tool.inputSchema?.properties ?? {};
  if (Object.keys(properties).length === 0) {
    const raw = values.__json?.trim();
    if (!raw) return { args: {} };
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRec(parsed) ? { args: parsed } : { args: {}, error: "Arguments must be a JSON object." };
    } catch {
      return { args: {}, error: "Arguments are not valid JSON." };
    }
  }
  const args: Rec = {};
  for (const [key, prop] of Object.entries(properties)) {
    const text = (values[key] ?? "").trim();
    if (text === "") continue;
    const kind = propKind(prop);
    if (kind === "object") {
      if (key === "instrument" && /^[A-Z]{2}[A-Z0-9]{9}\d$/i.test(text)) args[key] = { kind: "security", isin: text.toUpperCase() };
      else {
        try {
          args[key] = JSON.parse(text);
        } catch {
          return { args, error: `${humanize(key)} is not valid JSON.` };
        }
      }
    } else if (kind === "array") {
      const items = text.startsWith("[")
        ? (() => {
            try {
              return JSON.parse(text) as unknown[];
            } catch {
              return text.split(",");
            }
          })()
        : text
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
      args[key] = coerce(prop, items);
    } else {
      const converted = coerce(prop, text);
      if (converted === undefined) return { args, error: `${humanize(key)} has an invalid value.` };
      args[key] = converted;
    }
  }
  const missing = (tool.inputSchema?.required ?? []).filter((key) => !(key in args));
  return missing.length > 0 ? { args, error: `Required: ${missing.map(humanize).join(", ")}.` } : { args };
}

const JSON_PLACEHOLDER = "{}";

function ToolForm({ tool, values, onChange, portfolios = [] }: { tool: ToolDef; values: FormValues; onChange: (values: FormValues) => void; portfolios?: PagePortfolio[] }) {
  const properties = Object.entries(tool.inputSchema?.properties ?? {});
  const required = new Set(tool.inputSchema?.required ?? []);
  const set = (key: string, value: string) => onChange({ ...values, [key]: value });
  if (properties.length === 0) {
    return (
      <label className={field.label}>
        Arguments as JSON (optional)
        <textarea className={field.textarea} value={values.__json ?? ""} placeholder={JSON_PLACEHOLDER} onChange={(event) => set("__json", event.currentTarget.value)} />
      </label>
    );
  }
  return (
    <>
      {properties.map(([key, prop]) => {
        const kind = propKind(prop);
        const label = (
          <>
            {humanize(key)}
            {required.has(key) ? " *" : ""}
          </>
        );
        const hint = prop.description ? <small className={field.hint}>{prop.description}</small> : null;
        if (isPortfolioKey(key) && portfolios.length > 0) {
          return (
            <Field key={key} className={field.label}>
              <Label>{label}</Label>
              <Select value={values[key] ?? ""} onChange={(value: string) => set(key, value)} options={portfolios.map((portfolio) => ({ value: portfolio.portfolioId, label: portfolio.name }))} />
              {hint}
            </Field>
          );
        }
        if (prop.enum && prop.enum.length > 0) {
          return (
            <Field key={key} className={field.label}>
              <Label>{label}</Label>
              <Select
                value={values[key] ?? ""}
                onChange={(value: string) => set(key, value)}
                options={[{ value: "", label: required.has(key) ? "Choose…" : "Not set" }, ...prop.enum.map((option) => ({ value: String(option), label: String(option) }))]}
              />
              {hint}
            </Field>
          );
        }
        if (kind === "boolean") {
          return (
            <CheckboxField key={key} className="mb-3.5" checked={values[key] === "true"} onChange={(checked) => set(key, String(checked))} hint={prop.description}>
              {label}
            </CheckboxField>
          );
        }
        if (kind === "object") {
          return (
            <label key={key} className={field.label}>
              {label} {key === "instrument" ? "(ISIN or JSON)" : "(JSON)"}
              <textarea className={field.textarea} value={values[key] ?? ""} placeholder={exampleJson(key, prop)} onChange={(event) => set(key, event.currentTarget.value)} />
              {hint}
              {key === "instrument" && (
                <small className={field.hint}>
                  Examples: <code>US0378331005</code>, <code>{INSTRUMENT_EXAMPLES[0]}</code> or <code>{INSTRUMENT_EXAMPLES[1]}</code>
                </small>
              )}
            </label>
          );
        }
        return (
          <label key={key} className={field.label}>
            {label}
            {kind === "array" ? " (comma separated)" : ""}
            <input
              className={field.input}
              value={values[key] ?? ""}
              inputMode={kind === "number" || kind === "integer" ? "decimal" : undefined}
              onChange={(event) => set(key, event.currentTarget.value)}
            />
            {hint}
          </label>
        );
      })}
    </>
  );
}

type PanelProps = {
  tool: ToolDef;
  prefill?: Rec;
  /** Runs the tool once when the panel opens, for a form that is already filled in. */
  autoRun?: boolean;
  portfolios?: PagePortfolio[];
  invoke: Invoke;
  tradingEnabled: boolean;
  runLabel?: string;
  hideHeader?: boolean;
  renderResult?: (result: unknown) => ReactNode;
  onResult?: (outcome: ToolOutcome, args: Rec) => void;
};

/** Form generated from a tool's input schema, with a Run button and the result below. */
export function ToolRunnerPanel({ tool, prefill = {}, autoRun = false, portfolios, invoke, tradingEnabled, runLabel, hideHeader = false, renderResult, onResult }: PanelProps) {
  const [values, setValues] = useState<FormValues>(() => initialValues(tool, prefill, portfolios));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ToolOutcome | null>(null);
  const write = isWriteTool(tool.name);
  const dialogOnly = DIALOG_ONLY_TOOLS[tool.name];
  const blocked = isTradingTool(tool.name) && !tradingEnabled;
  const action = actionLabel(tool.name);

  async function run() {
    const built = formToArgs(tool, values);
    if (built.error) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [result] = await callTools(invoke, [{ name: tool.name, arguments: built.args }]);
      setOutcome(result ?? null);
      if (result && !result.ok) setError(result.error ?? "The tool call failed.");
      if (result) onResult?.(result, built.args);
    } catch (runError) {
      setError(typeof runError === "string" ? runError : runError instanceof Error ? runError.message : "The tool call failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoRun) void run();
    // Only when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-0.5">
      {!hideHeader && (
        <p className={`mb-3 ${MODAL_TEXT} [&_code]:text-ink-accent-bright`}>
          <code>{tool.name}</code>
          {tool.description ? ` — ${tool.description}` : ""}
        </p>
      )}
      <ToolForm tool={tool} values={values} onChange={setValues} portfolios={portfolios} />
      {dialogOnly && <div className={`${field.note} mb-3`}>This tool is only sent from {dialogOnly}, which previews and confirms it first. It cannot be run from here.</div>}
      {blocked && !dialogOnly && <div className={`${field.note} mb-3`}>This tool moves money or orders. Turn on Trading (top right) to use it.</div>}
      {error && <Alert>{error}</Alert>}
      <DialogFooter>
        <button className={write && action.destructive ? btn.danger : btn.primary} type="button" disabled={busy || blocked || dialogOnly !== undefined} onClick={() => void run()}>
          {busy ? action.busy : (runLabel ?? action.label)}
        </button>
      </DialogFooter>
      {outcome?.ok && (
        <div className="mt-3.5 border-t border-line pt-3">
          {renderResult ? renderResult(outcome.result) : <KeyValues value={outcome.result} limit={20} />}
          <JsonView value={outcome.result} />
        </div>
      )}
    </div>
  );
}

export function ToolRunnerModal({
  defs,
  portfolios,
  initialTool,
  prefill,
  invoke,
  tradingEnabled,
  onChanged,
  onSuccess,
  onClose,
}: {
  defs: ToolDef[];
  portfolios: PagePortfolio[];
  initialTool: string;
  prefill: Rec;
  invoke: Invoke;
  tradingEnabled: boolean;
  onChanged: (tool: string, args: Rec) => void;
  /** Called after a write succeeded; the dialog closes itself. */
  onSuccess: (tool: string, args: Rec, result: unknown) => void;
  onClose: () => void;
}) {
  const tool = defs.find((item) => item.name === initialTool);
  return (
    <Modal title={tool ? humanize(tool.name) : "Tool"} onClose={onClose} wide>
      {tool ? (
        <ToolRunnerPanel
          tool={tool}
          prefill={prefill}
          portfolios={portfolios}
          invoke={invoke}
          tradingEnabled={tradingEnabled}
          onResult={(outcome, args) => {
            if (!outcome.ok || !isWriteTool(tool.name)) return;
            onChanged(tool.name, args);
            onSuccess(tool.name, args, outcome.result);
            onClose();
          }}
        />
      ) : (
        <p className={`mb-3 ${MODAL_TEXT}`}>Scalable did not offer this tool for this sign-in.</p>
      )}
    </Modal>
  );
}
