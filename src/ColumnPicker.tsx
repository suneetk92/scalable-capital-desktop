import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { ChevronRightIcon, PlusIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { CheckboxField, MENU_PANEL, SearchBox, SelectAllField } from "./controls";
import { baseColumnId, columnById, columnGroups, DEFAULT_COLUMNS, type TableColumn } from "./marketColumns";
import { extension } from "./extensions";
import { btn, cx } from "./ui";

const GROUP_TITLE =
  "mt-1 flex w-full cursor-pointer items-center gap-1.5 rounded-control px-1 py-1.5 text-left font-title tracking-[.1em] text-ink-muted uppercase outline-none hover:text-ink-strong data-focus:outline-2 data-focus:outline-accent";

/** The "+" in the table header: adds and removes optional columns. The symbol is always shown. */
export function ColumnPicker({
  columns,
  extensionsEnabled = true,
  catalog,
  defaults = DEFAULT_COLUMNS,
  note,
  onChange,
}: {
  columns: readonly string[];
  extensionsEnabled?: boolean;
  catalog?: { groups: readonly { group: string; columns: readonly TableColumn[] }[]; column: (id: string) => TableColumn | undefined };
  defaults?: readonly string[];
  /** A line under the title, for what changing the columns does here. */
  note?: string;
  onChange: (columns: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  // Groups the user opened; groups that hold a shown column start open, and a search opens every match.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const needle = search.trim().toLowerCase();
  const columnOf = catalog?.column ?? ((id: string) => extension.tableColumns?.column(id) ?? columnById(id));
  const columnGroupsToShow = catalog?.groups ?? [...columnGroups(), ...(extensionsEnabled ? (extension.tableColumns?.groups() ?? []) : [])];
  const groups = columnGroupsToShow
    .map(({ group, columns: all }) => ({
      group,
      columns: all.filter((column) => needle === "" || `${column.label} ${column.hint ?? ""} ${group}`.toLowerCase().includes(needle)),
    }))
    .filter(({ columns: all }) => all.length > 0);
  const shown = columns.filter((id) => {
    const column = columnOf(id);
    return column !== undefined && (extensionsEnabled || column.source === "scalable");
  });
  const atDefault = columns.length === defaults.length && columns.every((id, index) => id === defaults[index]);

  // A column whose settings were changed (EMA 20 on 1 hour) is listed under its catalogue entry, and so is one that a column with settings stands for (SMA 50).
  const baseOf = (id: string) => baseColumnId(columnOf(id)?.alias ?? id);
  const chosenIds = (id: string) => columns.filter((current) => baseOf(current) === id);
  const chosenId = (id: string) => chosenIds(id)[0];
  const isOpen = (group: string, all: readonly { id: string }[]) => needle !== "" || (opened[group] ?? all.some((column) => chosenId(column.id) !== undefined));

  function toggle(id: string, checked: boolean) {
    const rest = columns.filter((current) => baseOf(current) !== id);
    onChange(checked ? [...rest, id] : rest);
  }

  function changeSettings(id: string, column: TableColumn, values: Record<string, string>) {
    if (!column.settings) return;
    const next = extension.tableColumns?.updateId?.(id, column, values) ?? column.id;
    // Settings that another instance already has would show the same column twice: this instance is dropped.
    onChange(next !== id && columns.includes(next) ? columns.filter((current) => current !== id) : columns.map((current) => (current === id ? next : current)));
  }

  function addAnother(column: TableColumn) {
    const id = extension.tableColumns?.addVariant?.(column, columns);
    if (id) onChange([...columns, id]);
  }

  return (
    <Popover className="relative inline-block">
      <PopoverButton
        className="grid size-7 cursor-pointer place-items-center rounded-control border border-line-strong bg-raised text-ink-soft outline-none hover:border-line-hover hover:bg-hover hover:text-ink-strong data-focus:outline-2 data-focus:outline-accent data-open:border-line-hover data-open:bg-hover"
        aria-label="Add or remove columns"
        title="Add or remove columns"
      >
        <PlusIcon className="size-4" aria-hidden="true" />
      </PopoverButton>
      <PopoverPanel transition anchor={{ to: "bottom end", gap: 6, padding: 8 }} className={cx(MENU_PANEL, "max-h-[min(80vh,42.6667rem)] w-88 overflow-y-auto p-3")}>
        {({ close }) => (
          <>
            <div className="mb-2 flex items-baseline justify-between">
              <strong className="font-semibold text-ink-heading">Columns</strong>
              <span className="text-ink-muted">{shown.length} shown · symbol always</span>
            </div>
            {note && <p className="mb-2 text-ink-muted">{note}</p>}
            <SearchBox className="mb-1 w-full" value={search} onChange={setSearch} placeholder="Search columns" label="Search columns" />
            <SelectAllField
              options={groups.flatMap(({ columns: all }) => all.map((column) => column.id))}
              selected={columns.map(baseOf)}
              matching={needle !== ""}
              onChange={(ids) => onChange(ids.flatMap((id) => (chosenIds(id).length > 0 ? chosenIds(id) : [id])))}
            />
            {groups.length === 0 && <p className="mt-3 text-ink-muted">No column matches “{search.trim()}”.</p>}
            {groups.map(({ group, columns: all }) => {
              const open = isOpen(group, all);
              const chosen = all.filter((column) => chosenId(column.id) !== undefined).length;
              return (
                <div key={group}>
                  <button className={GROUP_TITLE} type="button" aria-expanded={open} onClick={() => setOpened((current) => ({ ...current, [group]: !open }))}>
                    <ChevronRightIcon className={cx("size-3.5 shrink-0 transition-transform", open && "rotate-90")} aria-hidden="true" />
                    <span className="grow">{group}</span>
                    <span className="font-normal tracking-normal normal-case">{chosen > 0 ? `${chosen} of ${all.length}` : all.length}</span>
                  </button>
                  {open &&
                    all.map((column) => {
                      const ids = chosenIds(column.id);
                      const first = ids[0];
                      const canAdd = ids.length > 0 && column.settings != null && extension.tableColumns?.addVariant !== undefined;
                      return (
                        <div key={column.id} title={column.hint}>
                          <CheckboxField checked={first !== undefined} onChange={(checked) => toggle(column.id, checked)}>
                            {(first ? columnOf(columnOf(first)?.alias ?? first)?.label : undefined) || column.label}
                          </CheckboxField>
                          {ids.map((id, index) => {
                            const current = columnOf(columnOf(id)?.alias ?? id);
                            return (
                              <div key={id} className="mb-1.5 ml-6">
                                {index > 0 && (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-ink-body">{current?.label}</span>
                                    <button
                                      className={btn.link}
                                      type="button"
                                      onClick={() => onChange(columns.filter((entry) => entry !== id))}
                                      aria-label={`Remove ${current?.label ?? column.label}`}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                )}
                                {current?.settings != null &&
                                  current.values &&
                                  extension.tableColumns?.renderSettings &&
                                  extension.tableColumns.renderSettings(id, column, (next) => changeSettings(id, column, next))}
                              </div>
                            );
                          })}
                          {canAdd && (
                            <div className="mb-1.5 ml-6">
                              <button className={btn.link} type="button" onClick={() => addAnother(column)} disabled={extension.tableColumns?.addVariant?.(column, columns) == null}>
                                Add another with other settings
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              );
            })}
            <div className="mt-2.5 flex justify-between border-t border-line pt-2">
              <button className={btn.link} type="button" onClick={() => onChange([...defaults])} disabled={atDefault}>
                Reset to default
              </button>
              <button
                className={btn.link}
                type="button"
                onClick={() => {
                  setSearch("");
                  close();
                }}
              >
                Done
              </button>
            </div>
          </>
        )}
      </PopoverPanel>
    </Popover>
  );
}
