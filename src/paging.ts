/** One page of `items`. A `pageSize` of 0 (or less) shows everything on one page; `page` is kept inside the range. */
export function paginate<T>(items: T[], page: number, pageSize: number) {
  const size = pageSize > 0 ? pageSize : Math.max(items.length, 1);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(page, 1), pageCount);
  return { rows: items.slice((current - 1) * size, current * size), page: current, pageCount, size };
}
