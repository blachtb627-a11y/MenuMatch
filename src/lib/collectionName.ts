/**
 * Collection names compare the way a person reads them: "Meal Prep",
 * "meal prep" and "Meal  prep " are one collection, not three. The server
 * (create_collection, 0043) applies the same rule; this lets a screen answer
 * before the round trip and say which collection already has the name.
 */

/** Trimmed, with runs of whitespace collapsed — the form a name is stored in. */
export function cleanCollectionName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 60);
}

const key = (name: string) => cleanCollectionName(name).toLowerCase();

export function sameCollectionName(a: string, b: string): boolean {
  return key(a) === key(b);
}

/** The existing collection a new name would duplicate, if any. */
export function findByName<T extends { name: string }>(collections: readonly T[], name: string): T | undefined {
  const k = key(name);
  return collections.find((c) => key(c.name) === k);
}
