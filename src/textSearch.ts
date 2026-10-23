/** True when every word of the query appears, in any order, in at least one of the fields. An empty query matches everything. */
export function matchesText(query: string, fields: Array<string | null | undefined>) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}
