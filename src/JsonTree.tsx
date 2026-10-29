import { useState, type ReactNode } from "react";
import { btn } from "./ui";
import { parseMaybeJson } from "./response";

type Mode = { open: boolean | undefined; version: number };

const BOX = "max-h-[17.3333rem] overflow-auto rounded-control bg-inset p-2.5 font-mono text-[0.9em] select-text";
const SUMMARY = "cursor-pointer list-none marker:hidden [&::-webkit-details-marker]:hidden";

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

function Scalar({ value }: { value: unknown }) {
  if (typeof value === "string") return <span className="break-words text-up">{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="text-ink-accent">{String(value)}</span>;
  return <span className="text-ink-muted">{String(value)}</span>;
}

function Node({ name, value, depth, mode, last }: { name?: string; value: unknown; depth: number; mode: Mode; last: boolean }) {
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
  const entries = isArray ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
  const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) {
    return (
      <div>
        {label}
        {open}
        {close}
        {comma}
      </div>
    );
  }
  return (
    <details key={mode.version} open={mode.open ?? depth < 2}>
      <summary className={SUMMARY}>
        {label}
        {open}
        <span className="text-ink-muted [details[open]_&]:hidden">
          {" "}
          {entries.length} {isArray ? "items" : "keys"}{" "}
        </span>
        <span className="[details[open]_&]:hidden">
          {close}
          {comma}
        </span>
      </summary>
      <div className="ml-4 border-l border-line pl-2">
        {entries.map(([key, item], index) => (
          <Node key={key} name={isArray ? undefined : key} value={item} depth={depth + 1} mode={mode} last={index === entries.length - 1} />
        ))}
      </div>
      <div>
        {close}
        {comma}
      </div>
    </details>
  );
}

/** Pretty JSON with collapsible objects and arrays, plus expand and collapse all. */
export function JsonTree({ value }: { value: unknown }) {
  const [mode, setMode] = useState<Mode>({ open: undefined, version: 0 });
  const parsed = parseMaybeJson(value);
  if (!isContainer(parsed)) return <pre className={`${BOX} whitespace-pre-wrap`}>{String(parsed)}</pre>;
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
      <div className={BOX}>
        <Node value={parsed} depth={0} mode={mode} last />
      </div>
    </div>
  );
}
