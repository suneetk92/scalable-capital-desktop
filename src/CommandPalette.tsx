import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions, Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import { FaceFrownIcon, GlobeAmericasIcon } from "@heroicons/react/24/outline";
import { useMemo, useState, type ComponentType, type SVGProps } from "react";

export type PaletteItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Only listed once the user has typed something (e.g. individual securities). */
  searchOnly?: boolean;
  run: () => void;
};

const MAX_RESULTS = 40;

/**
 * Command palette with groups, built on Headless UI's Dialog + Combobox (focus trap, arrow keys,
 * Enter and Esc). Ctrl+P opens it.
 */
export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle === "" ? items.filter((item) => !item.searchOnly) : items.filter((item) => `${item.label} ${item.hint ?? ""} ${item.group}`.toLowerCase().includes(needle));
    return pool.slice(0, MAX_RESULTS);
  }, [items, query]);

  const groups = useMemo(() => {
    const map = new Map<string, PaletteItem[]>();
    for (const item of results) map.set(item.group, [...(map.get(item.group) ?? []), item]);
    return [...map.entries()];
  }, [results]);

  function choose(item: PaletteItem | null) {
    if (!item) return;
    onClose();
    item.run();
  }

  return (
    <Dialog open onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-gray-900/60 animate-fade-in" />
      <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6 md:p-20">
        <DialogPanel className="mx-auto max-w-xl overflow-hidden rounded-modal bg-surface shadow-[0_25px_50px_-12px_var(--pop-shadow)] outline-1 -outline-offset-1 outline-ink-heading/10 animate-fade-in">
          <Combobox<PaletteItem | null> value={null} onChange={choose}>
            <div className="grid grid-cols-1">
              <ComboboxInput
                autoFocus
                aria-label="Search commands"
                displayValue={() => query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Go to a page, run an action or find a security… (Ctrl+P)"
                className="col-start-1 row-start-1 h-12 w-full bg-transparent pr-4 pl-11 text-ink-heading outline-hidden placeholder:text-ink-muted"
              />
              <MagnifyingGlassIcon aria-hidden="true" className="pointer-events-none col-start-1 row-start-1 ml-4 size-5 self-center text-ink-muted" />
            </div>

            {results.length > 0 && (
              <ComboboxOptions static className="max-h-80 scroll-pt-11 scroll-pb-2 space-y-2 overflow-y-auto pb-2">
                {groups.map(([group, list]) => (
                  <li key={group}>
                    <h2 className="bg-ink-heading/5 px-4 py-2 font-semibold tracking-wide text-ink-body">{group}</h2>
                    <ul className="mt-2 text-ink-body">
                      {list.map((item) => {
                        const Icon = item.icon;
                        return (
                          <ComboboxOption
                            key={item.id}
                            value={item}
                            as="li"
                            className="flex cursor-default items-center gap-3 px-4 py-2 select-none data-focus:bg-accent/20 data-focus:text-ink-heading"
                          >
                            {Icon && <Icon aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />}
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {item.hint && <span className="shrink-0 truncate text-ink-muted">{item.hint}</span>}
                          </ComboboxOption>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ComboboxOptions>
            )}

            {query === "" && results.length === 0 && (
              <div className="border-t border-ink-heading/10 px-6 py-14 text-center sm:px-14">
                <GlobeAmericasIcon className="mx-auto size-6 text-ink-muted" aria-hidden="true" />
                <p className="mt-4 font-semibold text-ink-heading">Nothing to show yet</p>
              </div>
            )}

            {query !== "" && results.length === 0 && (
              <div className="border-t border-ink-heading/10 px-6 py-14 text-center sm:px-14">
                <FaceFrownIcon className="mx-auto size-6 text-ink-muted" aria-hidden="true" />
                <p className="mt-4 font-semibold text-ink-heading">No results found</p>
                <p className="mt-2 text-ink-soft">Nothing matches “{query}”. Try another term.</p>
              </div>
            )}
          </Combobox>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-heading/10 bg-ink-heading/5 px-4 py-2.5 text-ink-soft">
            <span>
              <kbd className="rounded border border-ink-heading/20 px-1 font-semibold text-ink-body">↑↓</kbd> move
            </span>
            <span>
              <kbd className="rounded border border-ink-heading/20 px-1 font-semibold text-ink-body">Enter</kbd> open
            </span>
            <span>
              <kbd className="rounded border border-ink-heading/20 px-1 font-semibold text-ink-body">Esc</kbd> close
            </span>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
