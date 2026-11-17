'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { Text } from '../Text';
import { LIST_GROUP_CONTAINER, LIST_GROUP_LABEL, LIST_GROUP_ROWS, LIST_GROUP_STACK } from '../list-group-classes';

type Axes = typeof contract.ListGroup.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export type ListGroupVariant = Of<'variant'>;

const STACK = LIST_GROUP_STACK satisfies Record<Of<'variant'>, string>;
const LABEL_BOX = LIST_GROUP_LABEL satisfies Record<Of<'variant'>, string>;

export interface ListGroupProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * The heading over the rows. `outlined`: written in any case, drawn uppercase ("AKUN"). `plain`:
   * drawn as written ("Teman AI"), SemiBold 14 in the secondary ink.
   */
  label?: string;
  /**
   * `outlined` (default): the solid white card with the one card edge. `plain`: no container, the rows
   * on the page as Profil draws them; pair it with `ListRow variant="plain"`.
   */
  variant?: ListGroupVariant;
  /** `ListRow`s. */
  children: React.ReactNode;
}

/**
 * A labelled group of `ListRow`s (UMK-1840): the web half of the native-ui-v2 group
 * (`native/ListGroup.tsx`). Profil's "Teman AI" and "Lainnya" are `plain` groups.
 *
 * ONE GROUP, ONE NAME. The label is an `h2` and names the group (`role="group"`, `aria-labelledby`),
 * so a screen reader hears "Teman AI, group" before its rows, as native announces a header. A group
 * with no label is an unnamed stack.
 *
 * DESTRUCTIVE ACTIONS DO NOT GO IN A GROUP; see `ListRow`.
 */
export const ListGroup = ({ label, variant = 'outlined', children, className, ...rest }: ListGroupProps) => {
  const labelId = React.useId();
  const plain = variant === 'plain';
  const named = label !== undefined;
  return (
    <div
      {...rest}
      role="group"
      aria-labelledby={named ? labelId : undefined}
      data-list-group={variant}
      className={cn(STACK[variant], className)}
    >
      {named && (
        <Text
          as="h2"
          id={labelId}
          variant={plain ? 'paragraph' : 'bodyLg'}
          weight={plain ? 'semibold' : 'bold'}
          color={plain ? 'secondary' : 'muted'}
          className={LABEL_BOX[variant]}
        >
          {label}
        </Text>
      )}
      <div data-list-group-rows="" className={plain ? LIST_GROUP_ROWS : cn(LIST_GROUP_CONTAINER, LIST_GROUP_ROWS)}>
        {children}
      </div>
    </div>
  );
};
