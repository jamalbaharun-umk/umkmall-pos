import { createFileRoute, Link } from '@tanstack/react-router'
import { BarChart, Button, DonutChart, StatTile, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@umkmall/ui'
import { Panel } from '@/components/page'
import { LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { loadRun } from './-api'
import { costShares, dayText, differenceText, quantityText, signedText, type Run } from './-run'

// UMK-2132, design 45: one recorded run: the yield against the plan, the cost of one portion and what went in.
export const Route = createFileRoute('/produksi/$id')({
  loader: ({ params }) => loadRun({ data: params.id }),
  component: RunPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function RunPage() {
  const r = Route.useLoaderData()
  const shares = costShares(r.lines)
  const unit = r.yieldUnit
  return (
    <Page
      crumbs={[{ label: 'Produksi', to: '/produksi' }, { label: r.productName }]}
      title={r.productName}
      actions={
        <Button width="auto" type="outline" color="primary" asChild>
          <Link to="/produksi">Semua produksi</Link>
        </Button>
      }
    >
      <p className="text-sm text-default-secondary">
        {dayText(r.date)} · {r.batches.toLocaleString('id-ID')} batch
      </p>

      <section aria-label="Hasil" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Hasil sebenarnya" value={quantityText(r.actualYield, unit)} hint={`Rencana ${quantityText(r.plannedYield, unit)}`} />
        <StatTile label="Selisih" value={signedText(r.yieldDifference)} hint={differenceText(r.yieldDifference, unit)} />
        <StatTile label="Biaya per porsi" value={rupiah(r.costPerPortion)} hint="Dibulatkan ke atas" />
        <StatTile label="Biaya bahan" value={rupiah(r.ingredientCost)} hint={`Dibagi ${r.actualYield.toLocaleString('id-ID')} ${unit}`} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Panel>
          <h2 className="p-4 pb-2 font-semibold text-default-primary">Bahan yang keluar</h2>
          <Lines r={r} />
        </Panel>
        <div className="flex flex-col gap-4">
          <BarChart
            boxed
            title="Rencana dan hasil nyata"
            unit="count"
            categories={['Rencana', 'Hasil nyata']}
            series={[{ label: unit, values: [r.plannedYield, r.actualYield] }]}
          />
          <DonutChart
            boxed
            title="Komposisi biaya bahan"
            unit="rupiah"
            centerLabel="Biaya bahan"
            total={r.ingredientCost}
            parts={shares}
            state={shares.length === 0 ? 'empty' : 'ready'}
            emptyText="Belum ada biaya untuk digambar"
          />
          {r.note && (
            <Panel className="p-4">
              <p className="text-sm text-default-primary">Catatan: {r.note}</p>
            </Panel>
          )}
        </div>
      </div>
    </Page>
  )
}

function Lines({ r }: { r: Run }) {
  if (r.lines.length === 0) return <p className="px-4 pb-4 text-sm text-default-secondary">Produksi ini tidak memakai bahan dari stok.</p>
  return (
    <>
      <div className="hidden md:block">
        <Table density="comfortable">
          <TableHeader>
            <TableRow>
              <TableHead>Bahan</TableHead>
              <TableHead className="text-right">Dipakai</TableHead>
              <TableHead className="text-right">Biaya</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.lines.map((l) => (
              <TableRow key={l.ingredientId}>
                <TableCell className="font-medium">{l.name}</TableCell>
                <TableCell className="text-right whitespace-nowrap">{quantityText(l.quantity, l.unit)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">{rupiah(l.cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y divide-default-secondary md:hidden">
        {r.lines.map((l) => (
          <li key={l.ingredientId} className="flex flex-col gap-1 px-4 py-3">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-default-primary">{l.name}</span>
              <span className="font-semibold whitespace-nowrap">{rupiah(l.cost)}</span>
            </span>
            <span className="text-sm text-default-secondary">Dipakai {quantityText(l.quantity, l.unit)}</span>
          </li>
        ))}
      </ul>
    </>
  )
}
