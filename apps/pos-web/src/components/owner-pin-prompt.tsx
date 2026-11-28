import { Alert, Button, Dialog, TextField } from '@umkmall/ui/primitives'
import { useRouter } from '@tanstack/react-router'
import { useRef, useState, type FormEvent } from 'react'
import { ActionRow } from '@/components/action-row'
import { notifySuccess, showError } from '@/lib/feedback'
import { OWNER_PIN_LATER } from '@/lib/owner-pin'
import { failureOf, pinDigits, pinSetErrors } from '@/routes/kasir/-void-helpers'
import { setPin } from '@/routes/pengaturan/-keamanan-api'

type Errors = Partial<Record<'pin' | 'confirm', string>>

/**
 * Design 40, "Buat PIN pemilik": shown once right after the owner signs in while the store's owner has no PIN. The PIN
 * approves voids and refunds and later unlocks the till after "Serahkan ke pembantu". "Nanti saja" closes it after
 * saying that a PIN made later needs a new WhatsApp sign-in (pos-api makes the first PIN only on a fresh sign-in).
 */
export function OwnerPinPrompt({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [pin, setPinText] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [later, setLater] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (lock.current) return
    const bad = pinSetErrors({ pin, confirm, currentPin: '' }, false)
    setErrors({ pin: bad.pin, confirm: bad.confirm })
    if (bad.pin || bad.confirm) return
    lock.current = true
    setBusy(true)
    const r = await setPin({ data: { pin } }).catch(() => null)
    setPinText('')
    setConfirm('')
    lock.current = false
    setBusy(false)
    if (!r) return showError({ status: 0 }, 'menyimpan PIN pemilik')
    if (r.ok) {
      notifySuccess('PIN pemilik tersimpan')
      onClose()
      await router.invalidate()
      return
    }
    // The 5 minutes after the sign-in ran out while the prompt was open: the same path as "Nanti saja".
    if (r.fresh) {
      setLater(true)
      return
    }
    setErrors({ pin: r.failure.errors.pin })
    showError(failureOf(r.failure), 'menyimpan PIN pemilik')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && (later ? onClose() : setLater(true))}
      title={later ? 'Buat PIN nanti' : 'Buat PIN pemilik'}
      size="small"
      centered
    >
      {later ? (
        <div className="flex flex-col gap-4 px-6 pt-2 pb-6">
          <p className="text-sm text-default-secondary">{OWNER_PIN_LATER}</p>
          <ActionRow>
            <Button type="outline" color="light" size="small" width="auto" onClick={() => setLater(false)}>
              Kembali
            </Button>
            <Button type="primary" color="primary" size="small" width="auto" onClick={onClose}>
              Tutup
            </Button>
          </ActionRow>
        </div>
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4 px-6 pt-2 pb-6">
          <p className="text-sm text-default-secondary">
            PIN 6 angka ini menyetujui pembatalan struk dan membuka kembali kasir setelah diserahkan ke pembantu.
          </p>
          <TextField
            label="PIN (6 angka)"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => {
              setPinText(pinDigits(e.target.value))
              setErrors((x) => ({ ...x, pin: undefined }))
            }}
            error={errors.pin}
          />
          <TextField
            label="Ulangi PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={confirm}
            onChange={(e) => {
              setConfirm(pinDigits(e.target.value))
              setErrors((x) => ({ ...x, confirm: undefined }))
            }}
            error={errors.confirm}
          />
          <Alert variant="info" size="small">
            Jangan pakai tanggal lahir atau angka berurutan. Salah 5 kali mengunci PIN 5 menit.
          </Alert>
          <ActionRow>
            <Button type="outline" color="light" size="small" width="auto" disabled={busy} onClick={() => setLater(true)}>
              Nanti saja
            </Button>
            <Button htmlType="submit" type="primary" color="primary" size="small" width="auto" isLoading={busy}>
              Simpan PIN
            </Button>
          </ActionRow>
        </form>
      )}
    </Dialog>
  )
}
