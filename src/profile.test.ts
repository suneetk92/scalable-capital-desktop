import { describe, expect, it } from "vite-plus/test";
import { initialsOf, profileName } from "./profile";

describe("profileName", () => {
  it("prefers the display name", () => {
    expect(profileName({ displayName: "Suneet K.", firstName: "Suneet", lastName: "Kumar" })).toBe("Suneet K.");
  });

  it("joins first and last name", () => {
    expect(profileName({ firstName: "Suneet", lastName: "Kumar" })).toBe("Suneet Kumar");
  });

  it("finds the name in wrapped and JSON-string results", () => {
    expect(profileName({ profile: { person: { fullName: "Suneet Kumar" } } })).toBe("Suneet Kumar");
    expect(profileName(JSON.stringify({ name: "Suneet Kumar" }))).toBe("Suneet Kumar");
    expect(profileName([{ givenName: "Suneet", familyName: "Kumar" }])).toBe("Suneet Kumar");
  });

  it("returns undefined when there is no name", () => {
    expect(profileName({ email: "a@b.c", country: "DE" })).toBeUndefined();
    expect(profileName(undefined)).toBeUndefined();
    expect(profileName("plain text")).toBeUndefined();
  });
});

describe("initialsOf", () => {
  it("uses first and last word", () => {
    expect(initialsOf("Suneet Kumar")).toBe("SK");
    expect(initialsOf("anna maria von Berg")).toBe("AB");
  });

  it("handles one word and no name", () => {
    expect(initialsOf("Suneet")).toBe("SU");
    expect(initialsOf(undefined)).toBe("SC");
    expect(initialsOf("  ")).toBe("SC");
  });
});
