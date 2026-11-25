import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Badge,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@umkmall/ui'
import { Empty, formatDate, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { loadShift } from '../-shift-api'
import { directionLabel, drawerRows, entryKindLabel, signedAmount } from '../-shift-helpers'

// One shift: the drawer arithmetic and the append-only ledger of cash in and out behind it.
export const Route = createFileRoute('/kasir/shift/$id')({
  loader: ({ params }) => loadShift({ data: params.id }),
  component: ShiftPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function ShiftPage() {
  const shift = Route.useLoaderData()
  const closed = shift.closedAt !== null
  const diff = shift.difference ?? 0
  return (
    <Page
      title={`Shift ${formatDate(shift.openedAt)}`}
      crumbs={[
        { label: 'Kasir', to: '/kasir' },
        { label: 'Riwayat shift', to: '/kasir/shift' },
        { label: 'Detail' },
      ]}
      actions={
        <Button asChild type="outline" color="light" width="auto">
          <Link to="/kasir/shift">Kembali</Link>
        </Button>
      }
    >
      <Card variant="outlined" padding="large" className="space-y-6">
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Text as="h2" variant="h5" weight="bold">
              Uang di laci
            </Text>
            {closed ? <Badge color="light">Ditutup {formatDate(shift.closedAt!)}</Badge> : <Badge color="success">Masih buka</Badge>}
          </div>
          <dl className="max-w-md space-y-1 text-sm">
            {drawerRows(shift).map((r) => (
              <div
                key={r.key}
                className={`flex justify-between ${r.strong ? 'pt-1 text-base font-bold' : 'text-default-secondary'}`}
              >
                <dt>{r.label}</dt>
                <dd>
                  {r.sign}
                  {rupiah(r.amount)}
                </dd>
              </div>
            ))}
            {closed && (
              <>
                <div className="flex justify-between text-default-secondary">
                  <dt>Dihitung</dt>
                  <dd>{rupiah(shift.countedCash ?? 0)}</dd>
                </div>
                <div
                  className={`flex justify-between pt-1 text-base font-bold ${diff === 0 ? 'text-default-success' : 'text-default-error'}`}
                >
                  <dt>{diff === 0 ? 'Pas' : diff < 0 ? 'Kurang' : 'Lebih'}</dt>
                  <dd>{rupiah(Math.abs(diff))}</dd>
                </div>
              </>
            )}
          </dl>
        </section>

        <section className="space-y-2">
          <Text as="h2" variant="h5" weight="bold">
            Kas masuk dan keluar
          </Text>
          {shift.cashEntries.length === 0 ? (
            <Empty title="Belum ada kas masuk atau keluar" hint="Kasbon tunai, pengeluaran dari laci, dan uang kembali karena struk dibatalkan tercatat di sini." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Alasan</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Catatan</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shift.cashEntries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{formatDate(e.createdAt)}</TableCell>
                    <TableCell>{entryKindLabel(e.kind)}</TableCell>
                    <TableCell>
                      <Badge color={e.direction === 'in' ? 'success' : 'warning'}>{directionLabel(e.direction)}</Badge>
                    </TableCell>
                    <TableCell>{e.note ?? '–'}</TableCell>
                    <TableCell className="text-right">{signedAmount(e, rupiah)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </Card>
    </Page>
  )
}
