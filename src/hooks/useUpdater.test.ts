// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Invoke } from "../tools";
import { useUpdater } from "./useUpdater";

afterEach(() => vi.unstubAllEnvs());

const info = { version: "1.2.0", currentVersion: "1.1.0", notes: null, date: null, canInstall: true, releaseUrl: null };

describe("update notifications", () => {
  it("notifies about a new version from the silent launch check", async () => {
    vi.stubEnv("DEV", false);
    const invoke = vi.fn(async () => info) as unknown as Invoke;
    const onAvailable = vi.fn();

    renderHook(() => useUpdater({ invoke, launchCheck: true, onError: vi.fn(), onAvailable }));

    await waitFor(() => expect(onAvailable).toHaveBeenCalledWith({ kind: "info", title: "Update available", text: "Version 1.2.0 is available." }));
  });

  it("does not add manual checks to the notification center", async () => {
    vi.stubEnv("DEV", false);
    const invoke = vi.fn(async () => info) as unknown as Invoke;
    const onAvailable = vi.fn();
    const { result } = renderHook(() => useUpdater({ invoke, launchCheck: false, onError: vi.fn(), onAvailable }));

    await act(async () => result.current.check());

    expect(onAvailable).not.toHaveBeenCalled();
  });
});