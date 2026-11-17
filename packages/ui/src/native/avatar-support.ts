/*
 * `Avatar`'s pure half, apart from the component so a test can import it: `Avatar.tsx` loads
 * `react-native`, which vitest cannot (its entry is Flow).
 */

/**
 * At most two letters: the first of the first word and the first of the last. `Array.from`, so
 * a name that opens with a character outside the BMP keeps it whole rather than splitting a
 * surrogate pair. Returns `''` for a blank name, which the caller reads as "no initials".
 *
 * `max: 1` keeps the first word's letter only — the Profil header's single "B" (UMK-1601).
 */
export const initialsOf = (name: string | undefined, max: 1 | 2 = 2): string => {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = Array.from(words[0])[0] ?? '';
  const last = max === 2 && words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : '';
  return (first + last).toLocaleUpperCase('id-ID');
};
