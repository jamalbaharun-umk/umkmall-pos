import { Alert, Button, Dialog, OtpInput, TextField } from '@umkmall/ui/primitives'
import { useRouter } from '@tanstack/react-router'
import { useRef, useState, type FormEvent } from 'react'
import { notifySuccess, showError } from '@/lib/feedback'
import { CODE_LENGTH, isPairingCode } from '@/lib/pairing'
import { describePairError } from '@/lib/pair-errors'
import { claimPairing } from './-pairing-api'

/**
 * The owner's side of pairing (UMK-2022): type the 6-digit code a cashier device shows. This runs in the owner's own
 * signed-in session; the store that takes the device is the session's, never something sent from here.
 */
export function PairDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [codeError, setCodeError] = useState<string>()
  const [nameError, setNameError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  const close = () => {
    if (busy) return
    setCode('')
    setName('')
    setCodeError(undefined)
    setNameError(undefined)
    onClose()
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (lock.current) return
    const cErr = isPairingCode(code) ? undefined : 'Kode harus 6 angka'
    const nErr = name.trim() ? undefined : 'Nama perangkat wajib diisi'
    setCodeError(cErr)
    setNameError(nErr)
    if (cErr || nErr) return
    lock.current = true
    setBusy(true)
    const res = await claimPairing({ data: { code, name: name.trim() } }).catch(() => ({
      ok: false as const,
      status: 0,
      error: '',
      errors: undefined,
      retryAfter: undefined,
    }))
    lock.current = false
    setBusy(false)
    if (!res.ok) {
      setCodeError(res.errors?.code)
      setNameError(res.errors?.name)
      // A wrong code is told under the field; the dialog explains only what the field cannot (locks, no answer, 403).
      if (res.status === 422 && (res.errors?.code || res.errors?.name)) return
      return showError(res, { action: 'menghubungkan perangkat', retry: () => void submit() }, describePairError)
    }
    notifySuccess(`${res.deviceName} terhubung. Kasir bisa masuk dengan PIN`)
    setCode('')
    setName('')
    onClose()
    await router.invalidate()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title="Hubungkan perangkat" size="small">
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 px-6 pt-2 pb-6">
        <p className="text-sm text-default-secondary">Ketik kode yang tampil di layar perangkat kasir.</p>
        <OtpInput
          label="Kode dari perangkat kasir"
          length={CODE_LENGTH}
          value={code}
          onChange={(v) => {
            setCode(v)
            setCodeError(undefined)
          }}
          error={codeError}
          disabled={busy}
          autoFocus
        />
        <TextField
          label="Nama perangkat"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setNameError(undefined)
          }}
          placeholder="Contoh: Tablet Kasir 1"
          maxLength={60}
          required
          error={nameError}
          disabled={busy}
        />
        <Alert variant="info">Hubungkan hanya bila Anda sendiri yang memintanya di perangkat itu.</Alert>
        <div className="flex flex-col gap-2 md:flex-row-reverse md:justify-start">
          <Button htmlType="submit" type="primary" color="primary" size="medium" width="auto" className="w-full md:w-auto" isLoading={busy}>
            Hubungkan perangkat
          </Button>
          <Button htmlType="button" type="outline" color="light" size="medium" width="auto" className="w-full md:w-auto" disabled={busy} onClick={close}>
            Batal
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
