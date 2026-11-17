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
import { useState, type FormEvent } from 'react'
import { Empty, ErrorText, LoadError, Page, Pending } from '@/components/pos-page'
import { createOpname, loadOpnameForm } from '../pembelian/-api'

// Lakasir's create stock opname plus its items (product, counted qty, reason) on one screen.
export const Route = createFileRoute('/stok-opname/baru')({
  loader: () => loadOpnameForm(),
  component: NewOpnamePage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

type Line = { productId: string; countedQty: string; reason: string }
const blank = (): Line => ({ productId: '', countedQty: '', reason: '' })

function NewOpnamePage() {
  const products = Route.useLoaderData()
  const navigate = useNavigate()
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([blank()])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

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

  const set = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const productOptions = products.map((p) => ({
    value: p.id,
    label: p.name,
    description: p.sku,
  }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = lines.map((l) => ({
      productId: l.productId,
      countedQty: /^\d+$/.test(l.countedQty.trim()) ? Number(l.countedQty.trim()) : NaN,
      reason: l.reason.trim() || null,
    }))
    if (parsed.some((l) => !l.productId || Number.isNaN(l.countedQty)))
      return setError('Lengkapi produk dan jumlah hitungan (bilangan bulat, boleh 0).')
    if (new Set(parsed.map((l) => l.productId)).size !== parsed.length) return setError('Satu produk cukup satu baris.')
    setBusy(true)
    const r = await createOpname({
      data: { note: note.trim() || null, lines: parsed },
    }).catch(() => ({
      ok: false as const,
      error: 'Gagal menyimpan, coba lagi.',
    }))
    setBusy(false)
    if (!r.ok) return setError(r.error)
    await navigate({ to: '/stok-opname/$id', params: { id: r.id! } })
  }

  return (
    <Page crumbs={[{ label: 'Stok opname', to: '/stok-opname' }, { label: 'Buat' }]} title="Stok opname baru">
      <Alert variant="info" treatment="accent">
        Stok sistem dicatat saat kamu menyimpan. Selisihnya baru diterapkan setelah opname disetujui.
      </Alert>
      <form onSubmit={submit} className="space-y-6">
        <Card variant="outlined" padding="large">
          <TextField
            label="Catatan"
            multiline
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
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
          <Table density="comfortable">
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead className="w-32">Jumlah dihitung</TableHead>
                <TableHead>Alasan</TableHead>
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
                      options={productOptions}
                      value={l.productId || undefined}
                      onValueChange={(v) => set(i, { productId: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      aria-label={`Jumlah dihitung baris ${i + 1}`}
                      size="small"
                      inputMode="numeric"
                      value={l.countedQty}
                      onChange={(e) => set(i, { countedQty: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      aria-label={`Alasan baris ${i + 1}`}
                      size="small"
                      placeholder="Rusak, hilang, kedaluwarsa…"
                      value={l.reason}
                      onChange={(e) => set(i, { reason: e.target.value })}
                      maxLength={200}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      iconOnly
                      aria-label={`Hapus baris ${i + 1}`}
                      size="small"
                      type="text"
                      color="danger"
                      disabled={lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
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
          <Button width="auto" asChild type="outline" color="light">
            <Link to="/stok-opname">Batal</Link>
          </Button>
        </div>
      </form>
    </Page>
  )
}
