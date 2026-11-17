import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { TextField } from '@umkmall/ui'
import { useState } from 'react'
import { loadMembers, type Member } from './-api'
import { LoadError, Pending, ResourcePage } from './-ui'

// Lakasir MemberResource: name, code, phone, address (email and identity fields dropped: minimised PII).
export const Route = createFileRoute('/pelanggan/')({
  validateSearch: (s: Record<string, unknown>): { q?: string; page?: number } => ({
    // The router JSON-parses search values, so ?q=0812… arrives as a number.
    q: s.q == null || s.q === '' ? undefined : String(s.q),
    page: Number(s.page) >= 1 ? Math.floor(Number(s.page)) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadMembers({ data: deps }),
  pendingComponent: Pending,
  errorComponent: LoadError,
  component: MembersPage,
})

function MembersPage() {
  const list = Route.useLoaderData()
  const { q } = Route.useSearch()
  const navigate = useNavigate({ from: '/pelanggan/' })
  const [query, setQuery] = useState(q ?? '')
  return (
    <ResourcePage<Member>
      title="Pelanggan"
      crumbs={[{ label: 'Pelanggan' }, { label: 'Daftar' }]}
      singular="pelanggan"
      resource="members"
      rows={list.data}
      paging={{
        page: list.page,
        perPage: list.perPage,
        total: list.total,
        onPage: (n) => void navigate({ search: (s) => ({ ...s, page: n > 1 ? n : undefined }) }),
      }}
      emptyHint={
        q ? 'Tidak ada pelanggan yang cocok.' : 'Tambahkan pelanggan untuk mencatat kasbon dan riwayat belanja.'
      }
      toolbar={
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void navigate({ search: { q: query.trim() || undefined, page: undefined } })
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
