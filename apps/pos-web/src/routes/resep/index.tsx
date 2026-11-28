import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Badge, BarChart, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TextField } from '@umkmall/ui'
import { useState } from 'react'
import { Empty, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { loadRecipes } from './-api'
import { FLAG_TEXT, flagsOf, type RecipeSummary } from './-recipe'

// UMK-2125, design 43: every recipe with its cost per portion, and the way to a new one.
export const Route = createFileRoute('/resep/')({
  loader: () => loadRecipes(),
  component: RecipesPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

const clip = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s)

function Flags({ r }: { r: RecipeSummary }) {
  const flags = flagsOf(r)
  if (!flags.length) return <span className="text-default-secondary">Lengkap</span>
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} color={f === 'deleted' ? 'danger' : 'warning'} size="small">
          {FLAG_TEXT[f]}
        </Badge>
      ))}
    </span>
  )
}

function RecipesPage() {
  const recipes = Route.useLoaderData()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const s = q.trim().toLowerCase()
  const shown = s ? recipes.filter((r) => r.product.name.toLowerCase().includes(s)) : recipes
  const open = (id: string) => navigate({ to: '/resep/$id', params: { id } })
  const newButton = (
    <Button width="auto" asChild>
      <Link to="/resep/baru">Resep baru</Link>
    </Button>
  )
  // Compared on one scale: the cost per portion against the "HPP lengkap" (labour included), costliest first.
  const top = [...recipes].sort((a, b) => b.fullCostPerPortion - a.fullCostPerPortion).slice(0, 8)

  return (
    <Page crumbs={[{ label: 'Resep', to: '/resep' }, { label: 'Daftar' }]} title="Resep" actions={newButton}>
      {recipes.length > 0 && (
        <BarChart
          boxed
          title="Biaya per porsi"
          description="Biaya bahan dan HPP lengkap (dengan upah) per porsi, resep termahal di atas."
          unit="rupiah"
          orientation="horizontal"
          categories={top.map((r) => clip(r.product.name))}
          series={[
            { label: 'Biaya bahan', values: top.map((r) => r.costPerPortion) },
            { label: 'HPP lengkap', values: top.map((r) => r.fullCostPerPortion) },
          ]}
        />
      )}
      <Card variant="outlined" padding="none">
        {recipes.length > 0 && (
          <div className="flex justify-end p-4">
            <div className="w-full sm:w-72">
              <TextField aria-label="Cari resep" type="search" size="small" placeholder="Cari nama produk…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        )}
        {shown.length === 0 ? (
          <Empty
            title={recipes.length === 0 ? 'Belum ada resep' : 'Resep tidak ditemukan'}
            hint={recipes.length === 0 ? 'Buat resep untuk tahu biaya satu porsi dari harga bahan terakhir.' : 'Coba kata lain.'}
            action={recipes.length === 0 ? newButton : undefined}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table density="comfortable">
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-right">Hasil</TableHead>
                    <TableHead className="text-right">Biaya per porsi</TableHead>
                    <TableHead className="text-right">HPP lengkap</TableHead>
                    <TableHead>Keadaan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => open(r.id)}>
                      <TableCell className="font-medium">
                        <Link to="/resep/$id" params={{ id: r.id }} className="hover:underline">
                          {r.product.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        {r.yieldQty} {r.yieldUnit}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{rupiah(r.costPerPortion)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{rupiah(r.fullCostPerPortion)}</TableCell>
                      <TableCell>
                        <Flags r={r} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-default-secondary md:hidden">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link to="/resep/$id" params={{ id: r.id }} className="flex flex-col gap-1 px-4 py-3">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-default-primary">{r.product.name}</span>
                      <span className="font-semibold whitespace-nowrap">{rupiah(r.costPerPortion)}</span>
                    </span>
                    <span className="text-sm text-default-secondary">
                      Hasil {r.yieldQty} {r.yieldUnit} · HPP lengkap {rupiah(r.fullCostPerPortion)}
                    </span>
                    <Flags r={r} />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </Page>
  )
}
