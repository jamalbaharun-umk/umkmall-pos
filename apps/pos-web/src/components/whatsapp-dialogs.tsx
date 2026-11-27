import { useNavigate, getRouteApi } from '@tanstack/react-router'
import { Alert, Button, Dialog, Skeleton, TextField } from '@umkmall/ui/primitives'
import { useEffect, useRef, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import type { Me } from '@/components/shell'
import { describeError, notifySuccess, showError } from '@/lib/feedback'
import {
  normalizePhone,
  receiptMessage,
  reminderMessage,
  remindedAgainNote,
  whatsappLink,
  customerSearch,
  type ReminderSource,
} from '@/lib/whatsapp'
import { loadReceipt } from '../routes/kasir/-api'
import { loadReminder, markReminded, type Reminder } from '../routes/piutang/-reminder-api'

// UMK-1987 (receipt) and UMK-1973 (kasbon reminder): a ready message opened in WhatsApp through a wa.me link. The POS
// never sends it and never claims it was sent; the person presses send in WhatsApp. No number, name or message is
// logged, and none is stored: the receipt's number is kept only when it is the member's own, the reminder keeps a date.

const root = getRouteApi('__root__')

/** The store's name for the message's greeting. */
function useStoreName(): string {
  const me = root.useLoaderData() as Me | null
  return me?.tenant.name?.trim() || 'Toko Anda'
}

const EXAMPLE = '0812 3456 7890'

/** Opens the link in a new tab (WhatsApp on a phone, WhatsApp Web on a computer). False when the browser refused. */
function openWhatsapp(url: string): boolean {
  try {
    // Not the `noopener` feature: it makes window.open answer null even when the tab opened, which would read as
    // "blocked". The opener is cut by hand instead.
    const w = window.open(url, '_blank')
    if (!w) return false
    w.opener = null
    return true
  } catch {
    return false
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** The dialog's own failure texts (the design's "Nomor tidak valid", "Pelanggan belum punya nomor"). */
function whatsappFailure(error: unknown, fallback: string) {
  const f = (error ?? {}) as { code?: string; status?: number; error?: string }
  switch (f.code) {
    case 'PHONE_INVALID':
      return {
        what: 'Nomor belum lengkap atau bukan nomor WhatsApp Indonesia.',
        todo: `Isi nomor lengkap, contoh ${EXAMPLE}.`,
        code: 'PHONE_INVALID',
        primary: 'retry' as const,
      }
    case 'PHONE_MISSING':
      return {
        what: 'Pelanggan ini belum punya nomor WhatsApp.',
        todo: 'Tambahkan nomor di data pelanggan.',
        code: 'PHONE_MISSING',
        primary: 'retry' as const,
      }
    case 'WHATSAPP_BLOCKED':
      return {
        what: 'Browser menahan pembukaan WhatsApp.',
        todo: 'Izinkan jendela baru untuk halaman ini lalu coba lagi, atau salin pesan dan kirim manual.',
        code: 'WHATSAPP_BLOCKED',
        primary: 'retry' as const,
      }
    case 'nothing_owed':
      return {
        what: 'Pelanggan ini tidak punya sisa kasbon, jadi tidak ada yang perlu diingatkan.',
        todo: 'Muat ulang daftar piutang.',
        code: 'NOTHING_OWED',
        primary: 'reload' as const,
      }
    default:
      return null
  }
}

const describe = (error: unknown, fallback: string) => whatsappFailure(error, fallback) ?? describeError(error, fallback)

function Preview({ text, onCopy }: { text: string; onCopy: () => void }) {
  return (
    <section aria-label="Pratinjau pesan" className="flex flex-col gap-2">
      <p className="text-sm font-medium text-default-primary">Pratinjau pesan</p>
      <pre className="whitespace-pre-wrap break-words rounded-xl border border-default-primary bg-default-secondary p-3 font-sans text-sm text-default-primary">
        {text}
      </pre>
      <ActionRow align="start">
        <Button type="outline" color="light" width="auto" onClick={onCopy}>
          Salin pesan
        </Button>
      </ActionRow>
    </section>
  )
}

/** One failed open of WhatsApp: the browser refused the new tab, so the message can still be copied. */
function blocked(onFix: () => void) {
  showError({ code: 'WHATSAPP_BLOCKED' }, { action: 'membuka WhatsApp', retry: onFix, retryLabel: 'Coba buka lagi' }, describe)
}

/**
 * "Kirim struk WhatsApp" (design 33): the number (the member's, or typed), the preview of the receipt message, and
 * Buka WhatsApp. The receipt is read from pos-api (`GET /sales/:id/receipt`), so every figure is the server's.
 */
export function WhatsappReceiptDialog({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const store = useStoreName()
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; message: string; number: number; memberPhone: string | null }
  >({ kind: 'loading' })
  const [phone, setPhone] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    setState({ kind: 'loading' })
    loadReceipt({ data: saleId }).then(
      (r) => {
        if (!live) return
        setPhone(r.memberPhone ?? '')
        setState({
          kind: 'ready',
          number: r.number,
          memberPhone: r.memberPhone ?? null,
          message: receiptMessage(r, store, r.paidAt ?? r.createdAt),
        })
      },
      (e: unknown) => {
        if (!live) return
        onClose()
        showError(e, { action: 'memuat struk', fallback: 'Struk belum bisa dimuat.' })
      },
    )
    return () => {
      live = false
    }
    // The receipt is read once per opening; the store name only fills the greeting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId])

  const typed = phone.trim() !== ''
  const parsed = normalizePhone(phone)

  function open() {
    if (state.kind !== 'ready') return
    if (!parsed.ok) {
      showError(
        { code: 'PHONE_INVALID' },
        { action: 'membuka WhatsApp', retry: () => input.current?.focus(), retryLabel: 'Perbaiki nomor' },
        describe,
      )
      return
    }
    if (!openWhatsapp(whatsappLink(parsed.digits, state.message))) {
      blocked(open)
      return
    }
    onClose()
    notifySuccess(`WhatsApp dibuka dengan struk #${state.number}. Tekan kirim di sana`)
  }

  async function copy() {
    if (state.kind !== 'ready') return
    if (await copyText(state.message)) notifySuccess('Pesan disalin. Tempel di WhatsApp')
    else showError({ status: 0 }, { action: 'menyalin pesan', fallback: 'Pesan belum bisa disalin.' })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} centered title="Kirim struk">
      <div className="flex flex-col gap-4 px-6 pb-6">
        {state.kind === 'loading' ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Memuat struk">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <TextField
                ref={input}
                label="Nomor WhatsApp pelanggan"
                inputMode="tel"
                autoComplete="off"
                placeholder={EXAMPLE}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                error={typed && !parsed.ok ? `Nomor ${phone.trim()} belum lengkap. Isi nomor lengkap, contoh ${EXAMPLE}.` : undefined}
              />
              {parsed.ok && <p className="text-sm text-default-secondary">Akan dibuka sebagai {parsed.display}.</p>}
              {state.memberPhone && (
                <p className="text-xs text-default-secondary">Nomor member tersimpan terisi otomatis dan bisa diubah.</p>
              )}
            </div>
            <Preview text={state.message} onCopy={() => void copy()} />
            <p className="text-xs text-default-secondary">
              Nomor tidak disimpan kecuali pelanggan sudah terdaftar sebagai member.
            </p>
          </>
        )}
        <ActionRow>
          <Button type="outline" color="light" width="auto" onClick={onClose}>
            Batal
          </Button>
          <Button width="auto" disabled={state.kind !== 'ready'} onClick={open}>
            Buka WhatsApp
          </Button>
        </ActionRow>
      </div>
    </Dialog>
  )
}

/**
 * "Kirim pengingat" (design 34): the message for one customer's open kasbon, a question when the customer was
 * reminded under three days ago, and Buka WhatsApp, which also leaves today's date on the customer. A queue
 * (`step`) walks the late customers one after another: WhatsApp opens one chat at a time.
 */
export function WhatsappReminderDialog({
  memberId,
  step,
  onClose,
  onDone,
  onSkip,
}: {
  memberId: string
  /** "Pengingat 2 dari 5" for a queue of late customers; absent for one customer. */
  step?: { index: number; total: number }
  onClose: () => void
  /** The date was saved: refresh the list. In a queue this also moves to the next customer. */
  onDone: () => void
  /** In a queue: leave this customer and go on with the next (or close after the last). One bad customer never ends the queue. */
  onSkip?: () => void
}) {
  const store = useStoreName()
  const navigate = useNavigate()
  const [r, setR] = useState<Reminder | null>(null)
  const [busy, setBusy] = useState(false)
  // A customer that cannot be reminded ends only this step of a queue.
  const leave = () => (onSkip ? onSkip() : onClose())

  useEffect(() => {
    let live = true
    setR(null)
    loadReminder({ data: memberId }).then(
      (res) => {
        if (!live) return
        if (!res.ok) {
          leave()
          showError(res, { action: 'memuat pengingat' }, describe)
          return
        }
        if (!res.data.phone) {
          leave()
          showError(
            { code: 'PHONE_MISSING' },
            { action: 'mengirim pengingat', retry: () => void navigate({ to: '/pelanggan', search: customerSearch(res.data.memberName) }), retryLabel: 'Buka pelanggan' },
            describe,
          )
          return
        }
        setR(res.data)
      },
      (e: unknown) => {
        if (!live) return
        leave()
        showError(e, { action: 'memuat pengingat' })
      },
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId])

  const source: ReminderSource | null = r
  const message = source ? reminderMessage(source, store, new Date().getFullYear()) : ''
  const parsed = r?.phone ? normalizePhone(r.phone) : ({ ok: false } as const)
  const again = r ? remindedAgainNote(r.memberName, r.remindedDaysAgo) : null

  async function copy() {
    if (await copyText(message)) notifySuccess('Pesan disalin. Tempel di WhatsApp')
    else showError({ status: 0 }, { action: 'menyalin pesan', fallback: 'Pesan belum bisa disalin.' })
  }

  async function open() {
    if (!r || busy) return
    if (!parsed.ok) {
      showError(
        { code: 'PHONE_INVALID' },
        { action: 'mengirim pengingat', retry: () => void navigate({ to: '/pelanggan', search: customerSearch(r.memberName) }), retryLabel: 'Buka pelanggan' },
        (e, f) => {
          const d = describe(e, f)
          return { ...d, what: 'Nomor pelanggan ini belum lengkap.', todo: 'Perbaiki nomor di data pelanggan.' }
        },
      )
      return
    }
    // The window opens inside the press (a popup blocker allows only that); the date is saved after.
    if (!openWhatsapp(whatsappLink(parsed.digits, message))) {
      blocked(() => void open())
      return
    }
    setBusy(true)
    const res = await markReminded({ data: memberId }).catch(() => null)
    setBusy(false)
    if (!res || !res.ok) {
      // WhatsApp did open; only the remembered date is missing.
      showError(res ?? { status: 0 }, { action: 'menyimpan tanggal pengingat' }, describe)
    } else notifySuccess(`Pengingat untuk ${r.memberName} siap dikirim di WhatsApp`)
    onDone()
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      centered
      title={r ? `Pengingat ${r.memberName}` : 'Pengingat'}
    >
      <div className="flex flex-col gap-4 px-6 pb-6">
        {step && (
          <p className="text-sm text-default-secondary">
            Pengingat {step.index} dari {step.total}
          </p>
        )}
        {!r ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Memuat pengingat">
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <Preview text={message} onCopy={() => void copy()} />
            {again && (
              <Alert variant="warning" size="small">
                {again}
              </Alert>
            )}
            {!parsed.ok && (
              <Alert variant="danger" size="small">
                Nomor pelanggan ini belum lengkap. Perbaiki di data pelanggan.
              </Alert>
            )}
          </>
        )}
        <ActionRow>
          <Button type="outline" color="light" width="auto" onClick={onClose}>
            {step ? 'Berhenti' : 'Batal'}
          </Button>
          {onSkip && (
            <Button type="outline" color="light" width="auto" disabled={busy} onClick={onSkip}>
              Lewati
            </Button>
          )}
          <Button width="auto" disabled={!r || busy} isLoading={busy} onClick={() => void open()}>
            Buka WhatsApp
          </Button>
        </ActionRow>
      </div>
    </Dialog>
  )
}
