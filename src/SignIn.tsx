import { ArrowTopRightOnSquareIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { Brand } from "./Brand";

const EYEBROW = "flex items-center gap-[0.4667rem] font-title tracking-[.15em] text-ink-muted uppercase";
const EYEBROW_DOT = "size-1.5 rounded-full bg-accent shadow-[0_0_8px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]";

export function SignInScreen({
  busy,
  error,
  notice,
  onSignIn,
}: {
  busy: boolean;
  error: string | null;
  /** The update notice, shown above the card. */
  notice?: ReactNode;
  onSignIn: () => void;
}) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[radial-gradient(ellipse_at_49%_36%,var(--signin-bg-1)_0,var(--signin-bg-2)_48%,var(--signin-bg-3)_100%)] p-[2.3333rem] max-[640px]:p-4">
      {notice && <div className="absolute inset-x-0 top-4 z-10 mx-auto w-[min(calc(100%-2rem),40rem)]">{notice}</div>}
      <div className="pointer-events-none absolute size-184 rounded-full border border-accent/5 [transform:scaleX(1.43)_rotate(-18deg)]" />
      <div className="pointer-events-none absolute size-248 rounded-full border border-accent/[.03] [transform:scaleX(1.2)_rotate(29deg)]" />
      <div className="relative w-[min(100%,32.1333rem)] rounded-modal border border-line-strong bg-[linear-gradient(150deg,var(--signin-card-1),var(--signin-card-2)_62%)] px-7 pt-6 pb-5 shadow-[0_28px_90px_var(--pop-shadow),inset_0_1px_var(--card-highlight)] max-[640px]:px-5">
        <Brand size="signin" />
        <div className="mt-6 mb-7 rounded-panel border border-line-strong bg-[linear-gradient(130deg,var(--signin-art-1),var(--signin-art-2))] px-4 pt-3.5 pb-3" aria-hidden="true">
          <div className="flex items-center justify-between font-title tracking-widest text-ink-muted uppercase">
            <span>Preview</span>
          </div>
          <svg viewBox="0 0 440 158" preserveAspectRatio="none" className="my-2 block h-[5.0667rem] w-full text-accent">
            <defs>
              <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 124 C24 119 35 127 58 108 S92 102 111 112 S148 97 165 101 S189 83 211 91 S243 79 260 85 S294 59 313 68 S348 55 366 58 S405 35 440 20 V158 H0Z" fill="url(#chart-fill)" />
            <path
              d="M0 124 C24 119 35 127 58 108 S92 102 111 112 S148 97 165 101 S189 83 211 91 S243 79 260 85 S294 59 313 68 S348 55 366 58 S405 35 440 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <circle cx="440" cy="20" r="4" fill="currentColor" />
          </svg>
          <div className="flex items-center justify-between tracking-widest text-ink-faint uppercase">
            <span>Scalable Capital</span>
            <span>Sample chart</span>
          </div>
        </div>
        <div>
          <div className={EYEBROW}>
            <span className={EYEBROW_DOT} /> Private portfolio terminal
          </div>
          <h1 className="mt-4 mb-3 text-[1.9rem] leading-[1.13] font-[540] tracking-[-.04em] text-ink-heading">
            Your market view,
            <br />
            <span className="text-ink-accent-bright">all in one place.</span>
          </h1>
          <p className="mb-6 max-w-112 leading-[1.7] text-ink-soft">
            Connect your Scalable Capital account to see your portfolio holdings and watchlist in a clean, focused screener, and place orders when you choose to.
          </p>
          {error && (
            <div className="mb-4 rounded border border-danger-line bg-danger-bg px-3 py-2 leading-normal text-danger-ink" role="alert">
              {error}
            </div>
          )}
          {busy && (
            <p className="mb-3 leading-normal text-ink-muted" role="status">
              A browser window has opened. Finish signing in there; this window updates automatically. The sign-in link expires after 3 minutes. If it times out, the sign-in button will be available
              again.
            </p>
          )}
          <button
            className="flex h-12 w-full cursor-pointer items-center justify-center gap-2.5 rounded-control border border-cta-edge bg-linear-to-b from-cta-from to-cta-to font-bold text-on-accent shadow-[0_5px_18px_rgba(48,186,150,.12),inset_0_1px_rgba(255,255,255,.25)] transition enabled:hover:-translate-y-px enabled:hover:brightness-[1.08] disabled:cursor-wait disabled:opacity-65"
            type="button"
            onClick={onSignIn}
            disabled={busy}
          >
            <ShieldCheckIcon className="size-4 shrink-0" aria-hidden="true" />
            {busy ? "Waiting for secure sign-in…" : "Continue with Scalable Capital"}
            {!busy && <ArrowTopRightOnSquareIcon className="size-3.5 shrink-0 opacity-80" aria-hidden="true" />}
          </button>
          <div className="mt-3 flex items-start gap-2 leading-normal text-ink-muted [&_svg]:mt-[.2em] [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-accent-dim">
            <ShieldCheckIcon aria-hidden="true" /> Sign-in opens on Scalable’s secure website. Your password never enters this app.
          </div>
          <p className="mt-5 leading-normal text-ink-faint">
            Independent project, not affiliated with or endorsed by Scalable Capital. For information only, not investment advice. © 2026 Suneet Kumar, Apache-2.0.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-1.5 border-t border-line pt-4 text-center text-caption font-title tracking-wider text-ink-faint uppercase">
          <span className="whitespace-nowrap">Account view · Optional trading</span>
          <span className="whitespace-nowrap">Desktop · Encrypted storage</span>
        </div>
      </div>
    </main>
  );
}
