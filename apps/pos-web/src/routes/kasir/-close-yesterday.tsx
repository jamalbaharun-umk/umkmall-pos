import { Link } from '@tanstack/react-router'
import { Button } from '@umkmall/ui'
import { useEffect, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { rupiah } from '../../lib/rupiah'
import { openedBeforeToday, storeDayText } from './-close-day'

// Shifts whose offer the owner put off ("Nanti saja") in this tab. In memory only: the till keeps browser storage
// to the pending-sale store (guard in -pending.test.ts), and the offer coming back after a reload is harmless.
const putOff = new Set<string>()

/**
 * UMK-2122 (design 41, screen 3): the solo owner's open shift began on an earlier store day, so yesterday was never
 * closed. Offered on the till, skippable ("Nanti saja" hides it for this shift in this tab). Closing it makes
 * today's automatic opening match the count; the sales already recorded do not change.
 */
export function CloseYesterday({ shift }: { shift: { id: string; openedAt: string; revenue?: number } }) {
  const [show, setShow] = useState(false)
  // After hydration: the server's clock and day must not decide what the browser shows.
  useEffect(() => setShow(!putOff.has(shift.id) && openedBeforeToday(shift.openedAt)), [shift.id, shift.openedAt])
  if (!show) return null
  const later = () => {
    putOff.add(shift.id)
    setShow(false)
  }
  return (
    <section aria-label="Kemarin belum ditutup" className="space-y-3 rounded-lg border border-default-primary bg-default-primary p-3">
      <div>
        <p className="font-semibold text-default-primary">Kemarin belum ditutup</p>
        <p className="text-sm text-default-secondary">
          {storeDayText(shift.openedAt)}. Penjualan {rupiah(shift.revenue ?? 0)} sudah tercatat benar. Menutupnya membuat
          uang awal hari ini sesuai hitungan.
        </p>
      </div>
      <ActionRow>
        <Button type="outline" color="light" size="small" width="auto" onClick={later}>
          Nanti saja
        </Button>
        <Button asChild size="small" width="auto">
          <Link to="/kasir/tutup">Tutup kemarin dulu</Link>
        </Button>
      </ActionRow>
    </section>
  )
}
