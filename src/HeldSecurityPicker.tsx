import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions, Field, Label } from "@headlessui/react";
import { useState } from "react";
import type { HeldPosition } from "./types";
import { btn, field } from "./ui";

type Props = {
  held: HeldPosition[];
  selected: HeldPosition | null;
  onChange: (position: HeldPosition | null) => void;
};

/** Search box over the securities in the portfolio (name, ticker or ISIN) that shows the chosen one with a Change link. */
export function HeldSecurityPicker({ held, selected, onChange }: Props) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const matches = held.filter((item) => needle === "" || [item.name, item.symbol, item.isin].some((text) => text.toLowerCase().includes(needle)));

  return (
    <Field className={field.label}>
      <Label>Security</Label>
      {selected ? (
        <div className="flex items-center justify-between gap-2.5 rounded-control border border-line-strong bg-inset px-2.5 py-2">
          <div>
            <strong className="block text-ink-strong">{selected.name}</strong>
            <small className={field.hint}>{selected.isin}</small>
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
        <Combobox<HeldPosition | null>
          value={null}
          onChange={(item) => {
            if (item) onChange(item);
          }}
        >
          <ComboboxInput
            autoFocus
            className={field.input}
            displayValue={() => search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder={held.length === 0 ? "No securities held in this portfolio" : "Search your holdings by name, ticker or ISIN"}
            disabled={held.length === 0}
          />
          <ComboboxOptions
            anchor={{ to: "bottom start", gap: 4, padding: 8 }}
            className="z-[70] w-(--input-width) overflow-y-auto rounded-panel border border-line-strong bg-surface p-1 shadow-[0_14px_40px_var(--pop-shadow)] outline-none empty:hidden"
          >
            {matches.map((item) => (
              <ComboboxOption
                key={item.isin}
                value={item}
                className="cursor-pointer rounded-control px-2.5 py-2 data-focus:bg-hover [&_small]:block [&_small]:text-ink-muted [&_strong]:block [&_strong]:text-ink-strong"
              >
                <strong>{item.name}</strong>
                <small>{item.isin}</small>
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        </Combobox>
      )}
    </Field>
  );
}
