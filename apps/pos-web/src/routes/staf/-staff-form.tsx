import { useState } from 'react'
import type { Role, Staff } from './-api'
import { saveStaff } from './-api'
import { Button, ErrorText, Field, inputClass } from './-ui'

/** Create (no `member`) or edit a cashier. On edit the PIN is optional: empty keeps the current PIN. */
export function StaffForm({ member, roles, onSaved }: { member?: Staff; roles: Role[]; onSaved: () => void }) {
  const [name, setName] = useState(member?.name ?? '')
  const [pin, setPin] = useState('')
  const [roleIds, setRoleIds] = useState<string[]>(
    member?.roles.map((r) => r.id) ?? roles.filter((r) => r.name === 'Kasir').map((r) => r.id),
  )
  const [active, setActive] = useState(member?.active ?? true)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const pinOk = /^\d{4,8}$/.test(pin) || (member && pin === '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Nama wajib diisi.')
    if (!pinOk) return setError('PIN harus 4 sampai 8 angka.')
    setBusy(true)
    setError(undefined)
    const res = await saveStaff({
      data: { id: member?.id, name: name.trim(), pin: pin || undefined, roleIds, active },
    }).catch(() => ({ ok: false as const, error: 'Gagal menyimpan, coba lagi.' }))
    setBusy(false)
    if (!res.ok) return setError(res.error)
    if (!member) {
      setName('')
      setPin('')
    }
    onSaved()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nama">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </Field>
        <Field label={member ? 'PIN baru (kosongkan bila tetap)' : 'PIN (4–8 angka)'}>
          <input
            className={inputClass}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            inputMode="numeric"
            type="password"
            autoComplete="new-password"
          />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">Peran</legend>
        {roles.length === 0 ? (
          <p className="text-sm text-ink-muted">Belum ada peran.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-ink">
                <input
                  type="checkbox"
                  checked={roleIds.includes(r.id)}
                  onChange={(e) =>
                    setRoleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))
                  }
                />
                {r.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {member && (
        <label className="flex items-center gap-2 text-ink">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Aktif (bisa masuk dengan PIN)
        </label>
      )}
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy}>
        {busy ? 'Menyimpan…' : member ? 'Simpan perubahan' : 'Tambah staf'}
      </Button>
    </form>
  )
}
