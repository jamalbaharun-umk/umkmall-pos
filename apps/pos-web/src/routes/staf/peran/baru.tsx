import { createFileRoute } from '@tanstack/react-router'
import { Page, PageError, PageLoading } from '@/components/page'
import { loadRolesPage } from '../-api'
import { RoleForm } from './-role-form'

export const Route = createFileRoute('/staf/peran/baru')({
  loader: () => loadRolesPage(),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: () => (
    <Page title="Tambah peran" crumbs={[{ label: 'Peran', to: '/staf/peran' }, { label: 'Tambah' }]}>
      <RoleForm permissions={Route.useLoaderData().permissions} />
    </Page>
  ),
})
