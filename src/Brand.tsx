import { cx } from "./ui";

/* Layout styles for the app shell (everything else comes from the kit in ui.tsx). */
const BRAND = "flex items-center gap-2.5 font-brand tracking-[.1em] whitespace-nowrap text-ink-heading uppercase";
export const AVATAR = "grid size-8 shrink-0 place-items-center rounded-full border border-accent-line bg-accent-bg font-brand tracking-[.03em] text-ink-accent";

const LOGO_SIZES = {
  md: "size-[2.4667rem] rounded-[0.7333rem] [&_svg]:size-[1.8rem]",
  sm: "size-[2.0667rem] rounded-[0.6rem] [&_svg]:size-[1.5333rem]",
  signin: "size-[2.2rem] rounded-[0.6rem] [&_svg]:size-6",
} as const;

function LogoMark({ size = "md" }: { size?: keyof typeof LOGO_SIZES }) {
  return (
    <div
      className={cx("grid place-items-center border border-logo-edge bg-linear-to-br from-logo-from to-logo-to text-ink-accent shadow-[inset_0_1px_0_rgba(255,255,255,.05)]", LOGO_SIZES[size])}
      aria-hidden="true"
    >
      <svg viewBox="100 100 824 824" fill="none" stroke="currentColor" strokeWidth="84" strokeLinecap="round" strokeLinejoin="round">
        <path d="M210 700 L400 500 L540 610 L790 280" />
        <path d="M640 280 H790 V430" />
      </svg>
    </div>
  );
}

export function Brand({ size = "md", className = "", collapsible = false }: { size?: keyof typeof LOGO_SIZES; className?: string; collapsible?: boolean }) {
  return (
    <div className={cx(BRAND, className)}>
      <LogoMark size={size} />
      <span className={cx("leading-tight", collapsible && "max-[900px]:hidden")}>
        Scalable Capital <span className="block font-medium text-ink-muted">Desktop</span>
      </span>
    </div>
  );
}
