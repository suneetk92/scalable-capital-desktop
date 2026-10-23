import { describe, expect, it } from "vite-plus/test";

/*
 * Guard for the convention in AGENTS.md: sizes, spacing and radii are rem based (Tailwind scale numbers, or
 * `[1.2rem]` for px / 15, since the root font size is 15px), so the font-size setting scales the whole layout.
 * New `-[12px]` style arbitrary values fail here.
 *
 * Not flagged on purpose: viewport breakpoints (`max-[900px]:`, `min-[641px]:`, they match the window, not the
 * text), shadows (`shadow-[0_10px_...]`), CSS variables (`[--anchor-gap:4px]`) and 1px borders (`border`).
 */

const sources = import.meta.glob("./**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Files that still hold px values; remove an entry when the file is converted. */
const ALLOWED_FILES: string[] = [];

const ARBITRARY_PX = /(\S*?)\[([^\]\s]*\d(?:\.\d+)?px[^\]\s]*)\](:?)/g;

function pixelValues(source: string) {
  const found: string[] = [];
  for (const [token, prefix, inner, variant] of source.matchAll(ARBITRARY_PX)) {
    if (variant === ":" || inner.startsWith("--") || prefix.endsWith("shadow-")) continue;
    found.push(token);
  }
  return found;
}

describe("style rules", () => {
  it("scans the component sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it("flags arbitrary px values but not breakpoints, shadows or variables", () => {
    expect(pixelValues("w-[270px] text-[11px] [&_svg]:size-[18px] gap-[0.5px]")).toEqual(["w-[270px]", "text-[11px]", "[&_svg]:size-[18px]", "gap-[0.5px]"]);
    expect(pixelValues("max-[900px]:hidden min-[641px]:flex shadow-[0_10px_15px_-3px_var(--pop-shadow)] [--anchor-gap:4px] w-[21rem]")).toEqual([]);
  });

  it("uses no arbitrary px values outside the allow-list", () => {
    const offenders = Object.entries(sources)
      .filter(([file]) => !ALLOWED_FILES.includes(file))
      .flatMap(([file, source]) => pixelValues(source).map((token) => `${file}: ${token}`));
    expect(offenders).toEqual([]);
  });

  it("uses shared font-weight and radius tokens", () => {
    const forbidden = /(?:rounded-(?:[trblse]-)?(?:sm|md|lg|xl)\b|font-\[(?:550|650|750)\]!?)/g;
    const offenders = Object.entries(sources).flatMap(([file, source]) => [...source.matchAll(forbidden)].map(([token]) => `${file}: ${token}`));
    expect(offenders).toEqual([]);
  });
});
