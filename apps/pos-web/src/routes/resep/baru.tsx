import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { LoadError, Page, Pending } from '@/components/pos-page'
import { loadRecipeChoices } from './-api'
import { RecipeEditor } from './-editor'

// "Resep baru": the same form as "Ubah resep", with a product to pick first.
export const Route = createFileRoute('/resep/baru')({
  loader: () => loadRecipeChoices(),
  component: NewRecipePage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function NewRecipePage() {
  const choices = Route.useLoaderData()
  const navigate = useNavigate()
  return (
    <Page crumbs={[{ label: 'Resep', to: '/resep' }, { label: 'Baru' }]} title="Resep baru">
      <RecipeEditor
        choices={choices}
        onCancel={() => navigate({ to: '/resep' })}
        onSaved={(id) => navigate({ to: '/resep/$id', params: { id } })}
      />
    </Page>
  )
}
