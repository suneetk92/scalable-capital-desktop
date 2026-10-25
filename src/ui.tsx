import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Radio, RadioGroup, Switch as HeadlessSwitch } from "@headlessui/react";
import { ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { CheckCircleIcon, InformationCircleIcon, ShieldCheckIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { clampPanelWidth, clampSplit, loadPanelWidth, loadSplit, PANEL_DEFAULT_WIDTH, PANEL_MIN_WIDTH, savePanelWidth, saveSplit, SPLIT_DEFAULT } from "./panel";
import { useRef, useState, type ComponentType, type CSSProperties, type ReactNode, type Ref, type SVGProps } from "react";

/*
 * Small Tailwind-only building blocks (badges, toggles, alerts, pill tabs). They use utility
 * classes only, so they follow the font-size setting (rem based) and the colour tokens of both
 * themes.
 */

const BADGE_TONES = {
  gray: { box: "bg-ink-soft/10 text-ink-soft", dot: "fill-gray-400" },
  red: { box: "bg-danger-bg text-danger-ink", dot: "fill-danger-ink" },
  yellow: { box: "bg-warn-bg text-warn-ink", dot: "fill-warn-ink" },
  green: { box: "bg-up/10 text-up", dot: "fill-up" },
  blue: { box: "bg-blue-400/10 text-blue-400 light:text-blue-700", dot: "fill-blue-400" },
  purple: { box: "bg-purple-400/10 text-purple-400", dot: "fill-purple-400" },
} as const;

type BadgeTone = keyof typeof BADGE_TONES;

export function securityTypeTone(type: string): BadgeTone {
  const key = type.trim().toUpperCase();
  if (key === "STOCK") return "blue";
  if (key === "ETF" || key === "FUND") return "green";
  if (key === "DERIVATIVE") return "yellow";
  if (key === "CRYPTO") return "purple";
  return "gray";
}

/** "Flat with dot" badge (Badges 10). */
export function Badge({ tone = "gray", title, children }: { tone?: BadgeTone; title?: string; children: ReactNode }) {
  const colors = BADGE_TONES[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-x-1.5 rounded-control px-2 py-1 font-medium ${colors.box}`}>
      <svg viewBox="0 0 6 6" aria-hidden="true" className={`size-1.5 ${colors.dot}`}>
        <circle r={3} cx={3} cy={3} />
      </svg>
      {children}
    </span>
  );
}

/** Simple toggle (Toggles 01) on Headless UI's Switch: keyboard, focus ring and `role="switch"` come with it. */
export function Switch({ label, checked, onToggle, disabled = false }: { label: string; checked: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <HeadlessSwitch
      checked={checked}
      onChange={() => onToggle()}
      disabled={disabled}
      aria-label={label}
      className="group relative inline-flex w-11 shrink-0 cursor-pointer rounded-full bg-ink-heading/10 p-0.5 inset-ring inset-ring-ink-heading/10 transition-colors duration-200 ease-in-out data-checked:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-50 data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent"
    >
      <span aria-hidden="true" className="size-5 rounded-full bg-white shadow-xs ring-1 ring-gray-900/5 transition-transform duration-200 ease-in-out group-data-checked:translate-x-5" />
    </HeadlessSwitch>
  );
}

/** Alert with accent border (Alerts 05) and optional dismiss button (Alerts 06). */
export function Alert({ children, onDismiss, className = "" }: { children: ReactNode; onDismiss?: () => void; className?: string }) {
  return (
    <div role="alert" className={`mb-3.5 flex rounded-r-control border-l-4 border-danger-line bg-danger-bg p-3 ${className}`}>
      <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger-ink" />
      <p className="ml-3 min-w-0 flex-1 break-words text-danger-ink">{children}</p>
      {onDismiss && <IconButton label="Dismiss error" icon={XMarkIcon} tone="danger" size="md" className="-m-1 ml-3 h-fit" onClick={onDismiss} />}
    </div>
  );
}

/** Pill options used as a segmented control, built on Headless UI's RadioGroup (arrow keys, roving focus). */
export function Pills<T extends string>({ label, value, options, onSelect }: { label: string; value: T; options: [T, string][]; onSelect: (value: T) => void }) {
  return (
    <RadioGroup value={value} onChange={onSelect} aria-label={label} className="flex shrink-0 flex-wrap gap-1 rounded-control bg-ink-heading/5 p-1">
      {options.map(([key, text]) => (
        <Radio
          key={key}
          value={key}
          className="cursor-pointer rounded-control px-3 py-1.5 font-medium text-ink-soft transition-colors hover:text-ink-body data-checked:bg-ink-heading/10 data-checked:text-ink-heading data-checked:shadow-xs data-focus:outline-2 data-focus:outline-accent"
        >
          {text}
        </Radio>
      ))}
    </RadioGroup>
  );
}

type IconType = ComponentType<SVGProps<SVGSVGElement>>;
type Tone = "up" | "down";

const TONE_TEXT: Record<Tone, string> = { up: "text-up", down: "text-down" };

/* ---------- Stats ---------- */

export function StatGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl aria-label={label} className="mb-5 grid grid-cols-2 gap-3 min-[1081px]:grid-cols-4">
      {children}
    </dl>
  );
}

export function Stat({ label, value, foot, icon: Icon, tone }: { label: string; value: ReactNode; foot?: ReactNode; icon: IconType; tone?: Tone }) {
  return (
    <div className={`relative flex flex-col overflow-hidden rounded-panel border px-4 py-3.5 border-accent-line bg-linear-to-br from-accent-bg to-surface`}>
      <div className="flex items-center justify-between gap-3">
        <dt className="min-w-0 text-caption font-semibold tracking-wider text-ink-muted uppercase">{label}</dt>
        <span className={`grid size-9 shrink-0 place-items-center rounded-control border border-accent-line bg-accent/10 text-ink-accent`}>
          <Icon aria-hidden="true" className="size-5" />
        </span>
      </div>
      <dd className={`mt-1 text-stat font-semibold tracking-tight ${tone ? TONE_TEXT[tone] : "text-ink-strong"}`}>{value}</dd>
      {foot && <dd className="mt-1 flex items-center gap-1.5 text-ink-muted">{foot}</dd>}
    </div>
  );
}

/* ---------- Cards and description lists ---------- */

export function CardGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="mb-5 grid grid-cols-1 gap-3 min-[901px]:grid-cols-2 min-[1700px]:grid-cols-3">
      {children}
    </section>
  );
}

export function Card({ title, hint, wide = false, children }: { title: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <article className={`rounded-panel border border-line bg-surface px-[1.2rem] py-4 ${wide ? "col-span-full" : ""}`}>
      <h2 className="mb-2.5 text-section font-semibold tracking-tight text-ink-strong">
        {title}
        {hint && <small className="ml-1.5 text-caption font-normal tracking-normal text-ink-muted">{hint}</small>}
      </h2>
      {children}
    </article>
  );
}

export function DescriptionList({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-ink-heading/10">{children}</dl>;
}

export function DescriptionRow({ label, children, tone, extra }: { label: ReactNode; children: ReactNode; tone?: Tone; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3.5 py-2.5">
      <dt className="min-w-0 truncate text-ink-soft">{label}</dt>
      {extra && <dd className="min-w-0 truncate text-ink-soft">{extra}</dd>}
      <dd className={`ml-auto inline-flex items-center gap-1.5 font-semibold tabular-nums ${tone ? TONE_TEXT[tone] : "text-ink-strong"}`}>
        {(tone === "up" || tone === "down") && <span aria-hidden="true">{tone === "up" ? "▲" : "▼"}</span>}
        {children}
      </dd>
    </div>
  );
}

/* ---------- Docked right column: sits beside the page under the top bar, no backdrop, width set by dragging its left edge ---------- */

const RESIZE_STEP = 24;

/** Fills the height of the main area. Below 900px it overlays the page when `overlay` is set and is hidden otherwise. */
export function Dock({ label, overlay, children }: { label: string; overlay: boolean; children: ReactNode }) {
  const [width, setWidth] = useState(() => clampPanelWidth(loadPanelWidth(), window.innerWidth));
  const [dragging, setDragging] = useState(false);
  const resize = (next: number) => {
    const clamped = clampPanelWidth(next, window.innerWidth);
    setWidth(clamped);
    return clamped;
  };
  return (
    <aside
      aria-label={label}
      style={{ width }}
      className={cx(
        "relative flex h-full max-w-full shrink-0 flex-col border-l border-line bg-surface",
        overlay ? "max-[900px]:fixed max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-40 max-[900px]:shadow-[0_25px_50px_-12px_var(--pop-shadow)]" : "max-[900px]:hidden",
        dragging && "select-none",
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to change the width. Double-click to reset."
        className={cx(
          "absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none hover:bg-accent/40 data-focus:bg-accent/40 focus-visible:bg-accent/40",
          dragging && "bg-accent/40",
        )}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (dragging) resize(window.innerWidth - event.clientX);
        }}
        onPointerUp={(event) => {
          setDragging(false);
          savePanelWidth(resize(window.innerWidth - event.clientX));
        }}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => savePanelWidth(resize(PANEL_DEFAULT_WIDTH))}
        onKeyDown={(event) => {
          const delta = event.key === "ArrowLeft" ? RESIZE_STEP : event.key === "ArrowRight" ? -RESIZE_STEP : 0;
          if (delta === 0) return;
          event.preventDefault();
          savePanelWidth(resize(width + delta));
        }}
      />
      {children}
    </aside>
  );
}

/** Stacks the upper panel over the lower one with a draggable divider; the share is remembered. Without one of them the other fills the dock. */
export function DockSplit({ top, bottom }: { top: ReactNode; bottom: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [share, setShare] = useState(loadSplit);
  const [dragging, setDragging] = useState(false);
  const at = (clientY: number) => {
    const box = ref.current?.getBoundingClientRect();
    return box && box.height > 0 ? clampSplit((clientY - box.top) / box.height) : share;
  };
  const both = Boolean(top && bottom);
  // The same elements stay in the same places whichever panels are shown, so closing the lower panel does not remount the upper one (an embedded widget would reload).
  return (
    <div ref={ref} style={{ "--top": share, "--bottom": 1 - share } as CSSProperties} className={cx("flex min-h-0 flex-1 flex-col", dragging && "select-none")}>
      {top ? <div className={cx("flex min-h-0 flex-col", both ? "[flex:var(--top)_1_0%] max-[900px]:hidden" : "flex-1")}>{top}</div> : <div hidden />}
      {both ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize watchlist and security details"
          aria-valuemin={15}
          aria-valuemax={85}
          aria-valuenow={Math.round(share * 100)}
          tabIndex={0}
          title="Drag to change the height. Double-click to reset."
          className={cx(
            "relative h-px shrink-0 bg-line max-[900px]:hidden",
            "before:absolute before:inset-x-0 before:-top-1 before:z-10 before:h-2 before:cursor-row-resize before:touch-none hover:before:bg-accent/40 focus-visible:before:bg-accent/40 focus-visible:outline-none",
            dragging && "before:bg-accent/40",
          )}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (dragging) setShare(at(event.clientY));
          }}
          onPointerUp={(event) => {
            setDragging(false);
            const next = at(event.clientY);
            setShare(next);
            saveSplit(next);
          }}
          onPointerCancel={() => setDragging(false)}
          onDoubleClick={() => {
            setShare(SPLIT_DEFAULT);
            saveSplit(SPLIT_DEFAULT);
          }}
          onKeyDown={(event) => {
            const delta = event.key === "ArrowUp" ? -0.04 : event.key === "ArrowDown" ? 0.04 : 0;
            if (delta === 0) return;
            event.preventDefault();
            const next = clampSplit(share + delta);
            setShare(next);
            saveSplit(next);
          }}
        />
      ) : (
        <div hidden />
      )}
      {bottom ? <div className={cx("flex min-h-0 flex-col", both ? "[flex:var(--bottom)_1_0%] max-[900px]:flex-1" : "flex-1")}>{bottom}</div> : <div hidden />}
    </div>
  );
}

/** One panel in the dock with its own header and scrolling body; the panels share the dock's height. */
export function Drawer({ title, subtitle, onClose, footer, children }: { title: string; subtitle?: ReactNode; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-ink-heading/10 px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-ink-heading">{title}</h2>
          {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
        </div>
        <IconButton label="Close panel" icon={XMarkIcon} className="-m-1.5" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-heading/10 px-5 py-3">{footer}</div>}
    </section>
  );
}

/* ---------- Confirm dialog ---------- */

export function ConfirmDialog({ title, text, confirmLabel, onConfirm, onCancel }: { title: string; text: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ModalFrame size="sm" alert onClose={onCancel}>
      <div className="flex gap-4">
        <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-danger-bg">
          <ExclamationTriangleIcon aria-hidden="true" className="size-6 text-danger-ink" />
        </div>
        <div className="min-w-0">
          <ModalTitle>{title}</ModalTitle>
          <p className={MODAL_TEXT}>{text}</p>
        </div>
      </div>
      <DialogFooter className="mt-6">
        <button className={btn.secondary} type="button" autoFocus onClick={onCancel}>
          Cancel
        </button>
        <button className={btn.danger} type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </DialogFooter>
    </ModalFrame>
  );
}

/* ---------- Toast notification ---------- */

export const TOAST_KINDS = {
  ok: { Icon: CheckCircleIcon, color: "text-up", title: "Done" },
  error: { Icon: XCircleIcon, color: "text-danger-ink", title: "Something went wrong" },
  info: { Icon: InformationCircleIcon, color: "text-warn-ink", title: "Note" },
} as const;

/** Bottom-right container that stacks the toasts, newest at the bottom. */
export function ToastStack({ children }: { children: ReactNode }) {
  return <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex flex-col items-end gap-2.5 px-4 py-5 sm:p-6">{children}</div>;
}

export function Toast({ kind, title, onDismiss, children }: { kind: keyof typeof TOAST_KINDS; title?: string; onDismiss: () => void; children: ReactNode }) {
  const { Icon, color, title: kindTitle } = TOAST_KINDS[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-panel bg-raised shadow-[0_10px_15px_-3px_var(--pop-shadow)] outline-1 outline-ink-heading/10 animate-toast-in"
    >
      <div className="flex items-start gap-3 p-4">
        <Icon aria-hidden="true" className={`size-6 shrink-0 ${color}`} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="font-medium text-ink-heading">{title ?? kindTitle}</p>
          <p className="mt-1 break-words text-ink-body">{children}</p>
        </div>
        <IconButton label="Dismiss" icon={XMarkIcon} tone="muted" size="md" className="-m-1" onClick={onDismiss} />
      </div>
    </div>
  );
}

/* ====================================================================================
 * Shared style kit: one place that names each repeated look (buttons, form fields, tables,
 * tabs, lists), used as className={...}.
 * Everything is rem/em based, so the font-size setting and the light theme keep working,
 * and `compact:` follows the table-density setting (see the custom variant in index.css).
 * ==================================================================================== */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/** Up or down triangle for a signed number, so a gain or loss does not rest on colour alone; nothing for zero or unknown. */
export function SignGlyph({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined || value === 0) return null;
  return (
    <span aria-hidden="true" className="mr-1 text-[0.75em]">
      {value > 0 ? "▲" : "▼"}
    </span>
  );
}

/** Colour for a signed number. `!` keeps it ahead of table/list colours. */
export function signClass(value: number | null | undefined, neutral = "") {
  if (value === null || value === undefined) return neutral;
  return value > 0 ? "text-up!" : value < 0 ? "text-down!" : neutral;
}

const BTN_BASE = "shrink-0 cursor-pointer rounded-control border font-semibold whitespace-nowrap";
const TRADE_BASE = "h-7 cursor-pointer rounded-control bg-raised px-2.5 font-semibold border enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40";

export const btn = {
  secondary:
    "flex h-[2.2rem] shrink-0 cursor-pointer items-center gap-[0.4667rem] rounded-control border border-line-strong bg-raised px-3 whitespace-nowrap text-ink-body hover:border-line-hover hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-[1.2rem]",
  primary: `${BTN_BASE} h-[2.3333rem] border-buy-edge bg-buy px-3.5 text-on-accent enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50`,
  danger: `${BTN_BASE} h-[2.2rem] border-danger-edge bg-sell px-3.5 text-white enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50`,
  trade: `${TRADE_BASE} border-line-strong`,
  buy: `${TRADE_BASE} border-accent-line-strong text-up`,
  sell: `${TRADE_BASE} border-danger-line text-down`,
  /** Text-style button, e.g. "Change", "Clear", "Done". */
  link: "cursor-pointer border-0 bg-transparent px-0.5 text-ink-accent disabled:cursor-default disabled:text-ink-faint",
  /** On/off pill in the page heading. Only the "on" state is coloured (amber for Trading, accent otherwise); "off" is neutral. */
  mode: (on: boolean, onTone: "accent" | "warn" = "accent") =>
    cx(
      "flex cursor-pointer items-center gap-[0.3333rem] rounded border px-2 py-1.5 [&_svg]:size-3.5",
      !on && "border-line-strong bg-raised text-ink-muted hover:text-ink-body",
      on && onTone === "warn" && "border-warn-line bg-warn-bg text-warn-ink",
      on && onTone === "accent" && "border-accent-line bg-accent-bg text-ink-accent",
    ),
} as const;

const ICON_BUTTON_SIZES = {
  sm: "size-6 [&_svg]:size-4",
  md: "size-7 [&_svg]:size-4",
  lg: "size-9 [&_svg]:size-5",
} as const;

const ICON_BUTTON_TONES = {
  soft: "text-ink-soft hover:bg-hover hover:text-ink-strong",
  muted: "text-ink-muted hover:bg-hover hover:text-ink-strong",
  danger: "text-danger-ink hover:bg-danger-line hover:text-danger-ink-hover",
} as const;

/** Class names of an icon-only button; use it for a trigger that is not a plain `<button>` (Headless UI's buttons). */
export function iconButtonClass(tone: keyof typeof ICON_BUTTON_TONES = "soft", size: keyof typeof ICON_BUTTON_SIZES = "lg") {
  return cx("grid shrink-0 cursor-pointer place-items-center rounded-control disabled:cursor-not-allowed disabled:opacity-60", ICON_BUTTON_SIZES[size], ICON_BUTTON_TONES[tone]);
}

/** Icon-only button; `label` is its accessible name (and hover text unless `title` is given). */
export function IconButton({
  label,
  icon: Icon,
  tone,
  size,
  title,
  disabled,
  className,
  onClick,
}: {
  label: string;
  icon: IconType;
  tone?: keyof typeof ICON_BUTTON_TONES;
  size?: keyof typeof ICON_BUTTON_SIZES;
  title?: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-label={label} title={title} disabled={disabled} className={cx(iconButtonClass(tone, size), className)} onClick={onClick}>
      <Icon aria-hidden="true" />
    </button>
  );
}

export const field = {
  label: "mb-3.5 grid gap-1.5 text-ink-soft",
  input: "box-border h-9 w-full rounded-control border border-line-strong bg-inset px-2.5 text-ink-strong focus:outline focus:outline-accent",
  textarea: "box-border h-24 w-full resize-y rounded-control border border-line-strong bg-inset px-2.5 py-2 font-mono text-ink-strong focus:outline focus:outline-accent",
  hint: "text-[1em] text-ink-muted",
  /** A field's own error, placed under it as a Headless UI `Description` so it is announced with the field. */
  error: "text-[1em] text-danger-ink",
  /** Amber notice box (add your own margins). */
  note: "rounded-control border border-warn-line bg-warn-ink/10 px-3 py-2.5 leading-normal break-words text-warn-ink",
} as const;

/** Muted one-line message. */
export const EMPTY = "text-ink-muted";

/** Paragraph inside a dialog. */
export const MODAL_TEXT = "break-words leading-relaxed text-ink-soft";

/* ---------- Lists with a label on the left and a value on the right ---------- */

export const LIST = "grid";
export const LIST_ITEM =
  "flex items-center justify-between gap-3.5 border-b border-line py-[0.6rem] text-ink-soft last:border-b-0 [&>:last-child:not(:first-child)]:ml-auto [&>span]:min-w-0 [&>span]:truncate [&_strong]:font-semibold [&_strong]:tabular-nums [&_strong]:text-ink-strong";

/* ---------- Tables ---------- */

const TABLE_BASE =
  "w-full border-collapse text-right whitespace-nowrap text-ink-body " +
  "[&_td_.flex]:justify-end [&_td_[data-security-logo]]:order-last " +
  "[&_th]:h-[2.6rem] [&_th]:border-b [&_th]:border-line [&_th]:px-4 [&_th]:font-label [&_th]:text-ink-muted " +
  "[&_td]:h-14 [&_td]:border-b [&_td]:border-line [&_td]:px-4 [&_td]:align-middle " +
  "[&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:hover]:bg-raised " +
  "compact:[&_th]:h-8 compact:[&_td]:h-[2.2667rem]";
/** Main screener table: the header sticks to the top of its scroll area, with a blurred backdrop (Tables - sticky header). */
export const TABLE = `${TABLE_BASE} [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-[1] [&_thead]:bg-surface/80 [&_thead]:backdrop-blur-md`;
/** Table for arbitrary tool records (long values are cut off). The header does not stick, so it never covers rows in a scrolling panel. */
export const RECORD_TABLE = `${TABLE_BASE} [&_td]:max-w-[18.6667rem] [&_td]:overflow-hidden [&_td]:text-ellipsis [&_th]:max-w-[18.6667rem] [&_th]:overflow-hidden [&_th]:text-ellipsis [&_code]:text-ink-accent-bright`;
/** Small static table (settings preview). */
export const PREVIEW_TABLE = `${TABLE_BASE} [&_td]:px-3 [&_th]:px-3`;
export const SCROLL_X = "overflow-x-auto";
export const TH_NUM = "min-w-[8.6667rem] text-right";
export const TD_NUM = "text-right tabular-nums";
export const NAME_COLUMN = "min-w-72";

/* ---------- Panels and tabs ---------- */

export const PANEL = "overflow-hidden rounded-panel border border-line-strong bg-chrome";
const PANEL_BAR = "flex min-h-[2.2rem] items-center justify-between border-b border-line px-4 text-ink-muted";
const LIVE_DOT = "shrink-0 rounded-full bg-accent shadow-[0_0_9px_color-mix(in_srgb,var(--color-accent)_55%,transparent)]";
const PANEL_TITLE = "flex items-center gap-[0.4667rem] text-caption font-title tracking-wider uppercase";

export function PanelHeader({ title, children, className }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx(PANEL_BAR, className)}>
      <span className={PANEL_TITLE}>
        <span className={`size-[0.3333rem] ${LIVE_DOT}`} /> {title}
      </span>
      <span className="flex items-center gap-2.5">{children}</span>
    </div>
  );
}

/** Padding for text, alerts and loading rows inside a panel; a table sits flush against the panel edges instead. */
export const PANEL_BODY = "px-4 py-3.5";

/** Last line of a data panel: where the data comes from and the access level. */
export function PanelFooter({ tradingEnabled, manageEnabled }: { tradingEnabled: boolean; manageEnabled: boolean }) {
  return (
    <footer className="flex min-h-[2.3333rem] items-center justify-between border-t border-line px-4 text-ink-muted [&>span:last-child]:flex [&>span:last-child]:items-center [&>span:last-child]:gap-[0.3333rem] [&_svg]:size-3 [&_svg]:text-ink-accent-dim">
      <span>Data provided by Scalable Capital</span>
      <span>
        <ShieldCheckIcon aria-hidden="true" /> Secure connection · {tradingEnabled ? "Trading enabled" : manageEnabled ? "Restricted access" : "Read only"}
      </span>
    </footer>
  );
}

export const TABS = "flex gap-[1.2rem] self-stretch";
export function tabClass(active: boolean, pad = "px-0.5") {
  return cx(
    "relative flex cursor-pointer items-center gap-[0.4667rem] hover:text-ink-body [&>svg]:size-[1.2667rem] [&>span]:rounded-[0.2rem] [&>span]:bg-hover [&>span]:px-[0.3333rem] [&>span]:py-0.5 [&>span]:text-ink-muted",
    pad,
    active ? "text-ink-strong after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-accent [&>svg]:text-ink-accent" : "text-ink-muted",
  );
}

/* ---------- Security cell (logo or monogram + symbol + name), shared by the table and the settings preview ---------- */

/** The company logo (a `data:` image) when there is one that loads, otherwise the monogram. */
function SecurityLogo({ initials, logo }: { initials: string; logo?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const shown = logo && failed !== logo;
  return (
    <span data-security-logo="" className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-control border border-line-strong bg-hover font-bold text-ink-body compact:size-6">
      {shown ? <img className="size-full object-contain" src={logo} alt="" onError={() => setFailed(logo)} /> : initials}
    </span>
  );
}

/** The small "D" for a price that is not real time; the delay is in the hover text and the accessible name. */
function DelayBadge({ label, title }: { label: string; title: string }) {
  return (
    <span role="img" aria-label={title} title={title} className="cursor-help rounded-[0.2rem] border border-line px-1 text-[0.7rem] leading-4 font-semibold text-ink-muted">
      {label}
    </span>
  );
}

export function SecurityCell({ initials, logo, title, subtitle, badge }: { initials: string; logo?: string; title: ReactNode; subtitle?: ReactNode; badge?: { label: string; title: string } | null }) {
  return (
    <div className="flex items-center gap-2.5 compact:gap-2">
      <SecurityLogo initials={initials} logo={logo} />
      <span className="grid gap-0.5 leading-[1.2] compact:gap-0 compact:leading-[1.1]">
        {badge ? (
          <span className="flex items-center gap-1.5">
            <strong className="font-semibold text-ink-strong">{title}</strong>
            <DelayBadge {...badge} />
          </span>
        ) : (
          <strong className="font-semibold text-ink-strong">{title}</strong>
        )}
        <small className="max-w-80 overflow-hidden text-[1em] text-ellipsis text-ink-muted">{subtitle}</small>
      </span>
    </div>
  );
}

export const SPIN = "animate-[spin_0.8s_linear_infinite]";

/** Glowing bar along the top edge of the window while data loads or refreshes. */
export function LoadBar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div role="progressbar" aria-label="Loading data" className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[0.2rem] overflow-hidden bg-accent/15">
      <div className="h-full w-[30%] animate-load-bar rounded-full bg-accent shadow-[0_0_10px_2px_color-mix(in_srgb,var(--color-accent)_70%,transparent)] motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
    </div>
  );
}

/* ---------- Modal dialog frame ---------- */

/** The three dialog widths: `sm` for confirmations, `md` for forms and order flows, `lg` for tables and raw data. */
const DIALOG_SIZES = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" } as const;

/**
 * Dim backdrop plus card, with focus trapping, Escape and outside click handled by Headless UI (`onClose`).
 * Tall content scrolls inside the card. `alert` is for confirmations: they open above other dialogs.
 */
export function ModalFrame({ size = "md", alert = false, onClose, children }: { size?: keyof typeof DIALOG_SIZES; alert?: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open role={alert ? "alertdialog" : "dialog"} onClose={onClose} className={cx("relative", alert ? "z-[60]" : "z-50")}>
      <DialogBackdrop className="fixed inset-0 bg-[rgba(8,10,14,0.7)] animate-fade-in" />
      <div className="fixed inset-0 grid place-items-center p-4">
        <DialogPanel
          className={cx("max-h-[92vh] w-full overflow-y-auto rounded-modal border border-line-strong bg-surface p-6 shadow-[0_20px_60px_var(--pop-shadow)] animate-fade-in", DIALOG_SIZES[size])}
        >
          {children}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export function ModalTitle({ children, titleRef }: { children: ReactNode; titleRef?: Ref<HTMLHeadingElement> }) {
  return (
    <DialogTitle as="h2" ref={titleRef} tabIndex={-1} className="mb-2 font-semibold text-ink-heading">
      {children}
    </DialogTitle>
  );
}

/** Title row with a close button. */
export function ModalHeader({ title, closeLabel, onClose }: { title: string; closeLabel: string; onClose: () => void }) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <DialogTitle as="h2" className="font-semibold text-ink-heading">
        {title}
      </DialogTitle>
      <IconButton label={closeLabel} icon={XMarkIcon} onClick={onClose} />
    </div>
  );
}

/** Button row at the bottom of a dialog: Cancel, Back or Close first, the primary action last. */
export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("flex flex-wrap items-center justify-end gap-2.5", className)}>{children}</div>;
}
