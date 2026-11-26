import type { ReactNode } from 'react'
import { actionRowClass, type ActionRowAlign } from '@/lib/action-row'

/**
 * Every button group of the POS (dialog actions, form actions, card actions) goes through this component: the rule
 * and its reasons are in `lib/action-row.ts`. Write the children secondary first, primary last.
 */
export function ActionRow({
  children,
  align,
  stacked,
  className,
}: {
  children: ReactNode
  align?: ActionRowAlign
  stacked?: boolean
  className?: string
}) {
  return <div className={actionRowClass({ align, stacked, className })}>{children}</div>
}
