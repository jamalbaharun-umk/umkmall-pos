import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  TextField,
  toast,
} from '@umkmall/ui'
import { useRef, useState, type FormEvent } from 'react'
import { loadReceivable, payReceivable } from '../pelanggan/-api'
import { parseRupiah } from '../pelanggan/-form'
import { formatDate, LoadError, Page, Pending, rupiah } from '../pelanggan/-ui'

// Lakasir ViewReceivable: details, the sale's items, the payment history and the "add payment" action.
export const Route = createFileRoute('/piutang/$id')({
  loader: ({ params }) => loadReceivable({ data: params.id }),
  pendingComponent: Pending,
  errorComponent: LoadError,
  component: ReceivablePage,
})

function ReceivablePage() {
  const { receivable: r, methods } = Route.useLoaderData()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false) // set synchronously: a double click sends one request
  const [error, setError] = useState<string>()
  const [amountError, setAmountError] = useState<string>()
  // One key per opened dialog: a double tap or a network retry records one payment (pos-api Idempotency-Key).
  const [key, setKey] = useState(() => crypto.randomUUID())

  function openDialog() {
    setKey(crypto.randomUUID())
    setAmount('')
    setError(undefined)
    setAmountError(undefined)
    setOpen(true)
  }

  /** Mirrors pos-api: required, whole rupiah, more than 0, at most the rest. */
  function checkAmount(raw: string): string | undefined {
    if (!raw.trim()) return 'Wajib diisi'
    const value = parseRupiah(raw)
    if (Number.isNaN(value)) return 'Harus bilangan bulat rupiah'
    if (value <= 0) return 'Harus lebih dari 0'
    if (value > r.rest) return `Pembayaran melebihi sisa piutang (${rupiah(r.rest)})`
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    const problem = checkAmount(amount)
    setAmountError(problem)
    if (problem) return
    inFlight.current = true
    setBusy(true)
    setError(undefined)
    try {
      const res = await payReceivable({
        data: { id: r.id, key, amount: parseRupiah(amount), paymentMethodId: methodId || undefined },
      })
      if (!res.ok) {
        setAmountError(res.errors?.amount)
        if (!res.errors?.amount) setError(res.errors?.paymentMethodId ?? res.error)
        toast(res.error, { variant: 'danger' })
        return
      }
      // Fresh numbers first, then close and toast together: no moment showing the old balance.
      await router.invalidate()
      setOpen(false)
      toast(`Pembayaran ${rupiah(parseRupiah(amount))} tercatat`, { variant: 'success' })
    } catch {
      setError('Terjadi kesalahan. Coba lagi sebentar lagi.')
      toast('Terjadi kesalahan. Coba lagi sebentar lagi.', { variant: 'danger' })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Page
      title={`Piutang ${r.memberName}`}
      crumbs={[{ label: 'Piutang', to: '/piutang' }, { label: 'Detail' }]}
      actions={
        <>
          <Button asChild type="outline" color="light" width="auto">
            <Link to="/piutang">Kembali</Link>
          </Button>
          {r.rest > 0 && (
            <Button width="auto" onClick={openDialog}>
              Tambah pembayaran
            </Button>
          )}
        </>
      }
    >
      <Card variant="outlined" padding="large" className="space-y-6">
        <dl className="grid max-w-md grid-cols-2 gap-y-1 text-sm">
          <dt className="font-medium">Pelanggan</dt>
          <dd className="text-right">{r.memberName}</dd>
          <dt className="font-medium">Penjualan</dt>
          <dd className="text-right">#{r.saleNumber}</dd>
          <dt className="font-medium">Tanggal</dt>
          <dd className="text-right">{formatDate(r.createdAt)}</dd>
          <dt className="font-medium">Jatuh tempo</dt>
          <dd className="text-right">{formatDate(r.dueDate)}</dd>
          <dt className="font-medium">Total piutang</dt>
          <dd className="text-right">{rupiah(r.total)}</dd>
          <dt className="font-bold">Sisa piutang</dt>
          <dd className="text-right font-bold">{rupiah(r.rest)}</dd>
          <dt className="font-medium">Status</dt>
          <dd className="text-right">
            {r.rest === 0 ? <Badge color="success">Lunas</Badge> : <Badge color="warning">Belum lunas</Badge>}
          </dd>
        </dl>

        <section className="space-y-2">
          <Text as="h2" variant="h5" weight="bold">
            Barang
          </Text>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead className="text-right">Harga</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>{l.name}</TableCell>
                  <TableCell className="text-right">{rupiah(l.unitPrice)}</TableCell>
                  <TableCell className="text-right">{l.qty}</TableCell>
                  <TableCell className="text-right">{rupiah(l.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section className="space-y-2">
          <Text as="h2" variant="h5" weight="bold">
            Pembayaran
          </Text>
          {r.payments.length === 0 ? (
            <p className="text-sm text-default-secondary">Belum ada pembayaran.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Metode</TableHead>
                  <TableHead className="text-right">Sisa sebelumnya</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatDate(p.createdAt)}</TableCell>
                    <TableCell>{p.paymentMethod}</TableCell>
                    <TableCell className="text-right">{rupiah(p.restBefore)}</TableCell>
                    <TableCell className="text-right">{rupiah(p.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </Card>

      <Dialog open={open} onOpenChange={setOpen} centered title="Tambah pembayaran">
        <form onSubmit={submit} noValidate className="space-y-4 px-6 pb-6">
          <p className="text-sm text-default-secondary">Sisa piutang {rupiah(r.rest)}</p>
          <TextField
            label="Jumlah (Rp)"
            inputMode="numeric"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setAmountError(undefined)
            }}
            error={amountError}
            placeholder="Contoh: 2.500"
            required
          />
          <Select
            label="Metode pembayaran"
            options={methods.map((m) => ({ value: m.id, label: m.name }))}
            value={methodId}
            onValueChange={setMethodId}
          />
          {error && (
            <Alert variant="danger" size="small" role="alert">
              {error}
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button type="outline" color="light" width="auto" onClick={() => {
                setAmount(String(r.rest))
                setAmountError(undefined)
              }}>
              Lunasi
            </Button>
            <Button htmlType="submit" width="auto" isLoading={busy} disabled={busy}>
              Simpan
            </Button>
          </div>
        </form>
      </Dialog>
    </Page>
  )
}
