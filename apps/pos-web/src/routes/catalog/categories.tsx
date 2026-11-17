import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { deleteCategory, listCategories, saveCategory, type Category } from './-api'
import { Alert, Card, Empty, ErrorState, Loading, danger, input, primary, secondary } from './-ui'

export const Route = createFileRoute('/catalog/categories')({
  loader: () => listCategories(),
  pendingComponent: Loading,
  errorComponent: ErrorState,
  component: CategoriesPage,
})

function CategoriesPage() {
  const categories = Route.useLoaderData()
  const router = useRouter()
  const [editing, setEditing] = useState<Category | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  function edit(c: Category | null) {
    setEditing(c)
    setName(c?.name ?? '')
    setError(undefined)
  }

  async function run(action: () => Promise<{ error?: string }>) {
    setBusy(true)
    setError(undefined)
    try {
      const res = await action()
      if (res.error) return setError(res.error)
      edit(null)
      await router.invalidate()
    } catch {
      setError('Terjadi kesalahan. Coba lagi sebentar lagi.')
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void run(() => saveCategory({ data: { id: editing?.id, name } }))
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-ink">
            {editing ? `Ubah kategori “${editing.name}”` : 'Kategori baru'}
            <input
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Minuman"
              maxLength={120}
              required
            />
          </label>
          <div className="flex gap-2">
            {editing && (
              <button type="button" className={secondary} onClick={() => edit(null)} disabled={busy}>
                Batal
              </button>
            )}
            <button type="submit" className={primary} disabled={busy || !name.trim()}>
              {busy ? 'Menyimpan…' : editing ? 'Simpan' : 'Tambah'}
            </button>
          </div>
        </form>
        {error && (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        )}
      </Card>

      <Card>
        {categories.length === 0 ? (
          <Empty title="Belum ada kategori">Tambahkan kategori pertama, misalnya “Minuman” atau “Makanan”.</Empty>
        ) : (
          <ul className="divide-y divide-ink/10">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                <span className="text-sm font-medium text-ink">{c.name}</span>
                <span className="flex gap-4">
                  <button type="button" className="text-sm font-medium text-brand hover:underline" onClick={() => edit(c)}>
                    Ubah
                  </button>
                  <button
                    type="button"
                    className={danger}
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Hapus kategori “${c.name}”?`)) void run(() => deleteCategory({ data: c.id }))
                    }}
                  >
                    Hapus
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
