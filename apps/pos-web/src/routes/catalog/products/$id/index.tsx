import { Badge, Button, Menu, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from '@umkmall/ui/primitives'
import { Card, Tabs, TabsContent, TabsList, TabsTrigger } from '@umkmall/ui/compositions'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { EllipsisVertical, Pencil, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useConfirm } from '@/components/confirm'
import { useCan } from '@/components/shell'
import { Empty, Page, PageError, PageLoading, Panel, dateTime, rupiah } from '@/components/page'
import { deleteProduct, getProductDetail } from '../../-api'
import { TYPE_LABEL } from '../-form'

export const Route = createFileRoute('/catalog/products/$id/')({
  loader: ({ params }) => getProductDetail({ data: params.id }),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: ViewProduct,
})

const REASON: Record<string, string> = {
  opening: 'Stok awal',
  sale: 'Penjualan',
  sale_void: 'Penjualan dibatalkan',
  purchase: 'Pembelian',
  opname: 'Stok opname',
}
const SOURCE: Record<string, string> = { opening: 'Stok awal', purchase: 'Pembelian', adjustment: 'Penyesuaian' }

/** Lakasir's product view: status + actions, stat cards, the detail grid, then history tabs. */
function ViewProduct() {
  const { product, stock, movements } = Route.useLoaderData()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const canEdit = useCan('catalog.manage')

  const remove = () =>
    confirm.ask(`Hapus ${product.name}?`, async () => {
      const r = await deleteProduct({ data: product.id })
      if (r.error) return r.error
      toast('Produk dihapus', { variant: 'success' })
      await navigate({ to: '/catalog/products' })
    }, { body: 'Produk tidak tampil lagi di kasir. Riwayat penjualannya tetap tersimpan.' })

  return (
    <Page
      title={product.name}
      crumbs={[{ label: 'Produk', to: '/catalog/products' }, { label: product.name }, { label: 'Lihat' }]}
      actions={
        <>
          <Badge color={product.isActive ? 'success' : 'light'} size="small">
            {product.isActive ? 'Aktif' : 'Nonaktif'}
          </Badge>
          {canEdit && (
            <>
              <Button asChild type="primary" color="primary" size="small" width="auto">
                <Link to="/catalog/products/$id/ubah" params={{ id: product.id }}>
                  <Pencil className="size-4" aria-hidden /> Ubah
                </Link>
              </Button>
              <Menu
                label="Aksi lain"
                align="end"
                trigger={
                  <Button type="outline" color="light" size="small" iconOnly aria-label="Aksi lain">
                    <EllipsisVertical className="size-4" aria-hidden />
                  </Button>
                }
                items={[{ id: 'hapus', label: 'Hapus', danger: true, icon: <Trash2 className="size-4" />, onSelect: remove }]}
              />
            </>
          )}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Stok">
          {stock.tracked ? (
            <>
              {stock.onHand} <span className="text-base font-medium">{product.unit}</span>
            </>
          ) : (
            <span className="text-base font-medium text-default-secondary">Tidak memakai stok</span>
          )}
        </Stat>
        <Stat label="Harga jual">{rupiah(product.sellingPrice)}</Stat>
        {product.costPrice !== undefined && (
          <>
            <Stat label="Harga modal">{rupiah(product.costPrice)}</Stat>
            <Stat label="Laba per item">{rupiah(product.sellingPrice - product.costPrice)}</Stat>
          </>
        )}
      </div>

      <Panel className="grid gap-x-8 gap-y-5 p-6 md:grid-cols-2">
        <Detail label="Gambar" wide>
          {product.images?.length ? (
            <ul className="flex flex-wrap gap-3">
              {product.images.map((img) => (
                <li key={img.id}>
                  <img
                    src={`/catalog/products/${product.id}/gambar/${img.id}`}
                    alt={product.name}
                    className="size-24 rounded-lg border border-border-light object-cover"
                  />
                </li>
              ))}
            </ul>
          ) : (
            '–'
          )}
        </Detail>
        <Detail label="Nama">{product.name}</Detail>
        <Detail label="Kategori">{product.category.name}</Detail>
        <Detail label="SKU">{product.sku}</Detail>
        <Detail label="Barcode">{product.barcodes.join(', ') || '–'}</Detail>
        <Detail label="Jenis">{TYPE_LABEL[product.type]}</Detail>
        <Detail label="Satuan">{product.unit}</Detail>
        <Detail label="Satuan lain">
          {product.units.length
            ? product.units.map((u) => `${u.name}: isi ${u.unitQty}, ${rupiah(u.price)}`).join('; ')
            : '–'}
        </Detail>
        <Detail label="Harga grosir">
          {product.priceTiers.length
            ? product.priceTiers.map((t) => `mulai ${t.minQty} ${product.unit}: ${rupiah(t.price)}`).join('; ')
            : '–'}
        </Detail>
      </Panel>

      <Tabs defaultValue="riwayat">
        <TabsList label="Riwayat produk">
          <TabsTrigger value="riwayat">Riwayat stok</TabsTrigger>
          <TabsTrigger value="batch">Batch stok</TabsTrigger>
        </TabsList>
        <TabsContent value="riwayat">
          <Panel className="mt-4">
            {movements.length === 0 ? (
              <Empty title="Belum ada perubahan stok">Stok berubah lewat stok awal, pembelian, penjualan atau opname.</Empty>
            ) : (
              <Table density="comfortable" className="whitespace-nowrap">
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Keterangan</TableHead>
                    <TableHead className="text-right">Perubahan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{dateTime(m.createdAt)}</TableCell>
                      <TableCell>{REASON[m.reason] ?? m.reason}</TableCell>
                      <TableCell className={`text-right tabular-nums ${m.delta < 0 ? 'text-default-error' : 'text-default-success'}`}>
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="batch">
          <Panel className="mt-4">
            {stock.batches.length === 0 ? (
              <Empty title="Tidak ada batch berisi stok" />
            ) : (
              <Table density="comfortable" className="whitespace-nowrap">
                <TableHeader>
                  <TableRow>
                    <TableHead>Diterima</TableHead>
                    <TableHead>Asal</TableHead>
                    <TableHead className="text-right">Sisa / awal</TableHead>
                    <TableHead className="text-right">Modal per item</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stock.batches.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{dateTime(b.receivedAt)}</TableCell>
                      <TableCell>{SOURCE[b.source] ?? b.source}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.qtyRemaining} / {b.qtyInitial}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(b.unitCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
      {confirm.dialog}
    </Page>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card variant="outlined" padding="medium" className="bg-default-primary">
      <p className="text-sm text-default-secondary">{label}</p>
      <p className="mt-2 text-2xl font-bold text-default-primary tabular-nums">{children}</p>
    </Card>
  )
}

function Detail({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'md:col-span-2' : undefined}>
      <p className="text-sm font-medium text-default-primary">{label}</p>
      <div className="mt-1 text-sm text-default-secondary">{children}</div>
    </div>
  )
}
