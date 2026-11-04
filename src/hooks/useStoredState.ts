import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { readStoredJson, writeStoredJson } from "../storage";

type StoredParser<T> = (value: unknown) => T | null;

function matchesShape(value: unknown, fallback: unknown): boolean {
  if (fallback === null) return value === null;
  if (Array.isArray(fallback)) return Array.isArray(value) && (fallback.length === 0 || value.every((item) => matchesShape(item, fallback[0])));
  if (typeof fallback === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const expected = Object.keys(fallback);
    const actual = Object.keys(value);
    return expected.length === actual.length && expected.every((key) => matchesShape((value as Record<string, unknown>)[key], (fallback as Record<string, unknown>)[key]));
  }
  return typeof value === typeof fallback;
}

export function oneOf<const T extends readonly unknown[]>(values: T): StoredParser<T[number]> {
  return (value) => (values.some((candidate) => candidate === value) ? (value as T[number]) : null);
}

/** State saved in the app's shared, prefixed local storage. Invalid saved values fall back to the supplied default. */
export function useStoredState<T>(name: string, fallback: T, parse?: StoredParser<T>): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const stored = readStoredJson(name);
    if (stored === null) return fallback;
    if (parse) return parse(stored) ?? fallback;
    return matchesShape(stored, fallback) ? (stored as T) : fallback;
  });
  useEffect(() => writeStoredJson(name, value), [name, value]);
  return [value, setValue];
}
