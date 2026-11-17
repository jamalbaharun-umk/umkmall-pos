import { createFileRoute } from '@tanstack/react-router'
import { Page, PageError, PageLoading } from '@/components/page'
import { loadStaffPage } from './-api'
import { StaffForm } from './-staff-form'

export const Route = createFileRoute('/staf/baru')({
  loader: () => loadStaffPage(),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: () => (
    <Page title="Tambah staf" crumbs={[{ label: 'Staf', to: '/staf' }, { label: 'Tambah' }]}>
      <StaffForm roles={Route.useLoaderData().roles} />
    </Page>
  ),
})
