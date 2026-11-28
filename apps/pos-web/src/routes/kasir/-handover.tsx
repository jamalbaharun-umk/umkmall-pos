import { useNavigate, useRouter } from '@tanstack/react-router'
import { Alert, Button, Dialog, TextField } from '@umkmall/ui'
import { useRef, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { notifySuccess, showError } from '@/lib/feedback'
import { closeHelper, startHelper } from './-api'
import { CLOSED_TOAST, HANDOVER_TOAST, nameError, pinFailure, pinInputError } from './-helper'
import { pinDigits } from './-void-helpers'

// UMK-2124 "Serahkan ke pembantu" (design 42), the owner's side: the owner's PIN parks this device's owner session and
// the till turns into the helper's sales-only till. A handover whose helper device is gone is ended from a fresh
// WhatsApp sign-in ("Akhiri lewat WhatsApp"), which lands back here with `?pembantu=akhiri`.

type Mode = { kind: 'form' } | { kind: 'busy_elsewhere'; text: string } | { kind: 'sign_in'; text: string }

/** A full-page POST to `/masuk/ulang`: the POS session ends, the owner signs in by WhatsApp and lands on `kembali`. */
function SignInAgain({ kembali, label, onCancel }: { kembali: 'pembantu' | 'kasir'; label: string; onCancel: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <form method="post" action="/masuk/ulang" onSubmit={() => setBusy(true)}>
      <input type="hidden" name="kembali" value={kembali} />
      <ActionRow>
        <Button width="auto" type="outline" color="light" size="small" disabled={busy} onClick={onCancel}>
          Batal
        </Button>
        <Button width="auto" htmlType="submit" size="small" isLoading={busy}>
          {label}
        </Button>
      </ActionRow>
    </form>
  )
}

/** "Serahkan ke pembantu" on the owner's till, with its dialog (optional name, owner PIN). */
export function HandoverButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>({ kind: 'form' })
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [errors, setErrors] = useState<{ name?: string; pin?: string }>({})
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  const close = () => {
    if (busy) return
    setOpen(false)
    setMode({ kind: 'form' })
    setPin('')
    setErrors({})
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const bad = { name: nameError(name), pin: pinInputError(pin) }
    setErrors(bad)
    if (bad.name || bad.pin || lock.current) return
    lock.current = true
    setBusy(true)
    const res = await startHelper({ data: { pin, ...(name.trim() ? { name: name.trim() } : {}) } }).catch(() => ({
      ok: false as const,
      status: 0,
      error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.',
    }))
    lock.current = false
    setBusy(false)
    setPin('')
    if (res.ok) {
      notifySuccess(HANDOVER_TOAST)
      setOpen(false)
      setName('')
      await router.invalidate() // the root reads the helper session: the till turns into "Mode pembantu"
      return
    }
    const code = 'code' in res ? res.code : undefined
    const errs = 'errors' in res ? res.errors : undefined
    // Handed over on another device that is gone: end it from a fresh WhatsApp sign-in.
    if (code === 'helper_active') return setMode({ kind: 'busy_elsewhere', text: res.error })
    // This device's owner session cannot be parked (signed in before this version, or another session): sign in again.
    if (code === 'sign_in_again' || errs?.parkedSid) return setMode({ kind: 'sign_in', text: res.error })
    if (errs?.name) setErrors({ name: errs.name })
    showError(pinFailure(res), { action: 'menyerahkan kasir' })
  }

  return (
    <>
      <Button width="auto" type="text" size="compact" onClick={() => setOpen(true)} data-guide="kasir-handover">
        Serahkan ke pembantu
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && close()} title="Serahkan ke pembantu" size="small" centered>
        {mode.kind === 'form' ? (
          <form noValidate onSubmit={submit} className="flex flex-col gap-4 px-6 pt-2 pb-6">
            <p className="text-sm text-default-secondary">
              Pembantu hanya bisa berjualan: tanpa diskon, ubah harga, batal struk, atau ambil uang laci. Penjualannya masuk
              ke shift Anda sebagai Pembantu.
            </p>
            <TextField
              label="Nama pembantu (opsional)"
              value={name}
              maxLength={40}
              onChange={(e) => {
                setName(e.target.value)
                setErrors((x) => ({ ...x, name: undefined }))
              }}
              error={errors.name}
              autoFocus
            />
            <TextField
              label="PIN pemilik"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => {
                setPin(pinDigits(e.target.value))
                setErrors((x) => ({ ...x, pin: undefined }))
              }}
              error={errors.pin}
            />
            <Alert variant="info" size="small">
              Untuk kembali, ketuk Kembali ke pemilik dan masukkan PIN ini. Mode pembantu berakhir sendiri setelah 12 jam.
            </Alert>
            <ActionRow>
              <Button width="auto" type="outline" color="light" size="small" disabled={busy} onClick={close}>
                Batal
              </Button>
              <Button width="auto" htmlType="submit" size="small" isLoading={busy}>
                Serahkan
              </Button>
            </ActionRow>
          </form>
        ) : (
          <div className="flex flex-col gap-4 px-6 pt-2 pb-6">
            <p className="text-sm text-default-secondary">{mode.text}</p>
            {mode.kind === 'busy_elsewhere' && (
              <p className="text-sm text-default-secondary">
                Perangkat itu hilang atau tidak bisa dibuka? Masuk lagi lewat WhatsApp untuk mengakhiri mode pembantu.
              </p>
            )}
            <SignInAgain
              kembali={mode.kind === 'busy_elsewhere' ? 'pembantu' : 'kasir'}
              label={mode.kind === 'busy_elsewhere' ? 'Akhiri lewat WhatsApp' : 'Masuk lewat WhatsApp'}
              onCancel={close}
            />
          </div>
        )}
      </Dialog>
    </>
  )
}

/** After "Akhiri lewat WhatsApp" (`?pembantu=akhiri`): the fresh sign-in ends the handover on the lost device. */
export function CloseHandoverDialog({ open }: { open: boolean }) {
  const router = useRouter()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const leave = () => void navigate({ to: '/kasir', search: {}, replace: true })

  async function end() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    const res = await closeHelper().catch(() => ({
      ok: false as const,
      status: 0,
      error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.',
    }))
    lock.current = false
    setBusy(false)
    if (res.ok) {
      notifySuccess(CLOSED_TOAST)
      leave()
      await router.invalidate()
      return
    }
    // Nothing left to end (ended there meanwhile): said once, the till goes on.
    if ('code' in res && res.code === 'helper_not_active') {
      notifySuccess(res.error)
      return leave()
    }
    showError(res, { action: 'mengakhiri mode pembantu', retry: res.status === 0 ? () => void end() : undefined })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && leave()} title="Akhiri mode pembantu?" size="small" centered>
      <div className="flex flex-col gap-4 px-6 pt-2 pb-6">
        <p className="text-sm text-default-secondary">
          Kasir pembantu di perangkat lain langsung tertutup. Penjualan yang sudah dibuat tetap tercatat di shift Anda.
        </p>
        <ActionRow>
          <Button width="auto" type="outline" color="light" size="small" disabled={busy} onClick={leave}>
            Batal
          </Button>
          <Button width="auto" color="danger" size="small" isLoading={busy} onClick={() => void end()}>
            Akhiri mode pembantu
          </Button>
        </ActionRow>
      </div>
    </Dialog>
  )
}
