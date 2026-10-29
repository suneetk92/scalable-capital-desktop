import { useState, type ReactNode } from "react";
import { btn, cx } from "./ui";
import { parseMaybeJson } from "./response";

/** Expand all / Collapse all: `open` for every node, `version` so that pressing the same button again still applies. */
type Mode = { open: boolean | undefined; version: number };

const BOX = "overflow-auto rounded-control bg-inset p-2.5 font-mono text-[0.9em] select-text";
const SUMMARY = "cursor-pointer list-none marker:hidden [&::-webkit-details-marker]:hidden";
/** Hidden while the node's own `<details>` is open (not an open ancestor's). */
const WHEN_CLOSED = "[details[open]>summary>&]:hidden";

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

/** Values JSON leaves out of an object (and writes as null in an array), as Copy as JSON does. */
function isOmitted(value: unknown) {
  return value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint";
}

function Scalar({ value }: { value: unknown }) {
  if (typeof value === "string") return <span className="break-words text-ink-body">{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="text-ink-accent">{String(value)}</span>;
  return <span className="text-ink-muted">{String(value)}</span>;
}

function Node({ name, value, depth, mode, last }: { name?: string; value: unknown; depth: number; mode: Mode; last: boolean }) {
  const initial = mode.open ?? depth < 2;
  const [open, setOpen] = useState(initial);
  const [version, setVersion] = useState(mode.version);
  // Expand all and Collapse all set every node without remounting the tree.
  if (version !== mode.version) {
    setVersion(mode.version);
    setOpen(initial);
  }
  const label: ReactNode = name === undefined ? null : <span className="text-ink-strong">{JSON.stringify(name)}: </span>;
  const comma = last ? "" : ",";
  if (!isContainer(value)) {
    return (
      <div>
        {label}
        <Scalar value={value} />
        {comma}
      </div>
    );
  }
  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((item, index) => [String(index), isOmitted(item) ? null : item] as const) : Object.entries(value).filter(([, item]) => !isOmitted(item));
  const [start, end] = isArray ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) {
    return (
      <div>
        {label}
        {start}
        {end}
        {comma}
      </div>
    );
  }
  return (
    <details
      open={open}
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary className={SUMMARY}>
        {label}
        {start}
        <span className={cx("text-ink-muted", WHEN_CLOSED)}>
          {" "}
          {entries.length} {isArray ? "items" : "keys"}{" "}
        </span>
        <span className={WHEN_CLOSED}>
          {end}
          {comma}
        </span>
      </summary>
      {/* The children of a collapsed node are only rendered once it is opened, so a large response stays cheap. */}
      {open && (
        <>
          <div className="ml-4 border-l border-line pl-2">
            {entries.map(([key, item], index) => (
              <Node key={key} name={isArray ? undefined : key} value={item} depth={depth + 1} mode={mode} last={index === entries.length - 1} />
            ))}
          </div>
          <div>
            {end}
            {comma}
          </div>
        </>
      )}
    </details>
  );
}

/** Pretty JSON with collapsible objects and arrays, plus expand and collapse all. `maxHeight` is the box's max-height class. */
export function JsonTree({ value, maxHeight = "max-h-[17.3333rem]" }: { value: unknown; maxHeight?: string }) {
  const [mode, setMode] = useState<Mode>({ open: undefined, version: 0 });
  const parsed = parseMaybeJson(value);
  if (parsed === undefined || typeof parsed === "function" || typeof parsed === "symbol") return null;
  if (!isContainer(parsed)) return <pre className={cx(BOX, maxHeight, "break-words whitespace-pre-wrap")}>{String(parsed)}</pre>;
  const set = (open: boolean) => setMode((current) => ({ open, version: current.version + 1 }));
  return (
    <div>
      <div className="flex gap-2 pb-1.5">
        <button className={btn.secondary} type="button" onClick={() => set(true)}>
          Expand all
        </button>
        <button className={btn.secondary} type="button" onClick={() => set(false)}>
          Collapse all
        </button>
      </div>
      <div className={cx(BOX, maxHeight)}>
        <Node value={parsed} depth={0} mode={mode} last />
      </div>
    </div>
  );
}
