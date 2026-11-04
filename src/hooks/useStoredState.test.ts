// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { readStoredJson, writeStoredJson } from "../storage";
import { oneOf, useStoredState } from "./useStoredState";

beforeEach(() => localStorage.clear());

describe("useStoredState", () => {
  it("restores saved values and writes changes", () => {
    writeStoredJson("saved-count", 4);
    const { result } = renderHook(() => useStoredState("saved-count", 1));
    expect(result.current[0]).toBe(4);

    act(() => result.current[1](7));
    expect(readStoredJson("saved-count")).toBe(7);
  });

  it("uses the fallback when the stored shape or enum is invalid", () => {
    writeStoredJson("wrong-shape", { query: 4 });
    const shape = renderHook(() => useStoredState("wrong-shape", { query: "" }));
    expect(shape.result.current[0]).toEqual({ query: "" });

    writeStoredJson("wrong-enum", "other");
    const enumeration = renderHook(() => useStoredState("wrong-enum", "all", oneOf(["all", "used"] as const)));
    expect(enumeration.result.current[0]).toBe("all");
  });
});
