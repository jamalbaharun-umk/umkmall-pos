import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { Role } from './-api'
import { deleteRole, PERMISSION_LABELS, loadRolesPage, saveRole } from './-api'
import { Button, Card, Empty, ErrorText, Field, inputClass, LoadError, Pending, StaffLayout } from './-ui'

export const Route = createFileRoute('/staf/peran')({
  loader: () => loadRolesPage(),
  component: RolesPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function RolesPage() {
  const { roles, permissions } = Route.useLoaderData()
  return (
    <StaffLayout title="Peran dan izin">
      {roles.length === 0 && (
        <Card>
          <Empty title="Belum ada peran" hint="Buat peran lalu pilih izinnya." />
        </Card>
      )}
      {roles.map((r) => (
        <Card key={r.id}>
          <RoleEditor role={r} permissions={permissions} />
        </Card>
      ))}
      <Card>
        <h2 className="mb-4 text-lg font-medium text-ink">Peran baru</h2>
        <RoleEditor permissions={permissions} />
      </Card>
    </StaffLayout>
  )
}

function RoleEditor({ role, permissions }: { role?: Role; permissions: string[] }) {
  const router = useRouter()
  const [name, setName] = useState(role?.name ?? '')
  const [granted, setGranted] = useState<string[]>(role?.permissions ?? [])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setError(undefined)
    setSaved(false)
    const res = await action().catch(() => ({ ok: false, error: 'Gagal menyimpan, coba lagi.' }))
    setBusy(false)
    if (!res.ok) return setError(res.error)
    if (!role) {
      setName('')
      setGranted([])
    } else setSaved(true)
    await router.invalidate()
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Nama peran wajib diisi.')
    void run(() => saveRole({ data: { id: role?.id, name: name.trim(), permissions: granted } }))
  }

  function remove() {
    if (role && window.confirm(`Hapus peran ${role.name}? Staf dengan peran ini kehilangan izinnya.`))
      void run(() => deleteRole({ data: role.id }))
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nama peran">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-ink">Izin</legend>
        {permissions.map((p) => (
          <label key={p} className="flex items-center gap-2 text-ink">
            <input
              type="checkbox"
              checked={granted.includes(p)}
              onChange={(e) => setGranted((g) => (e.target.checked ? [...g, p] : g.filter((x) => x !== p)))}
            />
            {PERMISSION_LABELS[p] ?? p}
          </label>
        ))}
      </fieldset>
      <ErrorText>{error}</ErrorText>
      {saved && <p className="text-sm text-success">Tersimpan.</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Menyimpan…' : role ? 'Simpan' : 'Buat peran'}
        </Button>
        {role && (
          <Button variant="danger" onClick={remove} disabled={busy}>
            Hapus
          </Button>
        )}
      </div>
    </form>
  )
}
