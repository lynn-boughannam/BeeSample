// Tables that support a saved column layout. The key doubles as the table's route, which
// is what the save action revalidates after writing.
export const TABLE_KEYS = ["library", "ingredients"] as const;

export type TableKey = (typeof TABLE_KEYS)[number];

export function isTableKey(value: string): value is TableKey {
  return (TABLE_KEYS as readonly string[]).includes(value);
}

// Column keys arrive from a client component, so they're treated as untrusted input:
// anything that isn't a plausible key is dropped, duplicates collapse, and the list is
// capped. Keys that no longer exist in a table's registry are deliberately allowed
// through — resolveColumns filters those out on read, so a column renamed later degrades
// to "not shown" instead of breaking the saved view.
export function sanitiseColumnKeys(raw: string): string {
  const keys = new Set<string>();
  for (const part of raw.split(",")) {
    const key = part.trim();
    if (/^[A-Za-z0-9_]{1,40}$/.test(key)) keys.add(key);
    if (keys.size >= 60) break;
  }
  return [...keys].join(",");
}
