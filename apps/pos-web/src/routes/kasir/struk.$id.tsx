import { createFileRoute, Link } from '@tanstack/react-router'
import { LoadError, Pending } from '../staf/-ui'
import { loadReceipt, rupiah } from './-api'
import { CashierHeader } from './-ui'

// Printable receipt (Lakasir's browser printer): the browser's print dialog, sized for 58/80 mm paper.
export const Route = createFileRoute('/kasir/struk/$id')({
  loader: ({ params }) => loadReceipt({ data: params.id }),
  component: ReceiptPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function ReceiptPage() {
  const r = Route.useLoaderData()
  return (
    <main className="mx-auto min-h-svh max-w-6xl px-4 py-6 print:p-0">
      <CashierHeader title="Struk" />
      <div className="mt-6 flex flex-col items-center gap-4 print:mt-0 print:block">
        <article className="w-full max-w-[320px] rounded-xl bg-white p-4 font-mono text-sm text-black shadow-sm print:max-w-none print:rounded-none print:p-0 print:shadow-none">
          <p className="text-center font-semibold">STRUK PENJUALAN</p>
          <p className="mt-2 flex justify-between"><span>No. {r.number}</span><span>{new Date(r.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</span></p>
          <p>Kasir: {r.cashier}</p>
          <hr className="my-2 border-dashed border-black/40" />
          <ul className="space-y-1">
            {r.lines.map((l, i) => (
              <li key={i}>
                <p>{l.name}</p>
                <p className="flex justify-between"><span>{l.qty} × {rupiah(l.unitPrice)}</span><span>{rupiah(l.lineTotal)}</span></p>
              </li>
            ))}
          </ul>
          <hr className="my-2 border-dashed border-black/40" />
          <Line label="Subtotal" value={r.subtotal} />
          {r.discount > 0 && <Line label="Diskon" value={-r.discount} />}
          {r.tax > 0 && <Line label={`Pajak ${r.taxBps / 100}%`} value={r.tax} />}
          <p className="flex justify-between font-semibold"><span>Total</span><span>{rupiah(r.total)}</span></p>
          <Line label={r.paymentMethod} value={r.paid} />
          <Line label="Kembalian" value={r.change} />
          <hr className="my-2 border-dashed border-black/40" />
          <p className="text-center">Terima kasih</p>
        </article>
        <div className="flex gap-2 print:hidden">
          <button type="button" onClick={() => window.print()} className="rounded-lg bg-brand px-4 py-3 font-medium text-white hover:bg-brand-strong">Cetak struk</button>
          <Link to="/kasir" className="rounded-lg bg-brand-soft px-4 py-3 font-medium text-brand">Transaksi baru</Link>
        </div>
      </div>
    </main>
  )
}

function Line({ label, value }: { label: string; value: number }) {
  return <p className="flex justify-between"><span>{label}</span><span>{rupiah(value)}</span></p>
}
