import { describe, expect, it } from "vitest";
import { describeAccessToken, describeRefreshToken, formatDuration, type SessionInfo } from "./session";

const base: SessionInfo = { signedIn: true, signedInAt: 0, accessExpiresAt: 1845, refreshIssuedAt: 1000, refreshExpiresAt: null };

describe("formatDuration", () => {
  it("uses the two largest units", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(845)).toBe("14 min 05 s");
    expect(formatDuration(3600 * 3 + 60 * 12)).toBe("3 h 12 min");
    expect(formatDuration(86400 * 2 + 3600 * 4)).toBe("2 d 4 h");
    expect(formatDuration(-5)).toBe("0 s");
  });
});

describe("describeAccessToken", () => {
  it("counts down and reports expiry", () => {
    expect(describeAccessToken(base, 1000)).toBe("Valid for 14 min 05 s, renews automatically");
    expect(describeAccessToken(base, 2000)).toContain("Expired");
    expect(describeAccessToken(null, 0)).toBe("Signed out");
  });
});

describe("describeRefreshToken", () => {
  it("never invents an expiry", () => {
    expect(describeRefreshToken(base, 1000 + 86400 * 2)).toBe("Last renewed 2 d 0 h ago, expiry not published by Scalable");
    expect(describeRefreshToken({ ...base, refreshIssuedAt: null }, 5)).toContain("expiry not published");
  });
  it("shows the expiry when Scalable states it", () => {
    expect(describeRefreshToken({ ...base, refreshExpiresAt: 1000 + 86400 * 29 }, 1000)).toBe("Expires in 29 d 0 h");
  });
});
