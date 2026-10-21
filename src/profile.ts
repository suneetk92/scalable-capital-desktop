import { isRec, parseMaybeJson, pickString, type Rec } from "./response";

const FULL_NAME_KEYS = ["displayName", "preferredName", "fullName", "name"];
const FIRST_NAME_KEYS = ["firstName", "givenName", "forename"];
const LAST_NAME_KEYS = ["lastName", "familyName", "surname"];

function nameOf(record: Rec): string | undefined {
  const full = pickString(record, FULL_NAME_KEYS)?.trim();
  if (full) return full;
  const first = pickString(record, FIRST_NAME_KEYS)?.trim();
  const last = pickString(record, LAST_NAME_KEYS)?.trim();
  return [first, last].filter(Boolean).join(" ") || undefined;
}

/**
 * The profile display name in a `get_account_profile` result, wherever it is wrapped. The tool's response
 * shape is not published, so this looks for a display or full name first, then first and last name.
 */
export function profileName(value: unknown, depth = 0): string | undefined {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = profileName(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRec(parsed) || depth > 3) return undefined;
  const own = nameOf(parsed);
  if (own) return own;
  for (const child of Object.values(parsed)) {
    const found = profileName(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** Up to two capital letters for the avatar: first letter of the first and the last word. */
export function initialsOf(name: string | undefined, fallback = "SC") {
  const words = (name ?? "").split(/\s+/).filter((word) => /^\p{L}/u.test(word));
  if (words.length === 0) return fallback;
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[words.length - 1]][0]];
  return letters.join("").toUpperCase();
}
