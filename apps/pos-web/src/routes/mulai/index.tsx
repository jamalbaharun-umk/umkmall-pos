import { SelectionCard } from '@umkmall/ui/primitives'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { FileSpreadsheet, LayoutTemplate, Calculator } from 'lucide-react'
import { NoAccess, Page, Panel } from '@/components/page'
import { useCan } from '@/components/shell'

export const Route = createFileRoute('/mulai/')({
  component: StartScreen,
})

/** Engineer A's recipe screen (UMK-2126) when it is built; until then "Mulai dari HPP" opens a new product. */
const RECIPE_ROUTE = '/resep'

/**
 * UMK-2128 "Usaha Anda apa?" (design 44, screen 1): the first screen of a store without products. Three ways to
 * start, one tap each: a business template, HPP (a recipe), or moving data from another app (CSV).
 */
function StartScreen() {
  const canEdit = useCan('catalog.manage')
  const navigate = useNavigate()
  const router = useRouter()
  const hasRecipes = Boolean((router.routesByPath as unknown as Record<string, unknown>)[RECIPE_ROUTE])

  function go(value: string) {
    if (value === 'template') void navigate({ to: '/mulai/template' })
    else if (value === 'csv') void navigate({ to: '/catalog/products/impor' })
    else if (hasRecipes) void navigate({ to: RECIPE_ROUTE as '/' })
    else void navigate({ to: '/catalog/products/baru' })
  }

  return (
    <Page title="Usaha Anda apa?" crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Mulai' }]}>
      {!canEdit ? (
        <NoAccess permission="Mengelola katalog" />
      ) : (
        <Panel className="flex flex-col gap-4 p-4 md:p-6">
          <p className="text-default-secondary">Pilih cara mulai. Semua bisa diubah nanti.</p>
          <SelectionCard
            aria-label="Pilih cara mulai"
            activation
            options={[
              {
                value: 'template',
                label: 'Mulai dari template',
                description: 'Kategori, satuan, dan contoh produk siap pakai.',
                icon: <LayoutTemplate className="size-6" aria-hidden />,
              },
              {
                value: 'hpp',
                label: 'Mulai dari HPP',
                description: hasRecipes ? 'Satu resep atau impor HPP dari UMKMall.' : 'Tambah produk dengan harga modal dan harga jual.',
                icon: <Calculator className="size-6" aria-hidden />,
              },
              {
                value: 'csv',
                label: 'Pindahkan data',
                description: 'Dari Excel, Moka, atau Majoo (CSV).',
                icon: <FileSpreadsheet className="size-6" aria-hidden />,
              },
            ]}
            onValueChange={(v) => v[0] && go(v[0])}
          />
        </Panel>
      )}
    </Page>
  )
}
