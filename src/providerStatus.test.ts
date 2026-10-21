import { describe, expect, it } from "vitest";
import { INITIAL_STATUSES, reduceProviderStatus, sanitizeError, statusLines, type ProviderEvent, type ProviderStatuses } from "./providerStatus";

const run = (events: ProviderEvent[]): ProviderStatuses => events.reduce(reduceProviderStatus, INITIAL_STATUSES);
const at = new Date(2026, 9, 20, 14, 32).getTime();

describe("reduceProviderStatus", () => {
  it("starts with every provider fine and nothing to show", () => {
    expect(INITIAL_STATUSES.scalable).toEqual({ state: "ok", lastSuccess: null, lastError: null });
    expect(statusLines(INITIAL_STATUSES)).toEqual([]);
  });

  it("records a success with its time", () => {
    expect(run([{ type: "success", provider: "scalable", at }]).scalable).toEqual({ state: "ok", lastSuccess: at, lastError: null });
  });

  it("marks a failure after a success as stale and keeps the time of the success", () => {
    const next = run([
      { type: "success", provider: "scalable", at },
      { type: "failure", provider: "scalable", message: "Network down" },
    ]);
    expect(next.scalable).toEqual({ state: "stale", lastSuccess: at, lastError: "Network down" });
  });

  it("marks a failure with no earlier success as failed", () => {
    expect(run([{ type: "failure", provider: "market-feed", message: "Timeout" }])["market-feed"]).toEqual({ state: "failed", lastSuccess: null, lastError: "Timeout" });
  });

  it("clears the error when the next attempt works", () => {
    const next = run([
      { type: "failure", provider: "scalable", message: "x" },
      { type: "success", provider: "scalable", at },
    ]);
    expect(next.scalable).toEqual({ state: "ok", lastSuccess: at, lastError: null });
  });

  it("keeps the providers apart", () => {
    const next = run([
      { type: "success", provider: "scalable", at },
      { type: "failure", provider: "market-feed", message: "x" },
    ]);
    expect(next.scalable.state).toBe("ok");
    expect(next["market-feed"]?.state).toBe("failed");
    expect(next.updater).toBe(INITIAL_STATUSES.updater);
  });

  it("does not change the previous state object", () => {
    const before = run([{ type: "success", provider: "scalable", at }]);
    reduceProviderStatus(before, { type: "failure", provider: "scalable", message: "x" });
    expect(before.scalable.state).toBe("ok");
  });
});

describe("sanitizeError", () => {
  it("masks bearer tokens, token assignments, JWTs and long key-like strings", () => {
    expect(sanitizeError("401 with Bearer abc.def.ghi rejected")).toBe("401 with Bearer [hidden] rejected");
    expect(sanitizeError("failed: access_token=abcd1234 and password: hunter2")).toBe("failed: access_token=[hidden] and password: [hidden]");
    expect(sanitizeError("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl end")).toBe("jwt [hidden] end");
    expect(sanitizeError(`key ${"a1B2".repeat(10)} used`)).toBe("key [hidden] used");
  });

  it("joins lines and cuts a long message", () => {
    expect(sanitizeError("first\n  second")).toBe("first second");
    const cut = sanitizeError("word ".repeat(100));
    expect(cut.length).toBe(160);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("leaves an ordinary message alone", () => {
    expect(sanitizeError("Scalable did not answer the ping.")).toBe("Scalable did not answer the ping.");
  });
});

describe("statusLines", () => {
  it("words a stale provider with the time of its last data", () => {
    const lines = statusLines(
      run([
        { type: "success", provider: "scalable", at },
        { type: "failure", provider: "scalable", message: "Network down" },
      ]),
    );
    expect(lines).toEqual([{ provider: "scalable", state: "stale", text: "Scalable data as of 14:32 · refresh failed", detail: "Network down" }]);
  });

  it("words a provider that never worked as unavailable", () => {
    expect(statusLines(run([{ type: "failure", provider: "market-feed", message: "Blocked" }]))[0]?.text).toBe("Market Feed unavailable");
  });

  it("uses an extension's display name", () => {
    expect(statusLines(run([{ type: "failure", provider: "market-feed", message: "Blocked" }]), { "market-feed": "Market provider" })[0]?.text).toBe("Market provider unavailable");
  });

  it("words the updater, and lists only what is not fine", () => {
    const lines = statusLines(
      run([
        { type: "success", provider: "scalable", at },
        { type: "failure", provider: "updater", message: "No route" },
        { type: "success", provider: "updater", at },
        { type: "failure", provider: "updater", message: "No route" },
      ]),
    );
    expect(lines.map((line) => line.text)).toEqual(["Update check failed · last checked 14:32"]);
  });
});
