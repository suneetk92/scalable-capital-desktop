import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { CheckboxField } from "./controls";
import type { PreviewReview as Review, ReviewField } from "./previewReview";
import { btn, field } from "./ui";

/** Label on the left, value on the right; used for every list of fields in the dialogs. */
export const LINES =
  "mb-3.5 grid gap-1.5 [&>div]:flex [&>div]:justify-between [&>div]:gap-4 [&>div]:border-b [&>div]:border-line [&>div]:pb-1.5 [&_dt]:text-ink-soft [&_dd]:text-right [&_dd]:break-words [&_dd]:text-ink-strong";

const HEADING = "mb-1.5 font-semibold text-ink-heading";

/** Seconds left until `expiresAt`, counted down every second; null when the preview has no expiry. */
export function usePreviewExpiry(expiresAt: number | null): { expired: boolean; label: string | null } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  if (expiresAt === null) return { expired: false, label: null };
  const left = Math.max(0, Math.round((expiresAt - now) / 1000));
  return { expired: left === 0, label: left === 0 ? "This preview has expired. Go back and preview again." : `Valid for ${Math.floor(left / 60)} min ${String(left % 60).padStart(2, "0")} s` };
}

function Fields({ fields }: { fields: ReviewField[] }) {
  return (
    <dl className={LINES}>
      {fields.map((line, index) => (
        <div key={`${line.label}-${index}`}>
          <dt>{line.label}</dt>
          <dd>{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type Props = {
  review: Review;
  /** Ids of the acknowledgements the user has ticked. */
  accepted: string[];
  onAccepted: (ids: string[]) => void;
  expired: boolean;
  expiryLabel: string | null;
};

/**
 * The review of a preview from Scalable: warnings first, then the sections Scalable prepared for display
 * (costs, quote, calculation), its documents and disclosures, and one tick box per statement the user has to accept.
 */
export function PreviewReviewBody({ review, accepted, onAccepted, expired, expiryLabel }: Props) {
  return (
    <>
      {review.notices.length > 0 && (
        <div className={`${field.note} mb-3.5 grid gap-1.5`} role="note">
          {review.notices.map((notice, index) => (
            <div key={`${notice.title ?? ""}-${index}`}>
              {notice.title && (
                <strong>
                  {notice.title}
                  {notice.text ? ": " : ""}
                </strong>
              )}
              {notice.text}
            </div>
          ))}
        </div>
      )}
      {review.sections.map((section, index) => (
        <section key={`${section.title}-${index}`} aria-label={section.title}>
          <h3 className={HEADING}>{section.title}</h3>
          {section.fields.length > 0 && <Fields fields={section.fields} />}
          {section.items.map((item, position) => (
            <div key={`${item.label}-${position}`}>
              <h4 className="mb-1 text-ink-muted">{item.label}</h4>
              <Fields fields={item.fields} />
            </div>
          ))}
        </section>
      ))}
      {review.documents.length > 0 && (
        <p className="mb-3.5 flex flex-wrap gap-x-4 gap-y-1">
          {review.documents.map((link) => (
            <button key={link.url} type="button" className={btn.link} onClick={() => void openUrl(link.url).catch(() => undefined)}>
              {link.label} ↗
            </button>
          ))}
        </p>
      )}
      {review.disclosures.length > 0 && (
        <div className="mb-3.5 grid gap-1.5 text-caption text-ink-muted">
          {review.disclosures.map((disclosure) => (
            <p key={disclosure}>{disclosure}</p>
          ))}
        </div>
      )}
      {review.acknowledgements.map((acknowledgement) => (
        <CheckboxField
          key={acknowledgement.id}
          className="mb-3.5 text-warn-ink!"
          checked={accepted.includes(acknowledgement.id)}
          onChange={(checked) => onAccepted(checked ? [...accepted, acknowledgement.id] : accepted.filter((id) => id !== acknowledgement.id))}
        >
          {acknowledgement.text}
        </CheckboxField>
      ))}
      {expiryLabel && (
        <p className={`mb-3.5 ${expired ? "text-down" : "text-ink-muted"}`} role={expired ? "alert" : undefined}>
          {expiryLabel}
        </p>
      )}
    </>
  );
}
