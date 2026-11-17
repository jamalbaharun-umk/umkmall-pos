import { Alert, Button, CheckBox, Select, TextField, toast } from '@umkmall/ui/primitives'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { Panel } from '@/components/page'
import { saveStaff, type Role, type Staff } from './-api'

/**
 * Lakasir's user form, for POS staff: a cashier signs in with a PIN on a bound device (U4), so name, PIN (+ confirm)
 * and roles replace Lakasir's email/password/phone/address. On edit an empty PIN keeps the current one.
 */
export function StaffForm({ member, roles }: { member?: Staff; roles: Role[] }) {
  const navigate = useNavigate()
  const defaults = roles.filter((r) => r.name === 'Kasir').map((r) => r.id)
  const [name, setName] = useState(member?.name ?? '')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [roleIds, setRoleIds] = useState<string[]>(member?.roles.map((r) => r.id) ?? defaults)
  const [active, setActive] = useState(member?.active ?? true)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent, again = false) {
    e.preventDefault()
    setError(undefined)
    if (!name.trim()) return setError('Nama wajib diisi.')
    if (!(/^\d{4,8}$/.test(pin) || (member && pin === ''))) return setError('PIN harus 4 sampai 8 angka.')
    if (pin !== pin2) return setError('Konfirmasi PIN tidak sama.')
    setBusy(true)
    const res = await saveStaff({
      data: { id: member?.id, name: name.trim(), pin: pin || undefined, roleIds, active },
    }).catch(() => ({ ok: false as const, error: 'Gagal menyimpan, coba lagi.' }))
    setBusy(false)
    if (!res.ok) return setError(res.error)
    toast(member ? 'Staf tersimpan' : 'Staf ditambahkan', { variant: 'success' })
    if (again) {
      setName('')
      setPin('')
      setPin2('')
      setRoleIds(defaults)
    } else await navigate({ to: '/staf' })
  }

  const digits = (s: string) => s.replace(/\D/g, '').slice(0, 8)

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
      <Panel className="grid gap-5 p-6 md:grid-cols-2">
        <div className="md:col-span-2">
          <TextField label="Nama" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </div>
        <TextField
          label={member ? 'PIN baru' : 'PIN'}
          type="password"
          showReveal
          inputMode="numeric"
          autoComplete="new-password"
          placeholder={member ? 'Kosongkan bila tetap' : '4–8 angka'}
          value={pin}
          onChange={(e) => setPin(digits(e.target.value))}
          required={!member}
        />
        <TextField
          label="Konfirmasi PIN"
          type="password"
          showReveal
          inputMode="numeric"
          autoComplete="new-password"
          value={pin2}
          onChange={(e) => setPin2(digits(e.target.value))}
          required={!member}
        />
        <Select
          label="Peran"
          multiple
          options={roles.map((r) => ({ value: r.id, label: r.name }))}
          value={roleIds}
          onValueChange={setRoleIds}
          placeholder="Tanpa peran"
          emptyMessage="Belum ada peran"
        />
        {member && (
          <div className="flex items-end pb-3">
            <CheckBox
              label="Aktif (bisa masuk dengan PIN)"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
          </div>
        )}
      </Panel>
      {error && <Alert variant="danger">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button htmlType="submit" type="primary" color="primary" size="small" width="auto" isLoading={busy}>
          {member ? 'Simpan perubahan' : 'Simpan'}
        </Button>
        {!member && (
          <Button
            type="outline"
            color="light"
            size="small"
            width="auto"
            disabled={busy}
            onClick={(e) => void submit(e as unknown as FormEvent, true)}
          >
            Simpan & buat lagi
          </Button>
        )}
        <Button asChild type="outline" color="light" size="small" width="auto">
          <Link to="/staf">Batal</Link>
        </Button>
      </div>
    </form>
  )
}
