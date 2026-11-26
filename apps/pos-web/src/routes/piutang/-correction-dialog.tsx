import { Alert, Button, Dialog, SegmentedControl, Select, TextField } from '@umkmall/ui/primitives'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ActionRow } from '@/components/action-row'
import { notifySuccess, showError } from '@/lib/feedback'
import { ApproverPinFields, ApproverStatus, useApprovers } from '../kasir/-approver-fields'
import { correctPayment, loadCorrectionApprovers, type OpenShift, type PaymentMethod, type Receivable } from '../pelanggan/-api'
import { parseRupiah } from '../pelanggan/-form'
import { formatMomentDay, rupiah } from '../pelanggan/-ui'
import {
  CORRECTION_NOTE_MAX,
  CORRECTION_REASONS,
  cashEffect,
  cashNotice,
  correctionBody,
  correctionErrors,
  correctionToast,
  fieldErrorsOf,
  restAfterCorrection,
  type CorrectionErrors,
} from './-correction'

type Payment = Receivable['payments'][number]

type Props = {
  receivable: Receivable
  payment: Payment | null
  methods: PaymentMethod[]
  shift: OpenShift
  canOpenShift: boolean
  onClose: () => void
  /** After a correction, or when pos-api says the payment was corrected already: the page reloads. */
  onChanged: () => Promise<void>
}

/**
 * "Koreksi pembayaran" (UMK-1971, design feature 31): the right amount and way of paying, or "Batalkan saja tanpa
 * pengganti", a reason, and an admin's 6-digit PIN. pos-api never edits the old payment: it writes a reversal line
 * and the new payment. The PIN lives only in this component's state and is cleared after every answer that is about
 * it and when the dialog closes. Every other field survives a refusal.
 */
export function CorrectionDialog({ receivable: r, payment, methods, shift, canOpenShift, onClose, onChanged }: Props) {
  const open = payment !== null
  const { approvers, reload, list, anyApprover } = useApprovers(open, loadCorrectionApprovers)
  const [mode, setMode] = useState<'replace' | 'cancel'>('replace')
  const [amount, setAmount] = useState('')
  const [methodId, setMethodId] = useState('')
  const [reasonCode, setReasonCode] = useState('')
  const [note, setNote] = useState('')
  const [approverId, setApproverId] = useState('')
  const [pin, setPin] = useState('')
  const [errors, setErrors] = useState<CorrectionErrors>({})
  const [busy, setBusy] = useState(false)
  const lock = useRef(false) // a double submit arrives before `busy` re-renders
  const key = useRef('')

  // By id: two methods may share a name. Undefined when the old method is no longer offered.
  const oldMethodId = methods.find((m) => m.id === payment?.paymentMethodId)?.id
  useEffect(() => {
    if (!payment) {
      setPin('')
      return
    }
    // One key per opening: a retry after a lost answer replays the first correction, never corrects twice.
    key.current = crypto.randomUUID()
    setMode('replace')
    setAmount(String(payment.amount))
    setMethodId(oldMethodId ?? methods[0]?.id ?? '')
    setReasonCode('')
    setNote('')
    setApproverId('')
    setPin('')
    setErrors({})
  }, [payment, oldMethodId, methods])

  if (!payment) return null

  const value = parseRupiah(amount)
  const method = methods.find((m) => m.id === methodId)
  const next = mode === 'replace' && value > 0 ? { amount: value, isCash: method?.kind === 'cash' } : null
  const effect = cashEffect(
    {
      amount: payment.amount,
      isCash: payment.isCash ?? payment.paymentMethod === 'Tunai',
      shiftId: payment.shiftId,
      shiftClosed: payment.shiftClosed ?? false,
      collectedOutsideShift: payment.collectedOutsideShift,
    },
    next,
    { hasOpenShift: !!shift, canOpenShift },
  )
  const notice = cashNotice(effect)
  const blocked = mode === 'replace' && effect.newNeedsShift
  const restAfter = restAfterCorrection(r.rest, payment.amount, mode === 'replace' ? (value > 0 ? value : null) : null)
  const showSummary = mode === 'cancel' || (value > 0 && value <= r.rest + payment.amount)

  const close = () => {
    if (busy) return
    setPin('')
    onClose()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current || !payment) return
    const form = { mode, amount: value, methodId, reasonCode, note, approverId, pin }
    const bad = correctionErrors(form, r.rest, { amount: payment.amount, methodId: oldMethodId })
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    lock.current = true
    setBusy(true)
    const answer = await correctPayment({
      data: { id: r.id, paymentId: payment.id, key: key.current, ...correctionBody(form) },
    }).catch(() => null)
    lock.current = false
    setBusy(false)
    if (!answer) {
      setPin('')
      showError({ status: 0 }, 'mengoreksi pembayaran')
      return
    }
    if (answer.ok) {
      setPin('')
      // Fresh numbers first, then close and toast together: no moment showing the old balance.
      await onChanged()
      onClose()
      notifySuccess(correctionToast(answer.correction.oldAmount, answer.correction.newAmount, rupiah))
      return
    }
    const fields = fieldErrorsOf(answer.errors)
    // The PIN is typed again only when the refusal is about it (wrong, locked).
    if (fields.pin || answer.status === 429) setPin('')
    setErrors(fields)
    // A wrong PIN gets the shared PIN text; every other refusal shows pos-api's sentence and its code.
    const failure =
      fields.pin === 'PIN salah'
        ? { code: 'PIN_INVALID' }
        : {
            status: answer.status,
            error: answer.error,
            code: answer.code,
            retryAfter: answer.retryAfter,
            ...(answer.code === 'ALREADY_REVERSED' ? { todo: 'Muat ulang riwayat pembayaran.' } : {}),
          }
    showError(failure, { action: 'mengoreksi pembayaran' })
    if (fields.pin || answer.status === 429) reload()
    if (answer.code === 'ALREADY_REVERSED' || answer.code === 'RECEIVABLE_CANCELLED') {
      await onChanged()
      onClose()
    }
  }

  const methodOptions = methods.map((m) => ({ value: m.id, label: m.name }))

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title="Koreksi pembayaran" size="small" centered>
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <p className="text-sm text-default-secondary">
          Pembayaran lama: <span className="font-semibold text-default-primary">{rupiah(payment.amount)}</span>{' '}
          {payment.paymentMethod.toLowerCase()}, {formatMomentDay(payment.createdAt)}. Pembayaran lama tidak dihapus:
          dibatalkan dengan baris pembalik.
        </p>

        <SegmentedControl
          aria-label="Jenis koreksi"
          options={[
            { value: 'replace', label: 'Ganti pembayaran' },
            { value: 'cancel', label: 'Batalkan saja' },
          ]}
          value={mode}
          onChange={(v) => {
            setMode(v)
            setErrors((x) => ({ ...x, amount: undefined, methodId: undefined }))
          }}
        />

        {mode === 'replace' ? (
          <>
            <TextField
              label="Jumlah yang benar (Rp)"
              inputMode="numeric"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setErrors((x) => ({ ...x, amount: undefined }))
              }}
              error={errors.amount}
              placeholder="Contoh: 3.000"
            />
            {methodOptions.length <= 3 ? (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-default-primary">Cara bayar</span>
                <SegmentedControl
                  aria-label="Cara bayar"
                  options={methodOptions}
                  value={methodId}
                  onChange={(v) => {
                    setMethodId(v)
                    setErrors((x) => ({ ...x, methodId: undefined, amount: undefined }))
                  }}
                />
                {errors.methodId && <span className="text-sm text-default-error">{errors.methodId}</span>}
              </div>
            ) : (
              <Select
                label="Cara bayar"
                options={methodOptions}
                value={methodId}
                onValueChange={(v) => {
                  setMethodId(v)
                  setErrors((x) => ({ ...x, methodId: undefined, amount: undefined }))
                }}
                error={errors.methodId}
              />
            )}
          </>
        ) : (
          <Alert variant="info" size="small">
            Pembayaran ini dibatalkan tanpa pengganti, misalnya karena dicatat untuk pelanggan yang salah.
          </Alert>
        )}

        <Select
          label="Alasan (wajib)"
          options={CORRECTION_REASONS.map((x) => ({ value: x.code, label: x.label }))}
          value={reasonCode}
          onValueChange={(v) => {
            setReasonCode(v)
            setErrors((x) => ({ ...x, reasonCode: undefined, note: undefined }))
          }}
          placeholder="Pilih alasan"
          error={errors.reasonCode}
        />
        <TextField
          label={reasonCode === 'other' ? 'Catatan (wajib)' : 'Catatan (boleh kosong)'}
          value={note}
          maxLength={CORRECTION_NOTE_MAX}
          onChange={(e) => {
            setNote(e.target.value)
            setErrors((x) => ({ ...x, note: undefined }))
          }}
          error={errors.note}
        />

        {showSummary && (
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 rounded-xl bg-default-secondary px-4 py-3 text-sm">
            <dt className="text-default-secondary">Pembayaran lama</dt>
            <dd className="text-right font-medium">Dibatalkan</dd>
            {mode === 'replace' && (
              <>
                <dt className="text-default-secondary">Pembayaran baru</dt>
                <dd className="text-right font-medium">{rupiah(value)}</dd>
              </>
            )}
            <dt className="font-semibold">Sisa piutang jadi</dt>
            <dd className="text-right font-semibold">{rupiah(restAfter)}</dd>
          </dl>
        )}

        {notice && (
          <Alert variant="info" size="small">
            {notice}
          </Alert>
        )}
        {mode === 'replace' && effect.newNeedsShift && (
          <Alert variant="warning" size="small">
            Buka shift dulu untuk menerima pembayaran tunai. Transfer dan QRIS tetap bisa dicatat.
          </Alert>
        )}

        <ApproverStatus approvers={approvers} anyApprover={anyApprover} reload={reload} />
        <p className="text-sm text-default-secondary">
          Admin lain atau pemilik yang memegang izin void menyetujui dengan PIN-nya sendiri.
        </p>
        <ApproverPinFields
          approvers={approvers}
          list={list}
          approverId={approverId}
          pin={pin}
          errors={errors}
          onApprover={(v) => {
            setApproverId(v)
            setErrors((x) => ({ ...x, approverId: undefined }))
          }}
          onPin={(v) => {
            setPin(v)
            setErrors((x) => ({ ...x, pin: undefined }))
          }}
        />

        <ActionRow>
          <Button type="outline" color="light" width="auto" disabled={busy} onClick={close}>
            Batal
          </Button>
          <Button
            htmlType="submit"
            width="auto"
            color={mode === 'cancel' ? 'danger' : undefined}
            isLoading={busy}
            disabled={busy || blocked || approvers.state !== 'ready' || !anyApprover}
          >
            {mode === 'cancel' ? 'Batalkan pembayaran' : 'Koreksi pembayaran'}
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}
