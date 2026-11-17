import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  Button,
  Card,
  Icon,
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
import { useState, type FormEvent, useRef } from 'react'
import {
  act,
  check,
  compact,
  Empty,
  ErrorText,
  type FieldErrors,
  LoadError,
  Page,
  Pending,
  req,
  rupiah,
} from '@/components/pos-page'
import { useCan } from '@/components/shell'
import { createOrder, loadOrderForm } from './-api'
import { type OrderLine as Line, toInt, validateOrder } from './-validate'

// Lakasir's create purchasing (supplier, payment method) plus its stock lines, on one screen: U6 creates the order
// with its lines in one call.
export const Route = createFileRoute('/pembelian/baru')({
  loader: () => loadOrderForm(),
  component: NewOrderPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function NewOrderPage() {
  const { suppliers, products } = Route.useLoaderData()
  const navigate = useNavigate()
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')
  const [paymentMethod, setPaymentMethod] = useState('Tunai')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([{ productId: '', qty: '1', unitCost: '' }])
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false) // state lags a burst of clicks; the ref does not

  const canManage = useCan('purchasing.manage')

  if (!canManage)
    return (
      <Page crumbs={[{ label: 'Pembelian', to: '/pembelian' }, { label: 'Buat' }]} title="Pembelian baru">
        <Card variant="outlined">
          <Empty
            title="Kamu tidak punya izin"
            hint="Membuat pembelian butuh izin Kelola pembelian. Minta pemilik toko menambahkannya ke peranmu."
          />
        </Card>
      </Page>
    )

  if (suppliers.length === 0 || products.length === 0)
    return (
      <Page crumbs={[{ label: 'Pembelian', to: '/pembelian' }, { label: 'Buat' }]} title="Pembelian baru">
        <Card variant="outlined">
          <Empty
            title={suppliers.length === 0 ? 'Belum ada pemasok' : 'Belum ada produk berstok'}
            hint={
              suppliers.length === 0 ? 'Tambahkan pemasok dulu.' : 'Tambahkan produk berjenis Barang di katalog dulu.'
            }
            action={
              <Button width="auto" asChild type="outline">
                <Link to={suppliers.length === 0 ? '/pemasok' : '/catalog/products'}>
                  {suppliers.length === 0 ? 'Buka pemasok' : 'Buka katalog'}
                </Link>
              </Button>
            }
          />
        </Card>
      </Page>
    )

  const set = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  // Preview only: pos-api computes the stored total.
  const total = lines.reduce((sum, l) => sum + (toInt(l.qty) * toInt(l.unitCost) || 0), 0)
  const productOptions = products.map((p) => ({
    value: p.id,
    label: p.name,
    description: p.sku,
  }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    const local = validateOrder({ supplierId, lines })
    setErrors(local)
    if (Object.keys(local).length) return setError(local.lines ?? 'Periksa kembali isian yang ditandai.')
    lock.current = true
    setBusy(true)
    setError(undefined)
    const r = await act(
      () =>
        createOrder({
          data: {
            supplierId,
            paymentMethod: paymentMethod.trim() || null,
            note: note.trim() || null,
            lines: lines.map((l) => ({ productId: l.productId, qty: toInt(l.qty), unitCost: toInt(l.unitCost) })),
          },
        }),
      'Pembelian disimpan sebagai draf',
    )
    lock.current = false
    setBusy(false)
    if (!r.ok) {
      setErrors(r.errors)
      return setError(r.errors.lines ?? r.error)
    }
    if (r.res.ok) await navigate({ to: '/pembelian/$id', params: { id: r.res.id! } })
  }

  return (
    <Page crumbs={[{ label: 'Pembelian', to: '/pembelian' }, { label: 'Buat' }]} title="Pembelian baru">
      <form onSubmit={submit} noValidate className="space-y-6">
        <Card variant="outlined" padding="large">
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label={req('Pemasok')}
              error={errors.supplierId}
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              value={supplierId}
              onValueChange={setSupplierId}
              showSearch
            />
            <TextField
              label="Metode pembayaran"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              maxLength={60}
              error={errors.paymentMethod}
              placeholder="Tunai, Transfer, Tempo…"
            />
            <div className="md:col-span-2">
              <TextField
                label="Catatan"
                multiline
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                error={errors.note}
                maxLength={500}
              />
            </div>
          </div>
        </Card>
        <Card variant="outlined" padding="none">
          <div className="flex items-center justify-between p-4">
            <Text as="h2" variant="h6" weight="bold">
              Barang
            </Text>
            <Button
              width="auto"
              size="small"
              type="outline"
              onClick={() => setLines((ls) => [...ls, { productId: '', qty: '1', unitCost: '' }])}
            >
              <Icon name="plus" size="sm" /> Tambah barang
            </Button>
          </div>
          <Table density="comfortable">
            <TableHeader>
              <TableRow>
                <TableHead>{req('Produk')}</TableHead>
                <TableHead className="w-28">{req('Jumlah')}</TableHead>
                <TableHead className="w-40">{req('Harga beli')}</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell className="min-w-56">
                    <Select
                      aria-label={`Produk baris ${i + 1}`}
                      portal
                      size="small"
                      showSearch
                      placeholder="Pilih produk"
                      error={errors[`lines.${i}.productId`]}
                      options={productOptions}
                      value={l.productId || undefined}
                      onValueChange={(v) =>
                        set(i, {
                          productId: v,
                          unitCost: l.unitCost || String(products.find((x) => x.id === v)?.costPrice ?? ''),
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      aria-label={`Jumlah baris ${i + 1}`}
                      size="small"
                      inputMode="numeric"
                      required
                      error={errors[`lines.${i}.qty`]}
                      value={l.qty}
                      onChange={(e) => set(i, { qty: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      aria-label={`Harga beli baris ${i + 1}`}
                      size="small"
                      prefix="Rp"
                      inputMode="numeric"
                      required
                      error={errors[`lines.${i}.unitCost`]}
                      value={l.unitCost}
                      onChange={(e) => set(i, { unitCost: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="text-right">{rupiah(toInt(l.qty) * toInt(l.unitCost) || 0)}</TableCell>
                  <TableCell>
                    <Button
                      iconOnly
                      aria-label={`Hapus baris ${i + 1}`}
                      size="small"
                      type="text"
                      color="danger"
                      disabled={lines.length === 1}
                      onClick={() => {
                        setLines((ls) => ls.filter((_, j) => j !== i))
                        setErrors({}) // line keys shift with the rows
                      }}
                    >
                      <Icon name="trash" size="sm" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="flex justify-end gap-6 p-4 text-lg font-bold">
            <span>Total</span>
            <span>{rupiah(total)}</span>
          </p>
        </Card>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button width="auto" htmlType="submit" isLoading={busy}>
            Simpan sebagai draf
          </Button>
          <Button width="auto" asChild type="outline" color="light" disabled={busy}>
            <Link to="/pembelian">Batal</Link>
          </Button>
        </div>
      </form>
    </Page>
  )
}
