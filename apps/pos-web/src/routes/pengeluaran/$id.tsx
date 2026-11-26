import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Alert, Badge, Button, Chip, Dialog, TextField } from '@umkmall/ui/primitives'
import { Card } from '@umkmall/ui/compositions'
import { useRef, useState, type FormEvent } from 'react'
import { notifySuccess, showError } from '@/lib/feedback'
import { dateTime, Page, PageError, PageLoading } from '@/components/page'
import { placeErrors } from '@/lib/refusal'
import { loadExpense, updateExpense, voidExpense, type Category, type ExpenseDetail } from './-api'
import { amountError, dayLabel, describeChanges, formatAmountInput, parseAmount, rupiah, sourceLabel } from './-helpers'
import { ActionRow } from '@/components/action-row'

export const Route = createFileRoute('/pengeluaran/$id')({
  loader: ({ params }) => loadExpense({ data: params.id }),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: ExpensePage,
})

function ExpensePage() {
  const { expense: e, categories, today } = Route.useLoaderData()
  const labels = Object.fromEntries(categories.map((c) => [c.category, c.label]))
  const voided = !!e.voidedAt
  return (
    <Page
      title={`${e.categoryLabel} ${rupiah(e.amount)}`}
      crumbs={[{ label: 'Pengeluaran', to: '/pengeluaran' }, { label: e.categoryLabel }]}
    >
      <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
        <Card variant="outlined" padding="medium" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-3xl font-bold text-default-primary">{rupiah(e.amount)}</p>
            {voided && <Badge color="light">Dibatalkan</Badge>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <Row k="Kategori" v={e.categoryLabel} />
            <Row k="Sumber uang" v={sourceLabel(e.source)} />
            <Row k="Tanggal" v={dayLabel(e.date)} />
            <Row k="Catatan" v={e.note || '–'} />
            <Row k="Dicatat oleh" v={`${e.actorName}, ${dateTime(e.createdAt)}`} />
          </dl>
          {e.exceedsDrawerCash && (
            <Alert variant="warning" size="small">
              Saat dicatat, jumlah ini lebih besar dari uang di laci.
            </Alert>
          )}
          {e.kind === 'supplier_payment' && (
            <Alert variant="info" size="small">
              Bayar pemasok tidak dihitung sebagai pengeluaran di Untung rugi: modal barang sudah dihitung.
            </Alert>
          )}
          {voided && (
            <Alert variant="danger" size="small">
              Dibatalkan oleh {e.voidedByName ?? 'staf'}, {dateTime(e.voidedAt!)}.
              {e.voidReason ? ` Alasan: ${e.voidReason}.` : ''}
              {e.source === 'drawer' &&
                (e.cashReturnedTo === 'drawer'
                  ? ' Uang dikembalikan ke hitungan laci shift itu.'
                  : e.cashReturnedTo === 'store_cash'
                    ? ' Shift itu sudah ditutup, jadi uangnya dicatat masuk ke kas toko.'
                    : ' Shift itu sudah ditutup, hitungannya tidak berubah.')}
            </Alert>
          )}
          {!voided && <VoidAction expense={e} />}
        </Card>
        {!voided && <EditForm key={`${e.id}:${e.edits.length}`} expense={e} categories={categories} today={today} />}
      </div>
      <History expense={e} labels={labels} />
    </Page>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-default-secondary">{k}</dt>
      <dd className="text-default-primary">{v}</dd>
    </>
  )
}

function EditForm({ expense: e, categories, today }: { expense: ExpenseDetail; categories: Category[]; today: string }) {
  const router = useRouter()
  const outside = e.source === 'outside'
  const [category, setCategory] = useState(e.category)
  const [note, setNote] = useState(e.note ?? '')
  const [amountText, setAmountText] = useState(formatAmountInput(String(e.amount)))
  const [date, setDate] = useState(e.date)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (inFlight.current) return
    const amount = parseAmount(amountText)
    const bad = outside ? amountError(amount) : undefined
    setErrors(bad ? { amount: bad } : {})
    setFormError(undefined)
    if (bad) return
    // Only what changed is sent: the server records one history row per real change.
    const body: Parameters<typeof updateExpense>[0]['data']['body'] = {}
    if (category !== e.category) body.category = category
    if (note.trim() !== (e.note ?? '')) body.note = note.trim() || null
    if (outside && amount !== e.amount) body.amount = amount
    if (outside && date !== e.date) body.date = date
    if (Object.keys(body).length === 0) return setFormError('Tidak ada yang diubah')
    inFlight.current = true
    setBusy(true)
    try {
      const res = await updateExpense({ data: { id: e.id, body } })
      if (!res.ok) {
        const placed = placeErrors(res, ['amount', 'category', 'note', 'date'])
        setErrors(placed.byField)
        setFormError(placed.formError)
        showError(res, 'menyimpan perubahan pengeluaran')
        return
      }
      await router.invalidate()
      notifySuccess('Perubahan pengeluaran tersimpan')
    } catch (err) {
      setFormError('Perubahan belum tersimpan. Cek sinyal lalu coba lagi.')
      showError(err, 'menyimpan perubahan pengeluaran')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Card variant="outlined" padding="medium">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="font-semibold text-default-primary">Ubah pengeluaran</h2>
        {outside ? (
          <TextField
            label="Jumlah"
            prefix="Rp"
            inputMode="numeric"
            value={amountText}
            error={errors.amount}
            onChange={(ev) => setAmountText(formatAmountInput(ev.target.value))}
          />
        ) : (
          <p className="text-sm text-default-secondary">
            Jumlah dan tanggal tidak bisa diubah karena uangnya sudah keluar dari laci. Batalkan lalu catat ulang bila salah.
          </p>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-default-secondary">Kategori</legend>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Chip key={c.category} state={category === c.category ? 'active' : 'default'} onClick={() => setCategory(c.category)}>
                {c.label}
              </Chip>
            ))}
          </div>
          {errors.category && <p role="alert" className="text-sm text-default-error">{errors.category}</p>}
        </fieldset>
        <TextField label="Catatan" value={note} maxLength={200} error={errors.note} onChange={(ev) => setNote(ev.target.value)} />
        {outside && (
          <TextField label="Tanggal" type="date" value={date} max={today} error={errors.date} onChange={(ev) => setDate(ev.target.value)} />
        )}
        {formError && <Alert variant="danger" role="alert">{formError}</Alert>}
        <Button htmlType="submit" width="auto" isLoading={busy} disabled={busy}>
          Simpan perubahan
        </Button>
      </form>
    </Card>
  )
}

function VoidAction({ expense: e }: { expense: ExpenseDetail }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  async function confirm() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(undefined)
    try {
      const res = await voidExpense({ data: { id: e.id, reason: reason.trim() || undefined } })
      if (!res.ok) {
        setError(res.error)
        showError(res, 'membatalkan pengeluaran')
        return
      }
      setOpen(false)
      await router.invalidate()
      notifySuccess(`Pengeluaran ${rupiah(e.amount)} dibatalkan`)
    } catch (err) {
      setError('Pengeluaran belum dibatalkan. Cek sinyal lalu coba lagi.')
      showError(err, 'membatalkan pengeluaran')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <Button type="outline" color="danger" width="auto" onClick={() => setOpen(true)}>
        Batalkan pengeluaran
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && setOpen(false)} title="Batalkan pengeluaran ini?" size="small" centered>
        <div className="flex flex-col gap-4 px-6 pt-2 pb-6">
          <p className="text-sm text-default-secondary">
            {rupiah(e.amount)} untuk {e.categoryLabel} tidak lagi dihitung di total dan Untung rugi.
            {e.source === 'drawer' && ' Bila shiftnya masih buka, uang dikembalikan ke hitungan laci.'} Catatannya tetap ada dengan tanda dibatalkan.
          </p>
          <TextField label="Alasan (boleh kosong)" value={reason} maxLength={200} onChange={(ev) => setReason(ev.target.value)} />
          {error && <p role="alert" className="text-sm text-default-error">{error}</p>}
          <ActionRow>
            <Button type="outline" color="light" size="small" width="auto" disabled={busy} onClick={() => setOpen(false)}>
              Kembali
            </Button>
            <Button type="primary" color="danger" size="small" width="auto" isLoading={busy} onClick={() => void confirm()}>
              Ya, batalkan
            </Button>
          </ActionRow>
        </div>
      </Dialog>
    </>
  )
}

function History({ expense: e, labels }: { expense: ExpenseDetail; labels: Record<string, string> }) {
  return (
    <Card variant="outlined" padding="medium" className="max-w-4xl">
      <h2 className="mb-2 font-semibold text-default-primary">Riwayat perubahan</h2>
      {e.edits.length === 0 ? (
        <p className="text-sm text-default-secondary">Belum pernah diubah.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {e.edits.map((h) => (
            <li key={h.id} className="text-sm">
              <p className="text-default-secondary">
                {h.actorName}, {dateTime(h.createdAt)}
              </p>
              <ul className="list-disc pl-5 text-default-primary">
                {describeChanges(h.changes, labels).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
