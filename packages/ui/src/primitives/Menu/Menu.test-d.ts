import { describe, expectTypeOf, it } from 'vitest';
import type { MenuItem } from './Menu';

/**
 * THE ROW SIGNATURE HAS NO OTHER GATE.
 *
 * `onSelect` was widened to carry the cancellable event so a link row can keep the menu open
 * (UMK-963). Nothing at runtime can see that widening: Radix passes the event either way, so
 * the behaviour guard's `preventDefault` probe passes against BOTH signatures — it was green
 * before the prop was widened at all. Narrowing it back to `() => void` would therefore break
 * every consumer that reads the event while this package's own suite stayed green.
 *
 * Compiled by vitest's `typecheck` mode; see `vitest.config.ts`.
 *
 * The two directions are asserted together on purpose. The widening must NOT cost the
 * existing call sites anything — both live in `apps/main-website` and pass argument-less
 * handlers — so "accepts a handler that ignores the event" is as load-bearing as "hands the
 * handler an event".
 */
describe('a Menu row hands its handler the cancellable event', () => {
  it('types onSelect as receiving an Event', () => {
    expectTypeOf<MenuItem['onSelect']>().toEqualTypeOf<((event: Event) => void) | undefined>();
  });

  it('still accepts an argument-less handler, which is what both existing call sites pass', () => {
    expectTypeOf<() => void>().toMatchTypeOf<NonNullable<MenuItem['onSelect']>>();
  });

  it('nests rows of its own type rather than a looser one', () => {
    expectTypeOf<MenuItem['items']>().toEqualTypeOf<readonly MenuItem[] | undefined>();
  });
});
