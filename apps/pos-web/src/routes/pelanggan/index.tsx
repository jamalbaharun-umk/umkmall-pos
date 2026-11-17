import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { TextField } from '@umkmall/ui'
import { useState } from 'react'
import { listResource, type Member } from './-api'
import { LoadError, Pending, ResourcePage } from './-ui'

// Lakasir MemberResource: name, code, phone, address (email and identity fields dropped: minimised PII).
export const Route = createFileRoute('/pelanggan/')({
  validateSearch: (s: Record<string, unknown>) => ({ q: typeof s.q === 'string' && s.q ? s.q : undefined }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }) => (await listResource({ data: { resource: 'members', q: deps.q } })) as unknown as Member[],
  pendingComponent: Pending,
  errorComponent: LoadError,
  component: MembersPage,
})

function MembersPage() {
  const rows = Route.useLoaderData()
  const { q } = Route.useSearch()
  const navigate = useNavigate({ from: '/pelanggan/' })
  const [query, setQuery] = useState(q ?? '')
  return (
    <ResourcePage<Member>
      title="Pelanggan"
      crumbs={[{ label: 'Pelanggan' }, { label: 'Daftar' }]}
      singular="pelanggan"
      resource="members"
      cap={50}
      rows={rows}
      emptyHint={
        q ? 'Tidak ada pelanggan yang cocok.' : 'Tambahkan pelanggan untuk mencatat kasbon dan riwayat belanja.'
      }
      toolbar={
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void navigate({ search: { q: query.trim() || undefined } })
          }}
        >
          <TextField
            aria-label="Cari pelanggan"
            placeholder="Cari nama, kode atau telepon"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            size="small"
          />
        </form>
      }
      columns={[
        { label: 'Nama', cell: (m) => m.name },
        { label: 'Kode', cell: (m) => m.code },
        { label: 'Telepon', cell: (m) => m.phone ?? '–' },
        { label: 'Alamat', cell: (m) => m.address ?? '–' },
      ]}
      fields={[
        { name: 'name', label: 'Nama', max: 120 },
        { name: 'code', label: 'Kode', placeholder: 'Contoh: PLG001', max: 40, noSpaces: true },
        { name: 'phone', label: 'Telepon', type: 'phone', optional: true, placeholder: '0812-3456-7890' },
        { name: 'address', label: 'Alamat', optional: true, max: 500 },
      ]}
    />
  )
}
