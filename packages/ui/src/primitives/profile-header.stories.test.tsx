import React from 'react';
import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as ProfileHeaderStories from './ProfileHeader/ProfileHeader.stories';
import { ProfileHeader, profileMetaLine } from './ProfileHeader';
import { PROFILE_HEADER, PROFILE_HEADER_AVATAR, PROFILE_HEADER_TEXT, PROFILE_HEADER_TRUNCATE } from './profile-header-classes';
import { storyTitle } from '../contract';

/**
 * The web profile header's behaviour guard (UMK-1840). `ProfileHeader` declares no contract `family`,
 * so `unfamilied-coverage.test.ts` names this file and its purge sibling as the web half of its coverage.
 */

type AnyStory = { args?: Record<string, unknown>; render?: (a: never, b: never) => React.ReactElement };
type AnyModule = { default: { component: React.ElementType; args?: Record<string, unknown> } } & Record<string, unknown>;

const element = (mod: AnyModule, story: AnyStory): React.ReactElement => {
  const args = { ...(mod.default.args ?? {}), ...(story.args ?? {}) };
  if (typeof story.render === 'function') return story.render(args as never, {} as never);
  const Component = mod.default.component;
  return <Component {...args} />;
};

const stories = (mod: AnyModule) => Object.entries(mod).filter(([n, s]) => n !== 'default' && s && typeof s === 'object');

const mount = (ui: React.ReactElement): HTMLElement => {
  cleanup();
  return render(ui).baseElement as HTMLElement;
};

describe('the profile header stories', () => {
  it('titles the story set for Storybook', () => {
    expect((ProfileHeaderStories as unknown as { default: { title: string } }).default.title).toBe(storyTitle('ProfileHeader'));
  });

  it('mounts every story as one header', () => {
    const mod = ProfileHeaderStories as unknown as AnyModule;
    expect(stories(mod).length).toBeGreaterThan(1);
    for (const [, story] of stories(mod)) {
      expect(mount(element(mod, story as AnyStory)).querySelectorAll('[data-profile-header]')).toHaveLength(1);
    }
  });
});

describe('the header', () => {
  it('draws one upper-case initial in the 50 circle, hidden from screen readers', () => {
    const root = mount(<ProfileHeader name="bambang Pamungkas" phone="08123456789" meta="Donat Bateng" />);
    const avatar = root.querySelector('[data-profile-header-avatar]') as HTMLElement;
    expect(avatar.textContent).toBe('B');
    expect(avatar.getAttribute('aria-hidden')).toBe('true');
    /* The arbitrary 50 cannot be falsified by the purge guard, so it is pinned on the element. */
    for (const c of PROFILE_HEADER_AVATAR.split(' ')) expect(avatar.className).toContain(c);
    expect(root.textContent).toContain('bambang Pamungkas');
    expect(root.textContent).toContain('08123456789 - Donat Bateng');
  });

  /* The purge guard proves these classes are compiled, not that the elements carry them: a long name that wraps would pass it. */
  it('lays out the row and the column, and truncates the name and the line rather than wrapping', () => {
    const root = mount(<ProfileHeader name="Bambang Pamungkas Wijayakusuma" phone="08123456789" meta="Donat Bateng" />);
    const header = root.querySelector('[data-profile-header]') as HTMLElement;
    for (const c of PROFILE_HEADER.split(' ')) expect(header.className).toContain(c);
    const lines = Array.from(header.querySelectorAll('p'));
    expect(lines).toHaveLength(2);
    for (const c of PROFILE_HEADER_TEXT.split(' ')) expect((lines[0].parentElement as HTMLElement).className).toContain(c);
    for (const line of lines) expect(line.className.split(' ')).toContain(PROFILE_HEADER_TRUNCATE);
  });

  it('draws the user glyph when there is no name to take an initial from', () => {
    const avatar = mount(<ProfileHeader name="  " />).querySelector('[data-profile-header-avatar]') as HTMLElement;
    expect(avatar.querySelector('svg')).not.toBeNull();
    expect(avatar.textContent).toBe('');
  });

  it('draws no secondary line when both halves are missing', () => {
    expect(mount(<ProfileHeader name="Bambang" />).querySelectorAll('p')).toHaveLength(1);
  });
});

describe('profileMetaLine', () => {
  it('joins the two halves with the Figma separator', () => {
    expect(profileMetaLine('08123456789', 'Donat Bateng')).toBe('08123456789 - Donat Bateng');
  });

  it('never leaves a dangling separator, and says nothing when there is nothing', () => {
    expect(profileMetaLine('08123456789', undefined)).toBe('08123456789');
    expect(profileMetaLine('  ', 'Donat Bateng')).toBe('Donat Bateng');
    expect(profileMetaLine(undefined, '   ')).toBeUndefined();
  });
});
