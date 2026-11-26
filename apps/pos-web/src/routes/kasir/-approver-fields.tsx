import { Alert, Button, Select, Spinner, TextField } from '@umkmall/ui/primitives'
import { useCallback, useEffect, useState } from 'react'
import { loadApprovers } from './-void-api'
import { approverOptions, pinDigits, type Approver } from './-void-helpers'

export type Approvers = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ready'; list: Approver[] }

/** Who can approve (name, has a PIN, locked until): read when `open` turns true, and again by `reload`. */
export function useApprovers(open: boolean) {
  const [approvers, setApprovers] = useState<Approvers>({ state: 'loading' })
  const reload = useCallback(() => {
    setApprovers({ state: 'loading' })
    loadApprovers().then(
      (r) => setApprovers(r.ok ? { state: 'ready', list: r.approvers } : { state: 'error', error: r.error }),
      () => setApprovers({ state: 'error', error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }),
    )
  }, [])
  useEffect(() => {
    if (open) reload()
  }, [open, reload])
  const list = approvers.state === 'ready' ? approvers.list : []
  return { approvers, reload, list, anyApprover: list.some((a) => a.hasPin) }
}

/** The state of the approver list as the void and refund-retry dialogs show it: loading, error with a retry, no approver. */
export function ApproverStatus({ approvers, anyApprover, reload }: { approvers: Approvers; anyApprover: boolean; reload: () => void }) {
  return (
    <>
      {approvers.state === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-default-secondary" role="status">
          <Spinner /> Memuat daftar admin…
        </div>
      )}
      {approvers.state === 'error' && (
        <Alert
          variant="danger"
          size="small"
          role="alert"
          action={
            <Button type="outline" color="light" size="small" width="auto" onClick={reload}>
              Coba lagi
            </Button>
          }
        >
          {approvers.error}
        </Alert>
      )}
      {approvers.state === 'ready' && !anyApprover && (
        <Alert variant="warning" size="small" role="alert">
          Belum ada pemilik atau admin dengan PIN pembatalan. Minta pemilik membuat PIN di menu Keamanan sebelum ada
          struk yang bisa dibatalkan.
        </Alert>
      )}
    </>
  )
}

type FieldProps = {
  approvers: Approvers
  list: Approver[]
  approverId: string
  pin: string
  errors: { approverId?: string; pin?: string }
  onApprover: (id: string) => void
  onPin: (pin: string) => void
}

/** The 6-digit PIN field. The PIN is never stored beyond the parent's state. */
export function PinField({ pin, error, onPin, label = 'PIN admin (6 angka)' }: { pin: string; error?: string; onPin: (pin: string) => void; label?: string }) {
  return (
    <TextField
      label={label}
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={6}
      value={pin}
      onChange={(e) => onPin(pinDigits(e.target.value))}
      error={error}
    />
  )
}

/** The approver picker and the 6-digit PIN field. */
export function ApproverPinFields({ approvers, list, approverId, pin, errors, onApprover, onPin }: FieldProps) {
  return (
    <>
      <Select
        label="Admin yang menyetujui"
        options={approverOptions(list)}
        value={approverId}
        onValueChange={onApprover}
        placeholder="Pilih pemilik atau admin"
        emptyMessage="Belum ada admin"
        disabled={approvers.state !== 'ready'}
        error={errors.approverId}
      />
      <PinField pin={pin} error={errors.pin} onPin={onPin} />
      <p className="-mt-2 text-xs text-default-secondary">
        Minta admin mengetik PIN di perangkat ini. PIN tidak ditampilkan dan tidak disimpan. Salah 5 kali mengunci admin
        itu 5 menit.
      </p>
    </>
  )
}
