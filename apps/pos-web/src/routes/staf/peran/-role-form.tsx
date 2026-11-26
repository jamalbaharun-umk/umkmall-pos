import { Alert, Button, CheckBox, TextField } from '@umkmall/ui/primitives'
import { Link, useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { notifySuccess, showError } from '@/lib/feedback'
import { Panel } from '@/components/page'
import { GENERIC_ERROR, placeErrors } from '@/lib/refusal'
import { required } from '@/lib/validate'
import { PERMISSION_LABELS, saveRole, type Role } from '../-api'
import { ActionRow } from '@/components/action-row'

/** Lakasir's role form: a name, then the permissions as a searchable checkbox grid with select/deselect all. */
export function RoleForm({ role, permissions }: { role?: Role; permissions: string[] }) {
  const navigate = useNavigate()
  const [name, setName] = useState(role?.name ?? '')
  const [granted, setGranted] = useState<string[]>(role?.permissions ?? [])
  const [q, setQ] = useState('')
  const [error, setError] = useState<string>()
  const [nameError, setNameError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const label = (p: string) => PERMISSION_LABELS[p] ?? p
  const shown = permissions.filter((p) => label(p).toLowerCase().includes(q.trim().toLowerCase()))
  const all = shown.length > 0 && shown.every((p) => granted.includes(p))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(undefined)
    const missing = required(name, 'Nama peran wajib diisi')
    setNameError(missing)
    const verb = role ? 'menyimpan peran' : 'membuat peran'
    if (missing) return showError({ status: 422, error: 'Beberapa isian belum benar. Periksa yang ditandai merah.' }, verb)
    setBusy(true)
    const res = await saveRole({ data: { id: role?.id, name: name.trim(), permissions: granted } }).catch(() => ({
      ok: false as const,
      error: GENERIC_ERROR,
      status: 0,
    }))
    setBusy(false)
    if (!res.ok) {
      const placed = placeErrors(res, ['name'])
      setNameError(placed.byField.name)
      setError(placed.formError)
      return showError(res, verb)
    }
    notifySuccess(role ? 'Peran disimpan' : 'Peran dibuat')
    await navigate({ to: '/staf/peran' })
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
      <Panel className="flex flex-col gap-5 p-6">
        <TextField
          label="Nama"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setNameError(undefined)
          }}
          maxLength={60}
          required
          error={nameError}
        />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium text-default-primary">Izin</legend>
          <TextField
            aria-label="Cari izin"
            size="xsmall"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ketik untuk mencari izin…"
            leadingAdornment={<Search className="size-4 text-default-secondary" aria-hidden />}
          />
          <button
            type="button"
            className="self-start text-sm font-semibold text-default-brand hover:underline"
            onClick={() =>
              setGranted((g) => (all ? g.filter((p) => !shown.includes(p)) : [...new Set([...g, ...shown])]))
            }
          >
            {all ? 'Batal pilih semua' : 'Pilih semua'}
          </button>
          {shown.length === 0 ? (
            <p className="text-sm text-default-secondary">Izin tidak ditemukan.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((p) => (
                <CheckBox
                  key={p}
                  label={label(p)}
                  checked={granted.includes(p)}
                  onChange={(e) => setGranted((g) => (e.target.checked ? [...g, p] : g.filter((x) => x !== p)))}
                />
              ))}
            </div>
          )}
        </fieldset>
      </Panel>
      {error && <Alert variant="danger">{error}</Alert>}
      <ActionRow>
        <Button asChild type="outline" color="light" size="small" width="auto">
          <Link to="/staf/peran">Batal</Link>
        </Button>
        <Button htmlType="submit" type="primary" color="primary" size="small" width="auto" isLoading={busy}>
          {role ? 'Simpan perubahan' : 'Simpan'}
        </Button>
      </ActionRow>
    </form>
  )
}
