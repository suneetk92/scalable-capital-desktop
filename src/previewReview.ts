import { humanize } from "./tools";
import { isRec, parseMaybeJson, recordsOf, stringsOf, type Rec } from "./response";

export type ReviewField = { label: string; value: string };
type ReviewSection = { title: string; fields: ReviewField[]; items: { label: string; fields: ReviewField[] }[] };
type ReviewNotice = { title?: string; text: string };
type ReviewAcknowledgement = { id: string; text: string };

/** What the order and savings-plan dialogs show of a `preview_*` answer. */
export type PreviewReview = {
  /** Things to read first: warnings, an outdated quote, a security that cannot be traded. */
  notices: ReviewNotice[];
  sections: ReviewSection[];
  /** One statement per acknowledgement the user must accept before the submit tool is called. */
  acknowledgements: ReviewAcknowledgement[];
  documents: { label: string; url: string }[];
  disclosures: string[];
  /** The preview's expiry in ms since the epoch, when Scalable gives one. */
  expiresAt: number | null;
  /** True when Scalable says this cannot be submitted from here, so the user has to continue in Scalable. */
  blocked: boolean;
  /** Scalable's own page for the same action, to use when the client cannot submit. */
  handoffUrl: string | null;
};

const NOT_APPLICABLE = "Not applicable";
const DEFAULT_ACK = "I have read the appropriateness warning and want to proceed.";

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return NOT_APPLICABLE;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function fieldsOf(value: unknown): ReviewField[] {
  return recordsOf(value).map((entry) => ({ label: text(entry.label) ?? humanize(String(entry.id ?? "")), value: display(entry.value) }));
}

/** Sections in the shape of `reviewPresentation`: `{ sections: [{ title, fields: [{ label, value }], items: [{ label, fields }] }] }`. */
function presentedSections(source: unknown): ReviewSection[] {
  if (!isRec(source) || !Array.isArray(source.sections)) return [];
  return source.sections
    .filter(isRec)
    .map((section) => ({
      title: text(section.title) ?? humanize(String(section.id ?? "")),
      fields: fieldsOf(section.fields),
      items: recordsOf(section.items).map((item) => ({ label: text(item.label) ?? humanize(String(item.id ?? "")), fields: fieldsOf(item.fields) })),
    }))
    .filter((section) => section.fields.length > 0 || section.items.length > 0);
}

/** Every leaf of a value as a labelled field; the label comes from the path to it. */
function flatten(value: unknown, path: string[] = [], out: ReviewField[] = [], depth = 0): ReviewField[] {
  if (depth > 5 || value === undefined) return out;
  if (value === null || typeof value !== "object") {
    if (value !== null && value !== "") out.push({ label: (humanize(path.join(" ")) || "Value").replace(/\bisin\b/i, "ISIN"), value: display(value) });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, [...path, String(index + 1)], out, depth + 1));
    return out;
  }
  for (const [key, child] of Object.entries(value)) flatten(child, [...path, key], out, depth + 1);
  return out;
}

/** Sections made from a plain object: each nested object becomes a section, the loose values one "Details" section. */
function objectSections(source: Rec, skip: string[] = []): ReviewSection[] {
  const sections: ReviewSection[] = [];
  const loose: ReviewField[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (skip.includes(key)) continue;
    if (isRec(value)) {
      const fields = flatten(value);
      if (fields.length > 0) sections.push({ title: humanize(key), fields, items: [] });
    } else {
      loose.push(...flatten(value, [key]));
    }
  }
  return loose.length > 0 ? [{ title: "Details", fields: loose, items: [] }, ...sections] : sections;
}

/** The review sections: Scalable's own presentation first, then the review text, then the typed fields of the preview. */
function sectionsOf(preview: Rec): ReviewSection[] {
  const presented = presentedSections(preview.reviewPresentation);
  if (presented.length > 0) return presented;
  const review = parseMaybeJson(preview.userReview); // Scalable sends some reviews as a JSON string
  const fromReview = presentedSections(review);
  if (fromReview.length > 0) return fromReview;
  if (isRec(review)) {
    const made = objectSections(review);
    if (made.length > 0) return made;
  }
  const typed: ReviewSection[] = [];
  for (const key of ["security", "effectiveConfiguration", "calculation", "marketQuote", "tradability"]) {
    const fields = flatten(preview[key]);
    if (fields.length > 0) typed.push({ title: humanize(key), fields, items: [] });
  }
  if (isRec(preview.exAnteCosts)) typed.push(...objectSections(preview.exAnteCosts, ["id"]));
  return typed;
}

function noticesOf(preview: Rec): ReviewNotice[] {
  const notices: ReviewNotice[] = [];
  const warning = isRec(preview.warning) ? preview.warning : null;
  if (warning && (text(warning.body) ?? text(warning.title))) notices.push({ title: text(warning.title) ?? undefined, text: text(warning.body) ?? "" });
  for (const entry of Array.isArray(preview.priceWarnings) ? preview.priceWarnings : []) {
    const message = isRec(entry) ? text(entry.message) : null;
    if (message) notices.push({ text: message });
  }
  const tradability = isRec(preview.tradability) ? preview.tradability : null;
  if (tradability?.tradable === false) {
    const venue = text(tradability.selectedVenueLabel);
    const reason = text(tradability.selectedVenueUnavailabilityReason);
    notices.push({
      title: "Cannot be traded here",
      text: [venue ? `${venue} is not available for this order.` : "This order cannot be placed.", reason ? `${humanize(reason)}.` : ""].filter(Boolean).join(" "),
    });
  }
  const suitability = isRec(preview.suitability) ? preview.suitability : null;
  if (suitability?.questionnaireRequired === true) {
    notices.push({ title: "Questionnaire needed", text: "Scalable asks you to complete a suitability questionnaire in the Scalable app before this can be placed." });
  }
  if (isRec(preview.marketQuote) && preview.marketQuote.isOutdated === true) {
    notices.push({ title: "Outdated quote", text: "The price Scalable used for this preview is outdated; the market may be closed." });
  }
  return notices;
}

/** The acknowledgement ids the submit tool needs, as the preview's `submission` lists them. */
export function requiredAcknowledgementIds(preview: unknown): string[] {
  if (!isRec(preview) || !isRec(preview.submission) || !isRec(preview.submission.confirmationContext)) return [];
  const ids = preview.submission.confirmationContext.requiredAcknowledgementIds;
  return stringsOf(ids);
}

function acknowledgementsOf(preview: Rec): ReviewAcknowledgement[] {
  const listed = recordsOf(preview.requiredAcknowledgements);
  const fallback = isRec(preview.warning) ? text(preview.warning.acknowledgementText) : null;
  return requiredAcknowledgementIds(preview).map((id) => {
    const entry = listed.find((item) => item.id === id);
    return { id, text: (entry ? text(entry.acknowledgementText) : null) ?? fallback ?? DEFAULT_ACK };
  });
}

function documentsOf(preview: Rec): { label: string; url: string }[] {
  if (!isRec(preview.documentLinks)) return [];
  return Object.values(preview.documentLinks)
    .filter(isRec)
    .map((link) => ({ label: text(link.label) ?? "Document", url: text(link.url) ?? "" }))
    .filter((link) => link.url.startsWith("https://"));
}

export function reviewOf(preview: unknown): PreviewReview {
  const source = isRec(preview) ? preview : {};
  const disclosureSource = isRec(source.regulatoryDisclosures) ? source.regulatoryDisclosures : {};
  const disclosures = ["marketDataNotice", "executionInstruction", "exAnteCostsNotice"].map((key) => text(disclosureSource[key])).filter((entry): entry is string => entry !== null);
  const expires = typeof source.expiresAt === "string" ? Date.parse(source.expiresAt) : NaN;
  const handoff = isRec(source.brokerHandoff) ? text(source.brokerHandoff.url) : null;
  const tradability = isRec(source.tradability) ? source.tradability : null;
  const suitability = isRec(source.suitability) ? source.suitability : null;
  return {
    notices: noticesOf(source),
    sections: sectionsOf(source),
    acknowledgements: acknowledgementsOf(source),
    documents: documentsOf(source),
    disclosures,
    expiresAt: Number.isFinite(expires) ? expires : null,
    blocked: tradability?.tradable === false || suitability?.questionnaireRequired === true,
    handoffUrl: handoff?.startsWith("https://") ? handoff : null,
  };
}
