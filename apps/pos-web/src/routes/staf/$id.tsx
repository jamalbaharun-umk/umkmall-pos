import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { deleteStaff, loadMember } from './-api'
import { StaffForm } from './-staff-form'
import { Button, Card, ErrorText, LoadError, Pending, StaffLayout } from './-ui'

export const Route = createFileRoute('/staf/$id')({
  loader: ({ params }) => loadMember({ data: params.id }),
  component: MemberPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function MemberPage() {
  const { member, roles } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [error, setError] = useState<string>()

  async function remove() {
    if (!window.confirm(`Hapus ${member.name}? Sesi kasirnya juga berakhir.`)) return
    const res = await deleteStaff({ data: member.id }).catch(() => ({ ok: false as const, error: 'Gagal menghapus.' }))
    if (!res.ok) return setError(res.error)
    await navigate({ to: '/staf' })
  }

  return (
    <StaffLayout title={member.name}>
      <Card>
        <StaffForm key={member.id} member={member} roles={roles} onSaved={() => router.invalidate()} />
      </Card>
      <Card>
        <h2 className="text-lg font-medium text-ink">Hapus staf</h2>
        <p className="mt-1 text-sm text-ink-muted">Staf yang dihapus tidak bisa masuk lagi dan sesinya berakhir.</p>
        <ErrorText>{error}</ErrorText>
        <Button variant="danger" className="mt-3" onClick={remove}>
          Hapus
        </Button>
      </Card>
    </StaffLayout>
  )
}
