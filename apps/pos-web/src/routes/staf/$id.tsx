import { Button } from '@umkmall/ui/primitives'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { notifySuccess } from '@/lib/feedback'
import { useConfirm } from '@/components/confirm'
import { Page, PageError, PageLoading } from '@/components/page'
import { deleteStaff, loadMember } from './-api'
import { StaffForm } from './-staff-form'

export const Route = createFileRoute('/staf/$id')({
  loader: ({ params }) => loadMember({ data: params.id }),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: EditStaff,
})

/** Lakasir's Edit User: the form, with Delete as the page action. */
function EditStaff() {
  const { member, roles } = Route.useLoaderData()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const remove = () =>
    confirm.ask(
      `Hapus ${member.name}?`,
      async () => {
        const r = await deleteStaff({ data: member.id })
        if (!r.ok) return r
        notifySuccess('Staf dihapus')
        await navigate({ to: '/staf' })
      },
      { body: 'Staf yang dihapus tidak bisa masuk lagi dan sesi kasirnya berakhir.', action: 'menghapus staf' },
    )
  return (
    <Page
      title={`Ubah ${member.name}`}
      crumbs={[{ label: 'Staf', to: '/staf' }, { label: member.name }, { label: 'Ubah' }]}
      actions={
        <Button type="primary" color="danger" size="small" width="auto" onClick={remove}>
          Hapus
        </Button>
      }
    >
      <StaffForm key={member.id} member={member} roles={roles} />
      {confirm.dialog}
    </Page>
  )
}
