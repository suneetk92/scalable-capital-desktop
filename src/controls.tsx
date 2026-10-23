import {
  Checkbox,
  Description,
  Field,
  Input,
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Radio,
  Popover,
  PopoverButton,
  PopoverPanel,
  RadioGroup,
} from "@headlessui/react";
import { ColumnHead } from "./ColumnHead";
import type { ColumnLayout } from "./hooks/useTableLayout";
import { useElapsedShare } from "./countdown";
import { ArrowPathIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpDownIcon, MinusIcon } from "@heroicons/react/20/solid";
import type { ComponentProps, ComponentType, InputHTMLAttributes, ReactNode, Ref, SVGProps } from "react";
import { btn, cx, LoadBar, SPIN, TH_NUM } from "./ui";
import { selectionState, selectOptions } from "./selection";
import type { SortState } from "./sorting";

/*
 * Form controls, menus and page furniture built on Headless UI (focus handling, keyboard navigation and ARIA
 * come from the library) and styled with the same colour tokens as the rest of the kit in ui.tsx.
 */

type IconType = ComponentType<SVGProps<SVGSVGElement>>;
type MenuAnchor = ComponentProps<typeof MenuItems>["anchor"];

/* ---------- Select menu (Headless UI Listbox) ---------- */

type SelectOption<T extends string | number> = { value: T; label: ReactNode; hint?: ReactNode };

const SELECT_SIZES = {
  /** Full-width form field, same box as `field.input`. */
  field: "h-9 w-full px-2.5",
  /** Compact control for settings rows and list rows. */
  compact: "h-[2.2rem] min-w-[12.6667rem] px-2",
  /** Small selector that sits in a line of text, under a title. */
  inline: "h-6 gap-1 overflow-hidden px-1.5 leading-none text-ink-soft",
} as const;

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  label,
  placeholder,
  disabled,
  size = "field",
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  /** Accessible name; a surrounding `<Field><Label>` takes precedence. */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: keyof typeof SELECT_SIZES;
  className?: string;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      <ListboxButton
        aria-label={label}
        className={cx(
          "flex cursor-pointer items-center justify-between gap-2 rounded-control border border-line-strong bg-inset text-left text-ink-strong data-disabled:cursor-not-allowed data-disabled:opacity-50 data-focus:outline data-focus:outline-accent data-open:border-line-hover",
          SELECT_SIZES[size],
          className,
        )}
      >
        <span className={cx("min-w-0 truncate", !current && "text-ink-muted")}>{current ? current.label : (placeholder ?? "Choose…")}</span>
        <ChevronUpDownIcon aria-hidden="true" className={cx("shrink-0 text-ink-muted", size === "inline" ? "size-4" : "size-5")} />
      </ListboxButton>
      <ListboxOptions
        anchor={{ to: "bottom start", gap: 4, padding: 8 }}
        transition
        className={cx(
          "z-[70] max-h-72 w-(--button-width) min-w-44 rounded-panel border border-line-strong bg-surface p-1 shadow-[0_14px_40px_var(--pop-shadow)] outline-none transition duration-100 ease-out [--anchor-gap:4px] data-closed:opacity-0",
          options.length > 8 ? "overflow-y-auto" : "overflow-hidden",
        )}
      >
        {options.map((option) => (
          <ListboxOption
            key={option.value}
            value={option.value}
            className="group flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-ink-body select-none data-focus:bg-hover data-focus:text-ink-heading"
          >
            <CheckIcon aria-hidden="true" className="invisible size-4 shrink-0 text-ink-accent group-data-selected:visible" />
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.hint && <span className="shrink-0 text-ink-muted">{option.hint}</span>}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  );
}

/* ---------- Checkboxes and radio groups ---------- */

const BOX =
  "group grid size-4 shrink-0 cursor-pointer place-items-center border border-line-hover bg-inset data-checked:border-accent data-checked:bg-accent data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent data-indeterminate:border-accent data-indeterminate:bg-accent";

/** Checkbox with a clickable label and optional description. */
export function CheckboxField({
  checked,
  indeterminate = false,
  onChange,
  children,
  hint,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <Field className={cx("flex items-start gap-2 py-1 text-ink-body", className)}>
      <Checkbox checked={checked} indeterminate={indeterminate} onChange={onChange} className={cx(BOX, "mt-[0.2rem] rounded-[0.2rem]")}>
        <CheckIcon aria-hidden="true" className="size-3 text-on-accent opacity-0 group-data-checked:opacity-100 group-data-indeterminate:hidden" />
        <MinusIcon aria-hidden="true" className="hidden size-3 text-on-accent group-data-indeterminate:block" />
      </Checkbox>
      <div className="min-w-0">
        <Label className="cursor-pointer">{children}</Label>
        {hint && <Description className="block text-ink-muted">{hint}</Description>}
      </div>
    </Field>
  );
}

export function SelectAllField({
  options,
  selected,
  onChange,
  matching = false,
}: {
  options: readonly string[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  matching?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <CheckboxField {...selectionState(options, selected)} onChange={(checked) => onChange(selectOptions(options, selected, checked))}>
      {matching ? "Select all matches" : "Select all"}
    </CheckboxField>
  );
}

/** Label-less checkbox for table rows and the select-all header. */
export function RowCheckbox({ checked, indeterminate = false, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <Checkbox checked={checked} indeterminate={indeterminate} onChange={onChange} aria-label={label} className={cx(BOX, "rounded-[0.2rem]")}>
      <CheckIcon aria-hidden="true" className="size-3 text-on-accent opacity-0 group-data-checked:opacity-100 group-data-indeterminate:hidden" />
      <MinusIcon aria-hidden="true" className="hidden size-3 text-on-accent group-data-indeterminate:block" />
    </Checkbox>
  );
}

/** Vertical radio list. */
export function RadioList<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, ReactNode][]; onChange: (value: T) => void }) {
  return (
    <RadioGroup value={value} onChange={onChange} aria-label={label} className="grid">
      {options.map(([key, text]) => (
        <Field key={key} className="flex items-center gap-2 py-1 text-ink-body">
          <Radio value={key} className={cx(BOX, "rounded-full")}>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-on-accent opacity-0 group-data-checked:opacity-100" />
          </Radio>
          <Label className="cursor-pointer">{text}</Label>
        </Field>
      ))}
    </RadioGroup>
  );
}

/* ---------- Input group ---------- */

/** `invalid` marks the input (`aria-invalid`) and the group's border; put the message in a `Description` of the same `Field`. */
export function GroupInput({ prefix, suffix, className, invalid, ...props }: { prefix?: ReactNode; suffix?: ReactNode; invalid?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "prefix">) {
  return (
    <div
      className={cx(
        "flex h-9 w-full items-center rounded-control border border-line-strong bg-inset focus-within:outline focus-within:outline-accent has-[[data-invalid]]:border-danger-line",
        className,
      )}
    >
      {prefix && <span className="pl-2.5 text-ink-muted select-none">{prefix}</span>}
      <Input {...props} invalid={invalid} className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-ink-strong outline-none placeholder:text-ink-faint" />
      {suffix && <span className="pr-2.5 text-ink-muted select-none">{suffix}</span>}
    </div>
  );
}

/* ---------- Dropdown menu ---------- */

export const MENU_PANEL =
  "z-[70] rounded-panel border border-line-strong bg-surface p-1.5 shadow-[0_14px_40px_var(--pop-shadow)] outline-none transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0";
const MENU_ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-control px-2 py-[0.6rem] text-left data-disabled:cursor-not-allowed data-disabled:opacity-55 [&_svg]:size-5 [&_svg]:shrink-0";
const MENU_ITEM_NORMAL = `${MENU_ITEM} text-ink-body data-focus:bg-hover data-focus:text-ink-heading`;
const MENU_ITEM_DANGER = `${MENU_ITEM} text-danger-ink data-focus:bg-danger-bg data-focus:text-danger-ink-hover`;

export type MenuEntry = {
  id: string;
  label: ReactNode;
  icon?: IconType;
  /** Right-aligned status text, e.g. "On". */
  hint?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

export function DropdownMenu({
  button,
  buttonClassName,
  buttonLabel,
  items,
  header,
  anchor = "bottom end",
  panelClassName = "w-60",
}: {
  button: ReactNode;
  buttonClassName: string;
  buttonLabel?: string;
  items: (MenuEntry | "divider")[];
  header?: ReactNode;
  anchor?: MenuAnchor;
  panelClassName?: string;
}) {
  return (
    <Menu>
      <MenuButton aria-label={buttonLabel} className={buttonClassName}>
        {button}
      </MenuButton>
      <MenuItems anchor={anchor} transition className={cx(MENU_PANEL, panelClassName)}>
        {header}
        {items.map((item, index) => {
          if (item === "divider") return <div key={`divider-${index}`} role="separator" className="my-[0.3333rem] h-px bg-line" />;
          const Icon = item.icon;
          return (
            <MenuItem key={item.id} disabled={item.disabled}>
              <button type="button" className={item.danger ? MENU_ITEM_DANGER : MENU_ITEM_NORMAL} onClick={item.onSelect}>
                {Icon && <Icon aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && <span className="ml-auto shrink-0 text-ink-muted">{item.hint}</span>}
              </button>
            </MenuItem>
          );
        })}
      </MenuItems>
    </Menu>
  );
}

/* ---------- Empty states ---------- */

export function EmptyState({ icon: Icon, title, text, action }: { icon: IconType; title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-md justify-items-center gap-1 px-4 py-9 text-center">
      <div className="mb-2 grid size-11 place-items-center rounded-[0.6rem] border border-line-strong bg-raised text-ink-muted [&_svg]:size-6">
        <Icon aria-hidden="true" />
      </div>
      <strong className="font-label text-ink-body">{title}</strong>
      {text && <span className="text-ink-muted">{text}</span>}
      {action && <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/* ---------- Page headings ---------- */

export function PageHeading({ section = "Workspace", title, description, actions }: { section?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6">
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-ink-muted">
        <span>{section}</span>
        <ChevronRightIcon aria-hidden="true" className="size-4 text-ink-faint" />
        <span aria-current="page" className="font-label text-ink-body">
          {title}
        </span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3.5">
        <div className="min-w-0">
          <h1 className="text-page font-semibold tracking-[-.03em] text-ink-heading">{title}</h1>
          {description && <p className="mt-1 text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-[0.6rem] pb-px">{actions}</div>}
      </div>
    </header>
  );
}

/** Thin share bar used next to money values (allocation of a total). */
export function ShareBar({ share, label }: { share: number; label: string }) {
  const percent = Math.max(0, Math.min(100, share * 100));
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className="h-1.5 overflow-hidden rounded-full bg-ink-heading/10">
      <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
    </div>
  );
}

/* ---------- Skeleton loading ---------- */

function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded bg-ink-heading/10", className)} />;
}

/** Placeholder table rows shown while data loads. */
export function SkeletonRows({ rows = 5, columns = 4, label }: { rows?: number; columns?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-3.5 py-2">
      <p className="text-sm text-ink-muted">{label}</p>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4">
          <Skeleton className="size-8 shrink-0 rounded-control" />
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className={cx("h-3.5", column === 0 ? "w-1/3" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Whole-app placeholder (sidebar, stats, table) shown while the dashboard loads. */
export function LoadingShell({ brand }: { brand: ReactNode }) {
  return (
    <main className="flex h-screen overflow-hidden bg-canvas" aria-busy="true">
      <LoadBar active />
      <aside className="flex h-screen w-[16.6667rem] flex-none flex-col gap-3 border-r border-line bg-chrome px-3.5 pt-[1.4667rem] pb-3.5 max-[1080px]:w-[14.2667rem] max-[900px]:w-[4.1333rem] max-[640px]:hidden">
        {brand}
        <div className="mt-12 grid gap-2.5">
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="h-9" />
          ))}
        </div>
      </aside>
      <section className="min-w-0 flex-1 overflow-hidden">
        <div className="h-[3.8667rem] border-b border-line bg-chrome" />
        <div className="w-full px-8 pt-[2.0667rem] max-[640px]:px-[0.8667rem]">
          <div className="mb-5 grid grid-cols-2 gap-3 min-[1081px]:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-[5.8667rem] rounded-panel" />
            ))}
          </div>
          <div className="rounded-panel border border-line-strong bg-chrome px-4 py-3.5">
            <SkeletonRows rows={7} columns={4} label="Loading your dashboard…" />
          </div>
        </div>
      </section>
    </main>
  );
}

/* ---------- Pagination ---------- */

function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  const wanted = new Set([1, 2, pageCount - 1, pageCount, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pageCount));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) out.push("gap");
    out.push(value);
  });
  return out;
}

/** Column header that sorts its table when clicked; `numeric` columns are right-aligned. */
export function SortHeader({
  label,
  column,
  sort,
  onSort,
  numeric = false,
  className,
  layout,
}: {
  label: string;
  column: string;
  sort: SortState;
  onSort: (column: string) => void;
  numeric?: boolean;
  className?: string;
  /** Makes the column movable and resizable. */
  layout?: ColumnLayout;
}) {
  const active = sort !== null && sort.key === column;
  const button = <SortButton label={label} column={column} active={active} direction={sort?.direction ?? "descending"} onSort={onSort} start={!numeric} />;
  if (layout) {
    return (
      <ColumnHead id={column} label={label} layout={layout} className={cx(numeric && TH_NUM, className)} sortState={active ? sort.direction : "none"}>
        {button}
      </ColumnHead>
    );
  }
  return (
    <th scope="col" className={cx(numeric && TH_NUM, className)} aria-sort={active ? sort.direction : "none"}>
      {button}
    </th>
  );
}

export function SortButton({
  label,
  column,
  active,
  direction,
  onSort,
  start = false,
  title,
}: {
  label: string;
  title?: string;
  column: string;
  active: boolean;
  direction: "ascending" | "descending";
  onSort: (column: string) => void;
  start?: boolean;
}) {
  return (
    <button
      className={cx("inline-flex cursor-pointer items-center gap-[0.3333rem] hover:text-ink-body", start ? "justify-start" : "w-full flex-row-reverse justify-start", active && "text-ink-body")}
      type="button"
      title={title}
      aria-label={`Sort by ${label}`}
      onClick={() => onSort(column)}
    >
      {label}
      <ChevronDownIcon className={cx("size-3.5 opacity-55 transition-transform", active && direction === "ascending" && "rotate-180")} aria-hidden="true" />
    </button>
  );
}

const PAGE_BUTTON =
  "inline-flex min-w-9 cursor-pointer items-center justify-center rounded-control border border-transparent px-2 py-1.5 text-ink-soft hover:bg-hover hover:text-ink-heading disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

export function Pagination({ page, pageCount, total, pageSize, onPage }: { page: number; pageCount: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  if (pageCount <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-ink-muted">
      <p>
        Showing <strong className="font-semibold text-ink-body">{from}</strong> to <strong className="font-semibold text-ink-body">{to}</strong> of{" "}
        <strong className="font-semibold text-ink-body">{total}</strong> results
      </p>
      <div className="flex items-center gap-1">
        <button type="button" className={PAGE_BUTTON} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeftIcon aria-hidden="true" className="size-5" />
        </button>
        {pageWindow(page, pageCount).map((entry, index) =>
          entry === "gap" ? (
            <span key={`gap-${index}`} className="px-1 text-ink-faint">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              aria-current={entry === page ? "page" : undefined}
              aria-label={`Page ${entry}`}
              onClick={() => onPage(entry)}
              className={cx(PAGE_BUTTON, entry === page && "border-accent-line bg-accent-bg font-semibold text-ink-accent hover:bg-accent-bg hover:text-ink-accent")}
            >
              {entry}
            </button>
          ),
        )}
        <button type="button" className={PAGE_BUTTON} disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRightIcon aria-hidden="true" className="size-5" />
        </button>
      </div>
    </nav>
  );
}

/* ---------- Feed ---------- */

export type FeedItem = {
  id: string;
  icon: IconType;
  tone?: "up" | "down" | "neutral";
  title: ReactNode;
  meta?: ReactNode;
  amount?: ReactNode;
  amountTone?: "up" | "down";
  actions?: ReactNode;
};

const FEED_TONES = { up: "bg-up/15 text-up", down: "bg-down/15 text-down", neutral: "bg-ink-heading/10 text-ink-soft" } as const;

export function Feed({ items, label }: { items: FeedItem[]; label: string }) {
  return (
    <ul role="list" aria-label={label} className="grid">
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <li key={item.id} className="relative flex gap-3.5 pb-5 last:pb-0">
            {index < items.length - 1 && <span aria-hidden="true" className="absolute top-9 bottom-1 left-4 w-px -translate-x-1/2 bg-line-strong" />}
            <span className={cx("relative grid size-8 shrink-0 place-items-center rounded-full", FEED_TONES[item.tone ?? "neutral"])}>
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 font-medium text-ink-strong">{item.title}</p>
                {item.amount && (
                  <span className={cx("font-semibold tabular-nums", item.amountTone === "up" ? "text-up" : item.amountTone === "down" ? "text-down" : "text-ink-strong")}>{item.amount}</span>
                )}
              </div>
              {item.meta && <p className="mt-0.5 text-ink-muted">{item.meta}</p>}
              {item.actions && <div className="mt-2 flex flex-wrap gap-1.5">{item.actions}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Table toolbar: search box and Filters popover, shared by the screener table and Transactions ---------- */

export const FILTER_TITLE = "mt-2 mb-1.5 font-title tracking-[.1em] text-ink-muted uppercase first:mt-0";

/** Search field with a magnifier; the default width is the toolbar's, `className` replaces it (e.g. `w-full` inside a popover). */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  inputRef,
  shortcut = false,
  className = "w-[21rem] max-[900px]:flex-1",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  inputRef?: Ref<HTMLInputElement>;
  shortcut?: boolean;
  className?: string;
}) {
  return (
    <label className={cx("flex h-[2.2rem] items-center gap-[0.4667rem] rounded-control border border-line-strong bg-inset px-2 text-ink-muted [&>svg]:size-[1.2rem] [&>svg]:shrink-0", className)}>
      <MagnifyingGlassIcon aria-hidden="true" />
      <input
        ref={inputRef}
        className="w-full min-w-0 bg-transparent text-ink-strong outline-0 placeholder:text-ink-faint"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {shortcut && <kbd className="shrink-0 rounded-[0.2rem] border border-line-strong bg-raised px-1 py-px text-[1em] text-ink-faint">Ctrl+K</kbd>}
    </label>
  );
}

const MENU_ROW = "flex w-full cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-left text-ink-body hover:bg-hover hover:text-ink-heading";

export function MenuRowButton({ children, className, type = "button", ...props }: ComponentProps<"button">) {
  return (
    <button {...props} type={type} className={cx(MENU_ROW, className)}>
      {children}
    </button>
  );
}

/** The "Filters" button with the number of active filters; `children` are the filter groups, followed by Clear and Done. */
export function FiltersPopover({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  return (
    <Popover className="relative">
      <PopoverButton className="flex h-[2.2rem] cursor-pointer items-center gap-[0.4667rem] rounded-control border border-line-strong bg-raised px-2 text-ink-soft outline-none hover:border-line-hover hover:bg-hover data-focus:outline-2 data-focus:outline-accent data-open:border-line-hover data-open:bg-hover">
        <span className="grid w-[0.8667rem] gap-[0.2rem] [&>i]:block [&>i]:h-px [&>i]:bg-ink-soft [&>i:nth-child(2)]:w-[0.6rem] [&>i:nth-child(3)]:w-[0.3333rem]">
          <i />
          <i />
          <i />
        </span>
        <span>Filters</span>
        <span className="rounded-[0.2rem] bg-hover px-1 py-px text-ink-soft">{count}</span>
      </PopoverButton>
      <PopoverPanel transition anchor={{ to: "bottom end", gap: 6, padding: 8 }} className={cx(MENU_PANEL, "max-h-[min(80vh,42.6667rem)] w-64 overflow-y-auto p-3")}>
        {({ close }) => (
          <>
            {children}
            <div className="mt-2.5 flex justify-between border-t border-line pt-2">
              <button className={btn.link} type="button" onClick={onClear} disabled={count === 0}>
                Clear
              </button>
              <button className={btn.link} type="button" onClick={() => close()}>
                Done
              </button>
            </div>
          </>
        )}
      </PopoverPanel>
    </Popover>
  );
}

/** Refresh, with a thin bar along its bottom edge that drains to empty when the next automatic reload happens. */
export function RefreshButton({
  auto,
  label,
  busy,
  onRefresh,
  lastLoadedAt,
  intervalMs,
}: {
  auto: boolean;
  label: string;
  busy: boolean;
  onRefresh: () => void;
  lastLoadedAt: number | null;
  intervalMs: number;
}) {
  const share = useElapsedShare(lastLoadedAt, intervalMs, auto && lastLoadedAt !== null && !busy);
  return (
    <button
      className={cx(btn.mode(auto), "relative overflow-hidden")}
      type="button"
      onClick={onRefresh}
      disabled={busy}
      title={auto ? `Reload now. Data refreshes by itself every ${label}; the bar drains to empty when the next reload happens. Change this in Settings.` : "Reload the current data now."}
    >
      <ArrowPathIcon aria-hidden="true" className={busy ? SPIN : ""} /> Refresh
      {auto && <span className="font-normal opacity-80">· every {label}</span>}
      {auto && lastLoadedAt !== null && !busy && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-ink-heading/10">
          <span className="block h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${(1 - share) * 100}%` }} />
        </span>
      )}
    </button>
  );
}
