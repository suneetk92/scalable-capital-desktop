export function selectionState(options: readonly string[], selected: readonly string[]) {
  const chosen = new Set(selected);
  const count = options.filter((id) => chosen.has(id)).length;
  return {
    checked: options.length > 0 && count === options.length,
    indeterminate: count > 0 && count < options.length,
  };
}

export function selectOptions(options: readonly string[], selected: readonly string[], checked: boolean): string[] {
  if (checked) return [...new Set([...selected, ...options])];
  const removed = new Set(options);
  return selected.filter((id) => !removed.has(id));
}
