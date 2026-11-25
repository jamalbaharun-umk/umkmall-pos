import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  Alert,
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
} from '@/components/pos-page'
import { clearKeys } from '../../lib/form-checks'
import { useCan } from '@/components/shell'
import { createOpname, loadOpnameForm } from '../pembelian/-api'
import { type OpnameLine as Line, validateOpname } from '../pembelian/-validate'

// Lakasir's create stock opname plus its items (product, counted qty, reason) on one screen.
export const Route = createFileRoute('/stok-opname/baru')({
  loader: () => loadOpnameForm(),
  component: NewOpnamePage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

const blank = (): Line => ({ productId: '', countedQty: '', reason: '' })

function NewOpnamePage() {
  const products = Route.useLoaderData()
  const navigate = useNavigate()
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([blank()])
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false) // state lags a burst of clicks; the ref does not

  const canManage = useCan('purchasing.manage')

  if (!canManage)
    return (
      <Page crumbs={[{ label: 'Stok opname', to: '/stok-opname' }, { label: 'Buat' }]} title="Stok opname baru">
        <Card variant="outlined">
          <Empty
            title="Kamu tidak punya izin"
            hint="Membuat stok opname butuh izin Kelola pembelian. Minta pemilik toko menambahkannya ke peranmu."
          />
        </Card>
      </Page>
    )

  if (products.length === 0)
    return (
      <Page crumbs={[{ label: 'Stok opname', to: '/stok-opname' }, { label: 'Buat' }]} title="Stok opname baru">
        <Card variant="outlined">
          <Empty
            title="Belum ada produk berstok"
            hint="Tambahkan produk berjenis Barang di katalog dulu."
            action={
              <Button width="auto" asChild type="outline">
                <Link to="/catalog/products">Buka katalog</Link>
              </Button>
            }
          />
        </Card>
      </Page>
    )

  const set = (i: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
    // An edited field drops its own error (and the duplicate/total notes that depend on it) until the next submit.
    setErrors((e) => clearKeys(e, [...Object.keys(patch).map((k) => `lines.${i}.${k}`), 'lines']))
  }
  const productOptions = products.map((p) => ({
    value: p.id,
    label: p.name,
    description: p.sku,
  }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    const local = validateOpname(lines)
    setErrors(local)
    if (Object.keys(local).length) return setError('Periksa kembali isian yang ditandai.')
    lock.current = true
    setBusy(true)
    setError(undefined)
    const r = await act(
      () =>
        createOpname({
          data: {
            note: note.trim() || null,
            lines: lines.map((l) => ({
              productId: l.productId,
              countedQty: Number(l.countedQty.trim()),
              reason: l.reason.trim() || null,
            })),
          },
        }),
      'Opname disimpan sebagai draf',
      'menyimpan stok opname',
    )
    lock.current = false
    setBusy(false)
    if (!r.ok) {
      setErrors(r.errors)
      return setError(r.error)
    }
    if (r.res.ok) await navigate({ to: '/stok-opname/$id', params: { id: r.res.id! } })
  }

  return (
    <Page crumbs={[{ label: 'Stok opname', to: '/stok-opname' }, { label: 'Buat' }]} title="Stok opname baru">
      <Alert variant="info" treatment="accent">
        Jumlah yang kamu hitung menggantikan stok saat opname disetujui; penjualan sebelum itu ikut terhitung.
      </Alert>
      <form onSubmit={submit} noValidate className="space-y-6">
        <Card variant="outlined" padding="large">
          <TextField
            label="Catatan"
            multiline
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={errors.note}
            maxLength={500}
            placeholder="Misal: hitung akhir bulan, rak depan"
          />
        </Card>
        <Card variant="outlined" padding="none">
          <div className="flex items-center justify-between p-4">
            <Text as="h2" variant="h6" weight="bold">
              Hasil hitung
            </Text>
            <Button width="auto" size="small" type="outline" onClick={() => setLines((ls) => [...ls, blank()])}>
              <Icon name="plus" size="sm" /> Tambah produk
            </Button>
          </div>
          {/* In-place product picker: the scroller must not clip its list (a portalled list closes on a real click). */}
          <Table density="comfortable" containerClassName="overflow-visible" className="max-sm:block">
            <TableHeader className="max-sm:hidden">
              <TableRow>
                <TableHead>{req('Produk')}</TableHead>
                <TableHead className="w-32">{req('Jumlah dihitung')}</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody className="max-sm:block">
              {lines.map((l, i) => (
                <TableRow key={i} className="max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:items-end max-sm:gap-x-3">
                  <TableCell className="sm:min-w-56 max-sm:col-span-full max-sm:block">
                    <span className="mb-1 block text-xs text-default-secondary sm:hidden">Produk</span>
                    <Select
                      aria-label={`Produk baris ${i + 1}`}
                      size="small"
                      showSearch
                      placeholder="Pilih produk"
                      error={errors[`lines.${i}.productId`]}
                      options={productOptions}
                      value={l.productId || undefined}
                      onValueChange={(v) => set(i, { productId: v })}
                    />
                  </TableCell>
                  <TableCell className="max-sm:col-span-full max-sm:block">
                    <span className="mb-1 block text-xs text-default-secondary sm:hidden">Jumlah dihitung</span>
                    <TextField
                      aria-label={`Jumlah dihitung baris ${i + 1}`}
                      size="small"
                      inputMode="numeric"
                      required
                      error={errors[`lines.${i}.countedQty`]}
                      value={l.countedQty}
                      onChange={(e) => set(i, { countedQty: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="max-sm:block">
                    <span className="mb-1 block text-xs text-default-secondary sm:hidden">Alasan</span>
                    <TextField
                      aria-label={`Alasan baris ${i + 1}`}
                      size="small"
                      placeholder="Rusak, hilang, kedaluwarsa…"
                      error={errors[`lines.${i}.reason`]}
                      value={l.reason}
                      onChange={(e) => set(i, { reason: e.target.value })}
                      maxLength={200}
                    />
                  </TableCell>
                  <TableCell className="max-sm:block">
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
        </Card>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button width="auto" htmlType="submit" isLoading={busy}>
            Simpan sebagai draf
          </Button>
          <Button width="auto" asChild type="outline" color="light" disabled={busy}>
            <Link to="/stok-opname">Batal</Link>
          </Button>
        </div>
      </form>
    </Page>
  )
}
