import { describe, expect, it } from "vitest";
import { requiredAcknowledgementIds, reviewOf } from "./previewReview";

const SUBMISSION = { executionIntent: {}, confirmationContext: { requiredAcknowledgementIds: ["acknowledge_appropriateness_warning"] }, confirmationProof: "c1.x" };

// An order preview as `preview_buy_order` publishes it (shortened).
const ORDER = {
  portfolioId: "p-1",
  brokerHandoff: { action: "buy", url: "https://scalable.capital/broker/security?isin=US0378331005", useWhen: "ai_platform_blocks_action_before_submission" },
  marketQuote: { midPrice: "190", askPrice: "190.1", bidPrice: "189.9", currency: "EUR", isOutdated: true, timestampUtc: null },
  tradability: {
    status: "TRADABLE",
    selectedVenue: "gettex",
    selectedVenueLabel: "Gettex",
    selectedVenueStatus: "OPEN",
    selectedVenueUnavailabilityReason: null,
    requiresAppropriateness: true,
    tradable: true,
  },
  warning: { kind: "legacy_appropriateness_warning", title: "Complex product", body: "You could lose everything.", locale: "en", version: "3", acknowledgementText: "I understand the risk." },
  priceWarnings: [{ code: "x", message: "Your limit is far from the market price.", triggerField: "limit_price", referencePriceType: "ask", referencePrice: "190" }],
  regulatoryDisclosures: { marketDataNotice: "Prices are indicative.", executionInstruction: "Executed on Gettex.", exAnteCostsNotice: null },
  documentLinks: { clientDocuments: { label: "Client documents", url: "https://scalable.capital/docs" }, primaryKid: { label: "KID", url: "https://example.com/kid.pdf" }, secondaryKid: null },
  reviewPresentation: {
    format: "markdown_sections",
    sections: [
      {
        id: "costs",
        title: "Costs",
        fields: [
          { id: "total", label: "Total costs", value: "0.99" },
          { id: "n", label: "Note", value: null },
        ],
        items: [],
      },
      {
        id: "legs",
        title: "Breakdown",
        fields: [],
        items: [
          {
            id: "entry",
            label: "Entry costs",
            fields: [
              { id: "a", label: "Amount", value: "0.50" },
              { id: "b", label: "Included", value: true },
            ],
          },
        ],
      },
      { id: "empty", title: "Nothing", fields: [], items: [] },
    ],
  },
  requiredAcknowledgements: [
    {
      id: "acknowledge_appropriateness_warning",
      kind: "appropriateness_warning_acknowledgement",
      warningKind: null,
      warningVersion: "3",
      acknowledgementText: "I have read the warning and accept it.",
      required: true,
    },
  ],
  userReview: '{"ignored":true}',
  expiresAt: "2026-11-01T10:05:00Z",
  submission: SUBMISSION,
};

describe("reviewOf an order preview", () => {
  const review = reviewOf(ORDER);

  it("shows Scalable's own sections, with empty values and sections handled", () => {
    expect(review.sections.map((section) => section.title)).toEqual(["Costs", "Breakdown"]);
    expect(review.sections[0].fields).toEqual([
      { label: "Total costs", value: "0.99" },
      { label: "Note", value: "Not applicable" },
    ]);
    expect(review.sections[1].items).toEqual([
      {
        label: "Entry costs",
        fields: [
          { label: "Amount", value: "0.50" },
          { label: "Included", value: "Yes" },
        ],
      },
    ]);
  });

  it("puts warnings first: the product warning, price warnings and an outdated quote", () => {
    expect(review.notices.map((notice) => notice.title ?? notice.text)).toEqual(["Complex product", "Your limit is far from the market price.", "Outdated quote"]);
    expect(review.blocked).toBe(false);
  });

  it("uses the acknowledgement text of the required acknowledgement", () => {
    expect(review.acknowledgements).toEqual([{ id: "acknowledge_appropriateness_warning", text: "I have read the warning and accept it." }]);
  });

  it("keeps https documents, disclosures, the expiry and the hand-off link", () => {
    expect(review.documents.map((link) => link.label)).toEqual(["Client documents", "KID"]);
    expect(review.disclosures).toEqual(["Prices are indicative.", "Executed on Gettex."]);
    expect(review.expiresAt).toBe(Date.parse("2026-11-01T10:05:00Z"));
    expect(review.handoffUrl).toMatch(/^https:/);
  });

  it("blocks a security that cannot be traded and a missing questionnaire", () => {
    const untradable = reviewOf({ ...ORDER, tradability: { ...ORDER.tradability, tradable: false, selectedVenueUnavailabilityReason: "MARKET_CLOSED" } });
    expect(untradable.blocked).toBe(true);
    expect(untradable.notices.some((notice) => notice.title === "Cannot be traded here" && notice.text.includes("Market closed"))).toBe(true);
    expect(reviewOf({ ...ORDER, suitability: { questionnaireRequired: true } }).blocked).toBe(true);
  });

  it("ignores links that are not https", () => {
    const review = reviewOf({ ...ORDER, brokerHandoff: { url: "http://x" }, documentLinks: { a: { label: "A", url: "javascript:alert(1)" } } });
    expect(review.documents).toEqual([]);
    expect(review.handoffUrl).toBeNull();
  });
});

describe("reviewOf without reviewPresentation", () => {
  it("falls back to the review text, then to the typed fields", () => {
    const fromText = reviewOf({ userReview: JSON.stringify({ sections: [{ id: "plan", title: "Plan", fields: [{ id: "a", label: "Amount", value: "50" }] }] }), submission: SUBMISSION });
    expect(fromText.sections).toEqual([{ title: "Plan", fields: [{ label: "Amount", value: "50" }], items: [] }]);
    const fromObject = reviewOf({ userReview: JSON.stringify({ title: "Savings plan", costs: { total: "1" } }) });
    expect(fromObject.sections.map((section) => section.title)).toEqual(["Details", "Costs"]);
    const typed = reviewOf({
      effectiveConfiguration: { amount: "50", frequency: "MONTHLY" },
      exAnteCosts: { id: "abc", entryCosts: { total: { amount: "0.5", percentage: null } }, fiveYearsCosts: null },
    });
    expect(typed.sections.map((section) => section.title)).toEqual(["Effective configuration", "Entry costs"]);
    expect(typed.sections[1].fields).toEqual([{ label: "Total amount", value: "0.5" }]);
  });

  it("copes with anything that is not a preview", () => {
    for (const value of [null, undefined, "text", 3, []]) {
      const review = reviewOf(value);
      expect(review.sections).toEqual([]);
      expect(review.acknowledgements).toEqual([]);
      expect(review.expiresAt).toBeNull();
    }
  });

  it("asks for the default statement when the preview names an id but no text", () => {
    expect(reviewOf({ submission: SUBMISSION }).acknowledgements[0].text).toMatch(/appropriateness warning/);
    expect(requiredAcknowledgementIds({ submission: { confirmationContext: {} } })).toEqual([]);
  });
});
