/**
 * `ProfileHeader` (UMK-1601 / UMK-1614, Figma `Mobile/Profile` 14980:77345): a 50 pt brand avatar
 * 16 from the text, the name 16 Bold, and one 12 Regular "phone - business name" line in the
 * secondary ink.
 *
 * The line's rule is asserted by IMPORT (`profile-header-support.ts` is pure); the wiring by SOURCE
 * SCAN, because `ProfileHeader.tsx` loads `react-native`, which vitest cannot. The render — the
 * avatar's size and fill, the text and the accessible label — is `apps/mobile`'s
 * `design/__tests__/profile-header.test.tsx`. This half exists because a guard only guards its own
 * package (docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contract } from '../../contract';
import { tokens } from '../../tokens';
import { profileMetaLine } from '../profile-header-support';

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');

/** Line comments first, then block comments — so prose naming a pattern cannot satisfy it. */
const code = (file: string) =>
  read(file)
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');

describe('the profile meta line', () => {
  it('joins phone and business name with the Figma " - "', () => {
    expect(profileMetaLine('08123456789', 'Donat Bateng')).toBe('08123456789 - Donat Bateng');
  });

  it('leaves no dangling separator when either half is absent or blank', () => {
    expect(profileMetaLine('08123456789', undefined)).toBe('08123456789');
    expect(profileMetaLine(undefined, 'Donat Bateng')).toBe('Donat Bateng');
    expect(profileMetaLine('08123456789', '   ')).toBe('08123456789');
    expect(profileMetaLine('', 'Donat Bateng')).toBe('Donat Bateng');
  });

  it('is absent, not empty, when there is nothing to say', () => {
    expect(profileMetaLine(undefined, undefined)).toBeUndefined();
    expect(profileMetaLine(' ', '')).toBeUndefined();
  });

  it('trims each half', () => {
    expect(profileMetaLine(' 0812 ', ' Toko ')).toBe('0812 - Toko');
  });
});

describe('ProfileHeader', () => {
  const src = code('ProfileHeader.tsx');

  it('draws the avatar at the 50 pt profile size with one initial, from the contract axes', () => {
    expect(src).toMatch(/<Avatar size="profile" initials="one" name=\{name\}/);
    expect(contract.Avatar.axes.initials).toContain('one');
    expect(contract.Avatar.axes.size).toContain('profile');
    const avatar = code('Avatar.tsx');
    expect(avatar).toMatch(/profile: \{ diameter: PROFILE_DIAMETER, role: 'h4'/);
    expect(avatar).toMatch(/const PROFILE_DIAMETER = tokens\.typography\.mobile\.h4\.bold\.lineHeight \+ 2 \* tokens\.spacing\.sm;/);
    expect(tokens.typography.mobile.h4.bold.lineHeight + 2 * tokens.spacing.sm).toBe(50);
    expect(tokens.typography.mobile.h4.bold).toMatchObject({ fontSize: 20, fontWeight: 700 });
  });

  it('sets the avatar 16 from the text, with no inset of its own (the page carries the 16)', () => {
    const row = src.slice(src.indexOf('const ROW = {'), src.indexOf('} as const satisfies ViewStyle;'));
    expect(row).toMatch(/gap:\s*tokens\.spacing\.md/);
    expect(row).not.toMatch(/padding/);
  });

  it('sets the name 16 Bold and the one line 12 Regular in the secondary ink, built by the shared rule', () => {
    expect(src).toMatch(/<Text variant="h6" weight="bold"[^>]*>\s*\{name\}/);
    expect(tokens.typography.mobile.h6.bold).toMatchObject({ fontSize: 16, lineHeight: 24 });
    expect(src).toMatch(/const line = profileMetaLine\(phone, meta\);/);
    expect(src).toMatch(/\{line !== undefined && \(\s*<Text variant="bodyLg" color="secondary"/);
    expect(tokens.typography.mobile.bodyLg.regular).toMatchObject({ fontSize: 12, lineHeight: 18 });
  });

  it('is one accessible header announcing the name and the line', () => {
    expect(src).toMatch(/accessible\s/);
    expect(src).toMatch(/accessibilityRole="header"/);
    expect(src).toMatch(/accessibilityLabel=\{\[name, line\]\.filter\(Boolean\)\.join\(', '\)\}/);
  });

  it('is a contract entry with full native parity, no axes of its own, and a web copy (UMK-1840)', () => {
    expect(contract.ProfileHeader.native.state).toBe('implemented');
    expect(contract.ProfileHeader.axes).toEqual({});
    expect(contract.ProfileHeader.status).toBe('implemented');
  });
});
