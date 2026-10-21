import { readStored, writeStored } from "./storage";

export const PANEL_MIN_WIDTH = 320;
export const PANEL_DEFAULT_WIDTH = 440;
/** The panel never takes more than this share of the window, so the page beside it stays usable. */
const PANEL_MAX_SHARE = 0.8;

export function clampPanelWidth(width: number, windowWidth: number): number {
  const max = Math.max(PANEL_MIN_WIDTH, Math.floor(windowWidth * PANEL_MAX_SHARE));
  if (!Number.isFinite(width)) return Math.min(PANEL_DEFAULT_WIDTH, max);
  return Math.min(max, Math.max(PANEL_MIN_WIDTH, Math.round(width)));
}

export function loadPanelWidth(): number {
  const stored = Number(readStored("panel-width"));
  return stored > 0 ? stored : PANEL_DEFAULT_WIDTH;
}

export function savePanelWidth(width: number) {
  writeStored("panel-width", String(width));
}

export const SPLIT_DEFAULT = 0.4;
const SPLIT_MIN = 0.15;
const SPLIT_MAX = 0.85;

/** The share of the dock's height taken by the upper panel (the watchlist) when a second panel is open. */
export function clampSplit(share: number): number {
  if (!Number.isFinite(share)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, share));
}

export function loadSplit(): number {
  const stored = Number(readStored("panel-split"));
  return stored > 0 ? clampSplit(stored) : SPLIT_DEFAULT;
}

export function saveSplit(share: number) {
  writeStored("panel-split", String(share));
}
