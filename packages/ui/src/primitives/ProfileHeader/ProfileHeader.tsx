import React from 'react';
import { cn } from '../../utils';
import { Icon } from '../Icon';
import { Text } from '../Text';
import {
  PROFILE_HEADER,
  PROFILE_HEADER_AVATAR,
  PROFILE_HEADER_GLYPH,
  PROFILE_HEADER_TEXT,
  PROFILE_HEADER_TRUNCATE,
} from '../profile-header-classes';

/** The Figma separator between the phone and the business name, as native's `profileMetaLine` writes it. */
const SEPARATOR = ' - ';

/**
 * The secondary line under the name: "08123456789 - Donat Bateng". Each half is trimmed and a blank
 * half is absent, so a missing one never leaves a dangling separator; `undefined` when there is
 * nothing to say, so no empty line is drawn. The web twin of `native/profile-header-support.ts`,
 * which this module cannot import (a web primitive does not reach into `native/`).
 */
export const profileMetaLine = (phone: string | undefined, meta: string | undefined): string | undefined => {
  const parts = [phone, meta].map((part) => part?.trim() ?? '').filter(Boolean);
  return parts.length > 0 ? parts.join(SEPARATOR) : undefined;
};

/** ONE initial, the first character of the name (a surrogate pair stays whole), upper-cased. */
const initialOf = (name: string): string | undefined => {
  const first = Array.from(name.trim())[0];
  return first === undefined ? undefined : first.toLocaleUpperCase('id-ID');
};

export interface ProfileHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The person's name: the bold line, and the avatar's initial. */
  name: string;
  /** The phone number, the first half of the secondary line. */
  phone?: string;
  /** The business name, the second half of the secondary line. */
  meta?: string;
}

/**
 * The top of Profil (UMK-1840): the web half of the native-ui-v2 header (`native/ProfileHeader.tsx`).
 * A 50 circle on the brand fill with ONE white initial ("B" for "Bambang Pamungkas"), then the name in
 * 16 Bold over one 12 Regular line in the secondary ink. With no name to take an initial from, the
 * circle holds the user glyph.
 *
 * THE CIRCLE IS DRAWN HERE, NOT BY `Avatar`, which stays native-only (UMK-1840, the author's call):
 * one initial on a fill is all this header needs. It is decorative, since the name beside it already
 * says who it is.
 *
 * Not interactive: the header shows who is signed in, and editing lives in Pengaturan Profil.
 */
export const ProfileHeader = ({ name, phone, meta, className, ...rest }: ProfileHeaderProps) => {
  const line = profileMetaLine(phone, meta);
  const initial = initialOf(name);
  return (
    <div {...rest} data-profile-header="" className={cn(PROFILE_HEADER, className)}>
      <span aria-hidden="true" data-profile-header-avatar="" className={PROFILE_HEADER_AVATAR}>
        {initial !== undefined ? (
          <Text as="span" variant="h4" weight="bold" color="invert">
            {initial}
          </Text>
        ) : (
          <Icon name="user" className={PROFILE_HEADER_GLYPH} />
        )}
      </span>
      <div className={PROFILE_HEADER_TEXT}>
        <Text as="p" variant="h6" weight="bold" className={PROFILE_HEADER_TRUNCATE}>
          {name}
        </Text>
        {line !== undefined && (
          <Text as="p" variant="bodyLg" color="secondary" className={PROFILE_HEADER_TRUNCATE}>
            {line}
          </Text>
        )}
      </div>
    </div>
  );
};
ProfileHeader.displayName = 'ProfileHeader';
