import { describe, expect, it } from "vitest";
import { checked, IDLE, parseUpdateInfo, pendingInfo, progressPercent, statusMessage, withProgress, type UpdateInfo, type UpdateState } from "./updates";

const INFO: UpdateInfo = { version: "1.2.0", currentVersion: "1.1.0", notes: "Fixes", date: "2026-10-15", canInstall: true, releaseUrl: "https://updates.example.com/app/index.html" };

describe("parseUpdateInfo", () => {
  it("reads the command result", () => {
    expect(parseUpdateInfo({ ...INFO })).toEqual(INFO);
  });

  it("treats null, junk and a missing version as no update", () => {
    expect(parseUpdateInfo(null)).toBeNull();
    expect(parseUpdateInfo("1.2.0")).toBeNull();
    expect(parseUpdateInfo({ version: "  " })).toBeNull();
  });

  it("fills missing optional fields and never claims it can install by guessing", () => {
    expect(parseUpdateInfo({ version: "2.0.0", notes: 5, canInstall: "yes" })).toEqual({ version: "2.0.0", currentVersion: "", notes: null, date: null, canInstall: false, releaseUrl: null });
  });
});

describe("checked", () => {
  it("offers a new version or says the app is up to date", () => {
    expect(checked({ ...INFO })).toEqual({ status: "available", info: INFO });
    expect(checked(null)).toEqual({ status: "upToDate" });
  });
});

describe("withProgress", () => {
  const available: UpdateState = { status: "available", info: INFO };

  it("moves from available to downloading and tracks the bytes", () => {
    let state = withProgress(available, { event: "started", total: 1000 });
    expect(state).toEqual({ status: "downloading", info: INFO, received: 0, total: 1000 });
    state = withProgress(state, { event: "chunk", received: 250 });
    expect(state).toEqual({ status: "downloading", info: INFO, received: 250, total: 1000 });
    state = withProgress(state, { event: "finished" });
    expect(state).toEqual({ status: "downloading", info: INFO, received: 1000, total: 1000 });
  });

  it("ignores progress when nothing is being installed", () => {
    expect(withProgress(IDLE, { event: "chunk", received: 5 })).toBe(IDLE);
  });
});

describe("progressPercent", () => {
  it("is null without a size and stays between 0 and 100", () => {
    expect(progressPercent(10, null)).toBeNull();
    expect(progressPercent(10, 0)).toBeNull();
    expect(progressPercent(250, 1000)).toBe(25);
    expect(progressPercent(5000, 1000)).toBe(100);
  });
});

describe("pendingInfo", () => {
  it("returns the version a notice is about, also after a failed install", () => {
    expect(pendingInfo({ status: "available", info: INFO })).toBe(INFO);
    expect(pendingInfo({ status: "error", message: "x", info: INFO })).toBe(INFO);
    expect(pendingInfo({ status: "error", message: "x" })).toBeNull();
    expect(pendingInfo({ status: "upToDate" })).toBeNull();
  });
});

describe("statusMessage", () => {
  it("words every state", () => {
    expect(statusMessage(IDLE)).toBe("");
    expect(statusMessage({ status: "checking" })).toBe("Checking for updates…");
    expect(statusMessage({ status: "upToDate" })).toBe("You're up to date.");
    expect(statusMessage({ status: "available", info: INFO })).toBe("Version 1.2.0 is available.");
    expect(statusMessage({ status: "error", message: "No network" })).toBe("No network");
  });

  it("shows a percentage, or the size when the total is unknown", () => {
    expect(statusMessage({ status: "downloading", info: INFO, received: 500, total: 1000 })).toBe("Downloading version 1.2.0… 50%");
    expect(statusMessage({ status: "downloading", info: INFO, received: 3 * 1024 * 1024, total: null })).toBe("Downloading version 1.2.0… 3.0 MB");
  });
});
