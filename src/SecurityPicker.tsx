import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions, Field, Label } from "@headlessui/react";
import { useEffect, useState } from "react";
import type { SecurityHit } from "./OrderDialog";
import { invokeCommand } from "./commands";
import { errorText, type Invoke } from "./tools";
import { btn, field } from "./ui";

type Props = {
  security: SecurityHit | null;
  onChange: (security: SecurityHit | null) => void;
  invoke: Invoke;
  parseSearch: (payload: unknown) => SecurityHit[];
  onError: (message: string) => void;
};

/** Search box for a security (name, ticker or ISIN) that shows the chosen one with a Change link. */
export function SecurityPicker({ security, onChange, invoke, parseSearch, onError }: Props) {
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SecurityHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (security || search.trim().length < 2) {
      setHits([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const payload = await invokeCommand(invoke, "search_securities", { query: search.trim() });
        if (active) setHits(parseSearch(payload).slice(0, 8));
      } catch (searchError) {
        if (active) onError(errorText(searchError));
      } finally {
        if (active) setSearching(false);
      }
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, security, invoke, parseSearch, onError]);

  return (
    <Field className={field.label}>
      <Label>Security</Label>
      {security ? (
        <div className="flex items-center justify-between gap-2.5 rounded-control border border-line-strong bg-inset px-2.5 py-2">
          <div>
            <strong className="block text-ink-strong">{security.name}</strong>
            <small className={field.hint}>{security.isin}</small>
          </div>
          <button
            type="button"
            className={btn.link}
            onClick={() => {
              onChange(null);
              setSearch("");
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <Combobox<SecurityHit | null>
          value={null}
          onChange={(hit) => {
            if (hit) {
              onChange(hit);
              setHits([]);
            }
          }}
        >
          <ComboboxInput autoFocus className={field.input} displayValue={() => search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search name, ticker or ISIN" />
          <ComboboxOptions
            anchor={{ to: "bottom start", gap: 4, padding: 8 }}
            className="z-[70] w-(--input-width) overflow-y-auto rounded-panel border border-line-strong bg-surface p-1 shadow-[0_14px_40px_var(--pop-shadow)] outline-none empty:hidden"
          >
            {hits.map((hit) => (
              <ComboboxOption
                key={hit.isin}
                value={hit}
                className="cursor-pointer rounded-control px-2.5 py-2 data-focus:bg-hover [&_small]:block [&_small]:text-ink-muted [&_strong]:block [&_strong]:text-ink-strong"
              >
                <strong>{hit.name}</strong>
                <small>{hit.isin}</small>
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        </Combobox>
      )}
      {!security && searching && <small className={field.hint}>Searching…</small>}
    </Field>
  );
}
