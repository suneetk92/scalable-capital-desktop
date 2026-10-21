type RowWindow = { start: number; end: number; top: number; bottom: number };

/** Visible row range plus overscan, with spacer heights for variable-height rows. */
export function windowOf({
  count,
  scrollTop,
  viewport,
  heightOf,
  overscan = 6,
  minItems = 80,
}: {
  count: number;
  scrollTop: number;
  viewport: number;
  heightOf: (index: number) => number;
  overscan?: number;
  minItems?: number;
}): RowWindow {
  const length = Math.max(0, Math.floor(count));
  if (length === 0) return { start: 0, end: 0, top: 0, bottom: 0 };
  if (length <= minItems) return { start: 0, end: length, top: 0, bottom: 0 };

  const heights = Array.from({ length }, (_, index) => {
    const height = heightOf(index);
    return Number.isFinite(height) && height > 0 ? height : 56;
  });
  const offsets = new Array<number>(length + 1);
  offsets[0] = 0;
  for (let index = 0; index < length; index++) offsets[index + 1] = offsets[index] + heights[index];

  const findRow = (position: number) => {
    let low = 0;
    let high = length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (offsets[middle + 1] <= position) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  const topOfViewport = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const bottomOfViewport = topOfViewport + Math.max(0, Number.isFinite(viewport) ? viewport : 0);
  const pad = Math.max(0, Math.floor(overscan));
  const start = Math.max(0, findRow(topOfViewport) - pad);
  const end = Math.min(length, Math.max(start + 1, findRow(bottomOfViewport) + 1 + pad));

  return {
    start,
    end,
    top: offsets[start],
    bottom: offsets[length] - offsets[end],
  };
}
