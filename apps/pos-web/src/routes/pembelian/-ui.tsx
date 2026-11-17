import { Badge } from '@umkmall/ui'

const STATUS = {
  draft: ['Draf', 'warning'],
  approved: ['Disetujui', 'success'],
  cancelled: ['Dibatalkan', 'light'],
} as const

export const STATUS_OPTIONS = Object.entries(STATUS).map(([value, [label]]) => ({ value, label }))

export function StatusBadge({ status }: { status: keyof typeof STATUS }) {
  const [label, color] = STATUS[status]
  return (
    <Badge color={color} size="small">
      {label}
    </Badge>
  )
}

/** Lakasir's list date filter: inclusive start / end day against a timestamp (browser local days). */
export const inDays = (iso: string, from: string, to: string) => {
  const day = new Date(iso).toLocaleDateString('sv-SE') // YYYY-MM-DD
  return (!from || day >= from) && (!to || day <= to)
}
