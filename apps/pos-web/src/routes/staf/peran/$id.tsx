import { Button } from '@umkmall/ui/primitives'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { notifySuccess } from '@/lib/feedback'
import { useConfirm } from '@/components/confirm'
import { Page, PageError, PageLoading } from '@/components/page'
import { deleteRole, loadRole } from '../-api'
import { RoleForm } from './-role-form'

export const Route = createFileRoute('/staf/peran/$id')({
  loader: ({ params }) => loadRole({ data: params.id }),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: EditRole,
})

/** Lakasir's Edit Role: the form, Delete as the page action. */
function EditRole() {
  const { role, permissions } = Route.useLoaderData()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const remove = () =>
    confirm.ask(
      `Hapus peran ${role.name}?`,
      async () => {
        const r = await deleteRole({ data: role.id })
        if (!r.ok) return r
        notifySuccess('Peran dihapus')
        await navigate({ to: '/staf/peran' })
      },
      { body: 'Staf dengan peran ini kehilangan izinnya.', action: 'menghapus peran' },
    )
  return (
    <Page
      title="Ubah peran"
      crumbs={[{ label: 'Peran', to: '/staf/peran' }, { label: role.name }, { label: 'Ubah' }]}
      actions={
        <Button type="primary" color="danger" size="small" width="auto" onClick={remove}>
          Hapus
        </Button>
      }
    >
      <RoleForm key={role.id} role={role} permissions={permissions} />
      {confirm.dialog}
    </Page>
  )
}
