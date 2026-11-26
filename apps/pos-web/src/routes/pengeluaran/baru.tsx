import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Alert, Button, Chip, SegmentedControl, TextField } from '@umkmall/ui/primitives'
import { Card } from '@umkmall/ui/compositions'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { notifySuccess, showError } from '@/lib/feedback'
import { Page, PageError, PageLoading } from '@/components/page'
import { placeErrors } from '@/lib/refusal'
import { createExpense, loadExpenseForm } from './-api'
import {
  amountError,
  exceedsDrawer,
  formatAmountInput,
  parseAmount,
  rupiah,
  SOURCES,
  type ExpenseSource,
} from './-helpers'
import { ActionRow } from '@/components/action-row'

export const Route = createFileRoute('/pengeluaran/baru')({
  loader: () => loadExpenseForm(),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: NewExpense,
})

const FIELDS = ['amount', 'category', 'source', 'note', 'date'] as const

function NewExpense() {
  const { categories, today, expectedCash, hasShift } = Route.useLoaderData()
  const navigate = useNavigate()
  const [amountText, setAmountText] = useState('')
  const [category, setCategory] = useState('')
  const [source, setSource] = useState<ExpenseSource>('outside')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(today)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false) // set synchronously: a double tap sends one request
  // One key per submit attempt: a retry of the same form is one expense; changing anything makes a new key.
  const [key, setKey] = useState(() => crypto.randomUUID())
  useEffect(() => setKey(crypto.randomUUID()), [amountText, category, source, note, date])

  const amount = parseAmount(amountText)
  const drawer = source === 'drawer'
  const warn = exceedsDrawer(source, amount, expectedCash)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    const local: Record<string, string> = {}
    const bad = amountError(amount)
    if (bad) local.amount = bad
    if (!category) local.category = 'Pilih salah satu kategori'
    setErrors(local)
    setFormError(undefined)
    if (Object.keys(local).length) return
    inFlight.current = true
    setBusy(true)
    try {
      const res = await createExpense({
        data: {
          key,
          body: { amount, category, source, ...(note.trim() ? { note: note.trim() } : {}), date: drawer ? today : date },
        },
      })
      if (!res.ok) {
        const placed = placeErrors(res, FIELDS)
        setErrors(placed.byField)
        setFormError(placed.formError)
        showError(res, 'menyimpan pengeluaran')
        return
      }
      notifySuccess(`Pengeluaran ${rupiah(amount)} tersimpan`)
      await navigate({ to: '/pengeluaran/$id', params: { id: res.data.id } })
    } catch (e) {
      setFormError('Pengeluaran belum tersimpan. Cek sinyal lalu coba lagi.')
      showError(e, 'menyimpan pengeluaran')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Page title="Catat pengeluaran" crumbs={[{ label: 'Pengeluaran', to: '/pengeluaran' }, { label: 'Catat pengeluaran' }]}>
      <form noValidate onSubmit={submit} className="flex max-w-xl flex-col gap-5">
        <TextField
          label="Berapa rupiah?"
          prefix="Rp"
          inputMode="numeric"
          autoFocus
          size="large"
          value={amountText}
          placeholder="0"
          required
          error={errors.amount}
          onChange={(e) => setAmountText(formatAmountInput(e.target.value))}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-default-secondary">Untuk apa?</legend>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Chip key={c.category} state={category === c.category ? 'active' : 'default'} onClick={() => setCategory(c.category)}>
                {c.label}
              </Chip>
            ))}
          </div>
          {errors.category && (
            <p role="alert" className="text-sm text-default-error">
              {errors.category}
            </p>
          )}
        </fieldset>
        <div className="flex flex-col gap-2">
          <span id="sumber-uang" className="text-sm text-default-secondary">
            Uangnya dari mana?
          </span>
          <SegmentedControl
            aria-labelledby="sumber-uang"
            options={SOURCES.map((s) => ({ value: s.value, label: s.label }))}
            value={source}
            onChange={setSource}
          />
          {drawer ? (
            <Alert variant="info" size="small">
              Uang diambil dari laci. Hitungan laci langsung berkurang{amount > 0 ? ` ${rupiah(amount)}` : ''}. Tanggal otomatis hari ini.
              {!hasShift && ' Anda belum membuka shift: buka shift dulu, atau pilih Di luar laci.'}
            </Alert>
          ) : (
            <p className="text-sm text-default-secondary">Tidak mengubah uang di laci. Tanggal boleh hari lain.</p>
          )}
          {warn && (
            <Alert variant="warning" size="small" role="alert">
              Jumlah lebih besar dari uang di laci ({rupiah(expectedCash ?? 0)}). Tetap bisa disimpan.
            </Alert>
          )}
        </div>
        <TextField label="Catatan (boleh kosong)" value={note} placeholder="mis. token listrik" maxLength={200} error={errors.note} onChange={(e) => setNote(e.target.value)} />
        <TextField
          label="Tanggal"
          type="date"
          value={drawer ? today : date}
          max={today}
          disabled={drawer}
          error={errors.date}
          onChange={(e) => setDate(e.target.value)}
        />
        {formError && (
          <Alert variant="danger" role="alert">
            {formError}
          </Alert>
        )}
        <Card variant="outlined" padding="small" className="sticky bottom-2 md:static md:border-0 md:p-0">
          <ActionRow>
            <Button htmlType="button" type="outline" color="light" width="auto" disabled={busy} onClick={() => void navigate({ to: '/pengeluaran', search: { period: 'today' } })}>
              Batal
            </Button>
            <Button htmlType="submit" width="full" isLoading={busy} disabled={busy}>
              Simpan
            </Button>
          </ActionRow>
        </Card>
      </form>
    </Page>
  )
}
