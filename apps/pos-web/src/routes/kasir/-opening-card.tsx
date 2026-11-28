import { useRouter } from '@tanstack/react-router'
import { Button, TextField } from '@umkmall/ui'
import { Dialog } from '@umkmall/ui/primitives'
import { useRef, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { notifySuccess, showError } from '@/lib/feedback'
import { rupiah } from '@/lib/rupiah'
import { checkOpening } from './-api'
import { parseRupiah } from './-money'
import { openingToast, showOpeningCard } from './-opening'

type OpeningShift = { id: string; openingCash: number; openedAutomatically?: boolean; openingCheckedAt?: string | null }

/**
 * Design 40 screen 7 (owner decision 2026-11-28, option A): the shift opened by itself with the last count as its
 * opening cash. "Sudah benar" keeps it, "Betulkan modal" corrects it once; pos-api audits the correction. After
 * the check, the drawer is corrected with Kas laci instead.
 */
export function OpeningCard({ shift }: { shift: OpeningShift }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  if (!showOpeningCard(shift)) return null

  async function send(openingCash?: number) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    const res = await checkOpening({ data: { shiftId: shift.id, ...(openingCash === undefined ? {} : { openingCash }) } }).catch(
      () => ({ ok: false as const, status: 0, error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }),
    )
    lock.current = false
    setBusy(false)
    if (!res.ok) {
      const errors = (res as { errors?: Record<string, string> }).errors
      // A refusal of the amount is shown once, under the field; anything else in the shared error dialog.
      if (errors?.openingCash) setError(errors.openingCash)
      else showError(res, { action: 'menyimpan modal awal' })
      const code = (res as { code?: string }).code
      // Another shift, a shift already checked, or one opened by hand: the till reads the shift again.
      if (code === 'shift_changed' || code === 'opening_checked' || code === 'opening_not_automatic') {
        setEditing(false)
        void router.invalidate()
      }
      return
    }
    notifySuccess(openingToast(shift.openingCash, openingCash))
    setEditing(false)
    void router.invalidate()
  }

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return setError('Wajib diisi')
    const amount = parseRupiah(text)
    if (Number.isNaN(amount)) return setError('Harus bilangan bulat rupiah, misalnya 150.000')
    setError(undefined)
    void send(amount)
  }

  return (
    <section aria-label="Shift dibuka otomatis" className="space-y-3 rounded-lg border border-default-primary bg-default-primary p-3">
      <div>
        <p className="font-semibold text-default-primary">Shift dibuka otomatis</p>
        <p className="text-sm text-default-secondary">
          Modal awal {rupiah(shift.openingCash)}, dari hitungan laci terakhir. Betulkan bila isi laci berbeda.
        </p>
      </div>
      <ActionRow align="start">
        <Button
          type="outline"
          color="light"
          size="small"
          width="auto"
          disabled={busy}
          onClick={() => {
            setText(String(shift.openingCash))
            setError(undefined)
            setEditing(true)
          }}
        >
          Betulkan modal
        </Button>
        <Button size="small" width="auto" isLoading={busy && !editing} disabled={busy} onClick={() => void send()}>
          Sudah benar
        </Button>
      </ActionRow>
      <Dialog open={editing} onOpenChange={(open) => !open && !busy && setEditing(false)} title="Betulkan modal awal" size="small" centered>
        <form onSubmit={save} noValidate className="flex flex-col gap-4 px-6 pt-2 pb-6">
          <TextField
            label="Modal awal"
            required
            error={error}
            prefix="Rp"
            inputMode="numeric"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(undefined)
            }}
            placeholder="0"
            autoFocus
          />
          <p className="text-sm text-default-secondary">Bisa dibetulkan sekali. Setelah itu, catat lewat Kas laci.</p>
          <ActionRow>
            <Button type="outline" color="light" size="small" width="auto" disabled={busy} onClick={() => setEditing(false)}>
              Batal
            </Button>
            <Button htmlType="submit" size="small" width="auto" isLoading={busy}>
              Simpan
            </Button>
          </ActionRow>
        </form>
      </Dialog>
    </section>
  )
}
