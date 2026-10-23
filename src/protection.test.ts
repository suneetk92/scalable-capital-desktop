import { describe, expect, it } from "vite-plus/test";
import { PROTECTION_LEGS, protectionIssue } from "./protection";

describe("protectionIssue", () => {
  it("needs a positive price", () => {
    expect(protectionIssue("limit", null, null)).toMatch(/take profit/i);
    expect(protectionIssue("stop", 0, null)).toMatch(/stop loss/i);
  });

  it("accepts any positive price when the buy price is unknown", () => {
    expect(protectionIssue("limit", 50, null)).toBeNull();
    expect(protectionIssue("stop", 50, null)).toBeNull();
  });

  it("keeps take profit above and stop loss below a known buy price", () => {
    expect(protectionIssue("limit", 100, 100)).not.toBeNull();
    expect(protectionIssue("limit", 110, 100)).toBeNull();
    expect(protectionIssue("stop", 100, 100)).not.toBeNull();
    expect(protectionIssue("stop", 90, 100)).toBeNull();
  });

  it("offers a limit sell and a stop sell", () => {
    expect(PROTECTION_LEGS.map((leg) => leg.kind)).toEqual(["limit", "stop"]);
  });
});
