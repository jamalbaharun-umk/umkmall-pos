/*
 * `ProfileHeader`'s pure half, apart from the component so a test can import it:
 * `ProfileHeader.tsx` loads `react-native`, which vitest cannot (its entry is Flow).
 */

/** The Figma separator between the phone and the business name (`Mobile/Profile` 14980:77345). */
const SEPARATOR = ' - ';

/**
 * The muted line under the name: "08123456789 - Donat Bateng". Each half is trimmed, and a blank
 * half is absent, so a missing one never leaves a dangling separator. Returns `undefined` — not
 * `''` — when there is nothing to say, so the caller draws no empty line.
 */
export const profileMetaLine = (phone: string | undefined, meta: string | undefined): string | undefined => {
  const parts = [phone, meta].map((part) => part?.trim() ?? '').filter(Boolean);
  return parts.length > 0 ? parts.join(SEPARATOR) : undefined;
};
