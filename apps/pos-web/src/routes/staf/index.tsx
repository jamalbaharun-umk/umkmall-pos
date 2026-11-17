import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { loadStaffPage } from './-api'
import { StaffForm } from './-staff-form'
import { Card, Empty, LoadError, Pending, StaffLayout } from './-ui'

export const Route = createFileRoute('/staf/')({
  loader: () => loadStaffPage(),
  component: StaffPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function StaffPage() {
  const { staff, roles } = Route.useLoaderData()
  const router = useRouter()
  return (
    <StaffLayout title="Staf">
      <Card>
        {staff.length === 0 ? (
          <Empty title="Belum ada staf" hint="Tambahkan kasir pertama di bawah. Kasir masuk dengan PIN." />
        ) : (
          <ul className="divide-y divide-ink/10">
            {staff.map((s) => (
              <li key={s.id}>
                <Link
                  to="/staf/$id"
                  params={{ id: s.id }}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-brand-soft/60"
                >
                  <span>
                    <span className="font-medium text-ink">{s.name}</span>
                    <span className="block text-sm text-ink-muted">
                      {s.roles.map((r) => r.name).join(', ') || 'Tanpa peran'}
                    </span>
                  </span>
                  <span className={`text-sm ${s.active ? 'text-success' : 'text-ink-muted'}`}>
                    {s.active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-4 text-lg font-medium text-ink">Tambah staf</h2>
        <StaffForm roles={roles} onSaved={() => router.invalidate()} />
      </Card>
    </StaffLayout>
  )
}
