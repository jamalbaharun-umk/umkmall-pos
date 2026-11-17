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
} from '@umkmall/ui'
import { useState, type FormEvent } from 'react'
import { loadReceivable, payReceivable } from '../pelanggan/-api'
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
  const [error, setError] = useState<string>()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = Number(amount.replace(/\D/g, ''))
    if (!value) return setError('Isi jumlah pembayaran.')
    setBusy(true)
    setError(undefined)
    try {
      const res = await payReceivable({ data: { id: r.id, amount: value, paymentMethodId: methodId || undefined } })
      if (!res.ok) return setError(res.error)
      setOpen(false)
      setAmount('')
      await router.invalidate()
    } catch {
      setError('Terjadi kesalahan. Coba lagi sebentar lagi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page
      title={`Piutang ${r.memberName}`}
      crumbs={[{ label: 'Piutang', to: '/piutang' }, { label: 'Detail' }]}
      actions={
        <>
          <Button asChild type="outline" color="dark" width="auto">
            <Link to="/piutang">Kembali</Link>
          </Button>
          {r.rest > 0 && (
            <Button width="auto" onClick={() => setOpen(true)}>
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
        <form onSubmit={submit} className="space-y-4 px-6 pb-6">
          <p className="text-sm text-default-secondary">Sisa piutang {rupiah(r.rest)}</p>
          <TextField
            label="Jumlah (Rp)"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
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
            <Button type="outline" color="dark" width="auto" onClick={() => setAmount(String(r.rest))}>
              Lunasi
            </Button>
            <Button htmlType="submit" width="auto" isLoading={busy}>
              Simpan
            </Button>
          </div>
        </form>
      </Dialog>
    </Page>
  )
}
