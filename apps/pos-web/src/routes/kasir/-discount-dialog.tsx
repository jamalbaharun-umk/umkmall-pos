import { Alert, Button, Dialog, SegmentedControl, Spinner, TextField } from '@umkmall/ui'
import { useCallback, useEffect, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { rupiah } from '@/components/pos-page'
import { notifySuccess, showError } from '@/lib/feedback'
import { ApproverPinFields } from './-approver-fields'
import { approveDiscount, loadDiscountApprovers } from './-discount-api'
import {
  approvalBps,
  approvalCovers,
  discountOf,
  discountRefusal,
  discountTextError,
  discountToast,
  needsApproval,
  parseDiscount,
  percentText,
  type DiscountKind,
  type LineDiscount,
} from './-discount'
import type { Approver } from './-void-helpers'

/**
 * The cart line being discounted: its name, "4 × Rp5.000", its quantity and unit price, its total at the server's
 * price, and its current discount.
 */
export type DiscountTarget = {
  key: string
  productId: string
  name: string
  qtyText: string
  qty: number
  unitPrice: number
  lineTotal: number
  current?: LineDiscount
}

type Approvers = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ready'; list: Approver[] }

/**
 * UMK-1990 "Beri diskon": Persen, Rupiah or Harga (a manual unit price below the current one, ruling 2026-11-26), the
 * new line price at once, then Terapkan. Above 30% the approver types their own PIN on this device ("PIN admin"); the
 * approval pos-api answers goes with the line. 100% is refused.
 */
export function DiscountDialog({
  target,
  onClose,
  onApply,
  onRemove,
}: {
  target?: DiscountTarget
  onClose: () => void
  onApply: (key: string, d: LineDiscount) => void
  onRemove: (key: string) => void
}) {
  const [kind, setKind] = useState<DiscountKind>('percent')
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)
  const [step, setStep] = useState<'edit' | 'pin'>('edit')
  const [approverId, setApproverId] = useState('')
  const [pin, setPin] = useState('')
  const [pinErrors, setPinErrors] = useState<{ approverId?: string; pin?: string }>({})
  const [busy, setBusy] = useState(false)
  const [approvers, setApprovers] = useState<Approvers>({ state: 'loading' })

  useEffect(() => {
    setKind(target?.current?.kind ?? 'percent')
    setText(target?.current ? String(target.current.value) : '')
    setTouched(false)
    setStep('edit')
    setApproverId('')
    setPin('')
    setPinErrors({})
  }, [target?.key])

  const reloadApprovers = useCallback(() => {
    setApprovers({ state: 'loading' })
    loadDiscountApprovers().then(
      (r) => setApprovers(r.ok ? { state: 'ready', list: r.approvers } : { state: 'error', error: r.error }),
      () => setApprovers({ state: 'error', error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }),
    )
  }, [])
  useEffect(() => {
    if (step === 'pin') reloadApprovers()
  }, [step, reloadApprovers])

  if (!target) return null

  const lineTotal = target.lineTotal
  const qty = target.qty
  const error = discountTextError(kind, text, lineTotal, qty)
  const value = parseDiscount(kind, text)
  const off = error ? 0 : discountOf(lineTotal, { kind, value }, qty)
  const isPrice = kind === 'price'
  const big = !error && needsApproval(off, lineTotal)
  const list = approvers.state === 'ready' ? approvers.list : []

  const apply = (d: LineDiscount) => {
    onApply(target.key, d)
    notifySuccess(discountToast(target.name, d))
    onClose()
  }
  const submitEdit = () => {
    setTouched(true)
    if (error) return showError({ status: 422 }, { action: 'menerapkan diskon' }, () => discountRefusal(error))
    // The same share already approved for this line needs no second PIN.
    const kept = target.current?.approval
    if (big && !(kept && approvalCovers(kept, off, lineTotal))) return setStep('pin')
    apply({ kind, value, ...(big && kept ? { approval: kept } : {}) })
  }
  const submitPin = async () => {
    const errs: typeof pinErrors = {}
    if (!approverId) errs.approverId = 'Pilih admin yang menyetujui'
    if (!/^[0-9]{6}$/.test(pin)) errs.pin = 'PIN harus 6 angka'
    setPinErrors(errs)
    if (Object.keys(errs).length || busy) return
    setBusy(true)
    const maxBps = approvalBps(off, lineTotal)
    // The approval covers this share and this many rupiah, no more (PR 72 review).
    const r = await approveDiscount({ data: { approverId, pin, productId: target.productId, maxBps, maxAmount: off } }).catch(() => ({
      ok: false as const,
      status: 0,
      error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.',
      errors: undefined,
    }))
    setBusy(false)
    setPin('')
    if (r.ok)
      return apply({
        kind,
        value,
        approval: {
          id: r.approval.id,
          maxBps: r.approval.maxBps,
          maxAmount: r.approval.maxAmount ?? null,
          approverName: r.approval.approver.name,
        },
      })
    // A wrong PIN or a locked approver stays on its field; anything else is the error dialog, the form kept.
    if (r.errors?.pin || r.errors?.approverId) return setPinErrors({ pin: r.errors.pin, approverId: r.errors.approverId })
    showError(r, { action: 'menyetujui diskon' })
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      centered
      size="small"
      title={step === 'pin' ? 'PIN admin' : `Beri diskon · ${target.name}`}
      closeDisabled={busy}
    >
      {step === 'edit' ? (
        <form
          noValidate
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6"
          onSubmit={(e) => {
            e.preventDefault()
            submitEdit()
          }}
        >
          <p className="text-sm text-default-secondary">
            {target.name} · {target.qtyText} = {rupiah(lineTotal)}
          </p>
          <SegmentedControl
            aria-label="Jenis diskon"
            options={[
              { value: 'percent', label: 'Persen' },
              { value: 'amount', label: 'Rupiah' },
              { value: 'price', label: 'Harga' },
            ]}
            value={kind}
            onChange={(v) => {
              setKind(v as DiscountKind)
              setText('')
              setTouched(false)
            }}
          />
          <TextField
            label={isPrice ? 'Harga satuan baru' : 'Diskon'}
            autoFocus
            inputMode="numeric"
            placeholder={kind === 'percent' ? '10' : isPrice ? String(Math.max(target.unitPrice - 1, 1)) : '2.000'}
            {...(kind === 'percent' ? { trailingAdornment: <span aria-hidden>%</span> } : { prefix: 'Rp' })}
            value={text}
            error={touched || text.trim() ? error : undefined}
            onChange={(e) => setText(e.target.value)}
          />
          <dl className="space-y-1 rounded-2xl border border-default-primary p-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-default-secondary">Harga baris</dt>
              <dd>{rupiah(lineTotal)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-default-secondary">{isPrice ? 'Potongan harga' : 'Diskon'}</dt>
              <dd className="text-default-brand">{rupiah(-off)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-default-primary pt-1 font-bold">
              <dt>Harga baru</dt>
              <dd className="text-default-brand">{rupiah(lineTotal - off)}</dd>
            </div>
          </dl>
          <p className="text-xs text-default-secondary">
            {isPrice
              ? `Harga normal ${rupiah(target.unitPrice)} per item. Lebih dari 30% di bawahnya meminta PIN admin.`
              : 'Lebih dari 30% meminta PIN admin. Tidak bisa 100%.'}
          </p>
          <ActionRow>
            <Button width="auto" type="outline" color="light" onClick={onClose}>
              Batal
            </Button>
            {target.current && (
              <Button
                width="auto"
                type="outline"
                color="danger"
                onClick={() => {
                  onRemove(target.key)
                  notifySuccess(`Diskon ${target.name} dihapus`)
                  onClose()
                }}
              >
                Hapus diskon
              </Button>
            )}
            <Button width="auto" htmlType="submit">
              {big ? 'Minta PIN admin' : 'Terapkan'}
            </Button>
          </ActionRow>
        </form>
      ) : (
        <form
          noValidate
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6"
          onSubmit={(e) => {
            e.preventDefault()
            void submitPin()
          }}
        >
          <p className="text-sm">
            {isPrice
              ? `Harga manual ${rupiah(value)} untuk ${target.name} ${percentText(off, lineTotal)} (${rupiah(off)}) di bawah harga normal, lebih dari batas 30%.`
              : `Diskon ${percentText(off, lineTotal)} (${rupiah(off)}) untuk ${target.name} lebih dari batas 30%.`}
          </p>
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
                <Button type="outline" color="light" size="small" width="auto" onClick={reloadApprovers}>
                  Coba lagi
                </Button>
              }
            >
              {approvers.error}
            </Alert>
          )}
          {approvers.state === 'ready' && !list.some((a) => a.hasPin) && (
            <Alert variant="warning" size="small" role="alert">
              Belum ada pemilik atau admin berizin diskon yang punya PIN. Minta pemilik membuat PIN di menu Keamanan.
            </Alert>
          )}
          <ApproverPinFields
            approvers={approvers}
            list={list}
            approverId={approverId}
            pin={pin}
            errors={pinErrors}
            onApprover={setApproverId}
            onPin={setPin}
          />
          <p className="text-xs text-default-secondary">
            Admin lain atau pemilik yang memegang izin diskon memasukkan PIN-nya sendiri.
          </p>
          <ActionRow>
            <Button width="auto" type="outline" color="light" disabled={busy} onClick={() => setStep('edit')}>
              Batal
            </Button>
            <Button width="auto" htmlType="submit" disabled={busy || approvers.state !== 'ready'}>
              {busy ? 'Memeriksa PIN…' : 'Setujui diskon'}
            </Button>
          </ActionRow>
        </form>
      )}
    </Dialog>
  )
}
