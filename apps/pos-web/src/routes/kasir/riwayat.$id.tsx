import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Alert, Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Text } from '@umkmall/ui'
import { useState } from 'react'
import { formatDate, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { useCan } from '@/components/shell'
import { WhatsappReceiptDialog } from '@/components/whatsapp-dialogs'
import { loadSaleDetail } from './-void-api'
import { RefundPanel } from './-refund-panel'
import { VoidDialog } from './-void-dialog'
import { reasonLabel } from './-void-helpers'
import { paidLater } from './-online'
import { soldPriceNote } from './-helpers'
import { approvedByLabel, receiptDiscounts, soldDiscountLabel } from './-discount'
import { hasRounding } from './-money'

// Lakasir's "View selling": selling details, product table, totals, and the print-receipt action.
export const Route = createFileRoute('/kasir/riwayat/$id')({
  loader: ({ params }) => loadSaleDetail({ data: params.id }),
  component: SalePage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function SalePage() {
  const { receipt: r, saleVoid, methodKind, online, paidAt } = Route.useLoaderData()
  const { id } = Route.useParams()
  const router = useRouter()
  const canStart = useCan('sales.create')
  const [voiding, setVoiding] = useState(false)
  const [sharing, setSharing] = useState(false)
  const voided = r.status === 'void'
  return (
    <Page
      crumbs={[{ label: 'Riwayat penjualan', to: '/kasir/riwayat' }, { label: 'Detail' }]}
      title={`Penjualan #${r.number}`}
      actions={
        <>
          {r.status === 'completed' && canStart && (
            <Button width="auto" type="outline" color="danger" onClick={() => setVoiding(true)}>
              {online ? 'Refund struk' : 'Batalkan transaksi'}
            </Button>
          )}
          <Button width="auto" asChild type="outline" color="light">
            <Link to="/kasir/riwayat">Kembali</Link>
          </Button>
          {r.status === 'completed' && (
            <Button width="auto" type="outline" color="light" onClick={() => setSharing(true)}>
              Kirim struk WhatsApp
            </Button>
          )}
          <Button width="auto" asChild>
            <Link to="/kasir/struk/$id" params={{ id }}>
              Cetak struk
            </Link>
          </Button>
        </>
      }
    >
      {online && r.status === 'completed' && (
        <Alert variant="info" size="small" className="mb-4">
          Pembayaran lewat gateway dikembalikan dengan refund penuh. Butuh PIN admin dan alasan, sama seperti void.
        </Alert>
      )}
      {voided && (
        <Card variant="outlined" padding="large" className="mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <Text as="h2" variant="h5" weight="bold">
              Struk dibatalkan
            </Text>
            <Badge color="danger" size="small">
              VOID
            </Badge>
          </div>
          {saleVoid ? (
            <>
              <dl className="grid max-w-md grid-cols-2 gap-y-1 text-sm">
                <dt className="font-medium">Waktu</dt>
                <dd className="text-right">{formatDate(saleVoid.createdAt)}</dd>
                <dt className="font-medium">Dimulai oleh</dt>
                <dd className="text-right">{saleVoid.initiatedBy.name}</dd>
                <dt className="font-medium">Disetujui oleh</dt>
                <dd className="text-right">{saleVoid.approvedBy.name}</dd>
                <dt className="font-medium">Alasan</dt>
                <dd className="text-right">{reasonLabel(saleVoid.reasonCode)}</dd>
                {saleVoid.note && (
                  <>
                    <dt className="font-medium">Catatan</dt>
                    <dd className="text-right">{saleVoid.note}</dd>
                  </>
                )}
                {saleVoid.cashReturned > 0 && (
                  <>
                    <dt className="font-medium">Uang keluar dari laci</dt>
                    <dd className="text-right">{rupiah(saleVoid.cashReturned)}</dd>
                  </>
                )}
                {saleVoid.transferReturned > 0 && (
                  <>
                    <dt className="font-medium">Dikembalikan lewat transfer</dt>
                    <dd className="text-right">{rupiah(saleVoid.transferReturned)}</dd>
                  </>
                )}
                {saleVoid.receivableCancelled > 0 && (
                  <>
                    <dt className="font-medium">Sisa kasbon dihapus</dt>
                    <dd className="text-right">{rupiah(saleVoid.receivableCancelled)}</dd>
                  </>
                )}
              </dl>
              {saleVoid.refundStatus ? (
                <RefundPanel saleVoid={saleVoid} onChanged={() => void router.invalidate()} />
              ) : (
                saleVoid.transferReturned > 0 && (
                <Alert variant="info" size="small">
                  Uang {rupiah(saleVoid.transferReturned)} dikembalikan lewat transfer balik. Pastikan transfernya sudah
                  dilakukan; sistem hanya mencatat.
                </Alert>
                )
              )}
            </>
          ) : (
            <p className="text-sm text-default-secondary">
              Dibatalkan {r.voidedAt ? formatDate(r.voidedAt) : ''}. Rincian pembatalan hanya terlihat oleh kasir
              yang menjual, yang memulai atau menyetujui, dan pengguna dengan izin laporan.
            </p>
          )}
        </Card>
      )}
      <Card variant="outlined" padding="large" className="space-y-6">
        <section>
          <Text as="h2" variant="h5" weight="bold">
            Rincian penjualan
          </Text>
          <dl className="mt-3 grid max-w-md grid-cols-2 gap-y-1 text-sm">
            <dt className="font-medium">Kode</dt>
            <dd className="text-right">#{r.number}</dd>
            <dt className="font-medium">Kasir</dt>
            <dd className="text-right">{r.cashier}</dd>
            <dt className="font-medium">{paidAt ? 'Tanggal bayar' : 'Tanggal'}</dt>
            <dd className="text-right">{formatDate(paidAt ?? r.createdAt)}</dd>
            {paidLater(r.createdAt, paidAt) && (
              <>
                <dt className="font-medium">Dibuat</dt>
                <dd className="text-right">{formatDate(r.createdAt)}</dd>
              </>
            )}
            {r.memberName && (
              <>
                <dt className="font-medium">Pelanggan</dt>
                <dd className="text-right">{r.memberName}</dd>
              </>
            )}
            {r.receivableRest !== null && (
              <>
                <dt className="font-medium">Sisa kasbon</dt>
                <dd className="text-right">{rupiah(r.receivableRest)}</dd>
              </>
            )}
            <dt className="font-medium">Metode pembayaran</dt>
            <dd className="text-right">{r.paymentMethod}</dd>
            {r.note && (
              <>
                <dt className="font-medium">Catatan</dt>
                <dd className="text-right">{r.note}</dd>
              </>
            )}
          </dl>
        </section>
        <Table density="comfortable">
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead className="text-right">Harga per satuan</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
              <TableHead className="text-right">Total harga</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell>
                  {l.name}
                  {soldPriceNote(l) && (
                    <span className="block text-xs text-default-secondary">{soldPriceNote(l)}</span>
                  )}
                  {soldDiscountLabel(l) && (
                    <span className="block text-xs text-default-secondary">
                      {soldDiscountLabel(l)} −{rupiah(l.discount ?? 0)}
                    </span>
                  )}
                  {approvedByLabel(l.approvedBy) && (
                    <span className="block text-xs text-default-secondary">{approvedByLabel(l.approvedBy)}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">{rupiah(l.unitPrice)}</TableCell>
                <TableCell className="text-right">
                  {l.qty} {l.unit}
                </TableCell>
                <TableCell className="text-right">
                  {(l.discount ?? 0) > 0 ? (
                    <>
                      <s className="block text-xs text-default-secondary">{rupiah(l.lineTotal)}</s>
                      {rupiah(l.lineTotal - (l.discount ?? 0))}
                    </>
                  ) : (
                    rupiah(l.lineTotal)
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <dl className="ml-auto grid max-w-sm grid-cols-2 gap-y-2 text-sm">
          <dt className="font-medium">Subtotal</dt>
          <dd className="text-right">{rupiah(r.subtotal)}</dd>
          {receiptDiscounts(r).lines > 0 && (
            <>
              <dt className="font-medium">Diskon baris</dt>
              <dd className="text-right">−{rupiah(receiptDiscounts(r).lines)}</dd>
            </>
          )}
          {(receiptDiscounts(r).order > 0 || receiptDiscounts(r).lines === 0) && (
            <>
              <dt className="font-medium">Diskon</dt>
              <dd className="text-right">{rupiah(receiptDiscounts(r).order)}</dd>
            </>
          )}
          {approvedByLabel(r.discountApprovedBy) && (
            <dd className="col-span-2 text-right text-xs text-default-secondary">
              {approvedByLabel(r.discountApprovedBy)}
            </dd>
          )}
          {r.voucherDiscount > 0 && (
            <>
              <dt className="font-medium">Diskon voucher</dt>
              <dd className="text-right">−{rupiah(r.voucherDiscount)}</dd>
            </>
          )}
          <dt className="font-medium">Pajak</dt>
          <dd className="text-right">{r.taxBps / 100}%</dd>
          <dt className="font-medium">Nilai pajak</dt>
          <dd className="text-right">{rupiah(r.tax)}</dd>
          <dt className="font-bold">Total</dt>
          <dd className="text-right font-bold">{rupiah(r.total)}</dd>
          {hasRounding(r) && (
            <>
              <dt className="font-medium">Pembulatan</dt>
              <dd className="text-right">{rupiah(r.rounding)}</dd>
              <dt className="font-bold">Harus dibayar</dt>
              <dd className="text-right font-bold">{rupiah(r.amountDue)}</dd>
            </>
          )}
          <dt className="font-medium">Uang dibayar</dt>
          <dd className="text-right">{rupiah(r.paid)}</dd>
          <dt className="font-medium">Kembalian</dt>
          <dd className="text-right">{rupiah(r.change)}</dd>
        </dl>
      </Card>
      <VoidDialog
        open={voiding}
        onClose={() => setVoiding(false)}
        onChanged={() => void router.invalidate()}
        sale={{ id, number: r.number, amountDue: r.amountDue }}
        methodKind={methodKind}
        online={online}
      />
      {sharing && <WhatsappReceiptDialog saleId={id} onClose={() => setSharing(false)} />}
    </Page>
  )
}
