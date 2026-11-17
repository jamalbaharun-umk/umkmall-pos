import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { loadPicker, pinSignIn } from '../staf/-api'

// Cashier sign-in on a bound device: pick your name, enter your PIN.
export const Route = createFileRoute('/kasir/masuk')({
  loader: () => loadPicker(),
  component: CashierSignIn,
  pendingComponent: () => <Shell><p className="text-ink-muted">Memuat…</p></Shell>,
  errorComponent: ({ error }) => (
    <Shell>
      <h1 className="text-xl font-semibold text-ink">Daftar kasir belum bisa dimuat</h1>
      <p className="text-ink-muted">{(error instanceof Error && error.message) || 'Coba muat ulang sebentar lagi.'}</p>
    </Shell>
  ),
})

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      {children}
    </main>
  )
}

function CashierSignIn() {
  const picker = Route.useLoaderData()
  const [staffId, setStaffId] = useState<string>()

  if (!picker.bound)
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-ink">Perangkat belum terhubung</h1>
        <p className="text-ink-muted">
          Minta pemilik toko membuka Staf → Perangkat di perangkat ini dan menekan Hubungkan.
        </p>
      </Shell>
    )
  if (picker.staff.length === 0)
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-ink">Belum ada kasir</h1>
        <p className="text-ink-muted">Pemilik toko perlu menambahkan staf terlebih dahulu.</p>
      </Shell>
    )

  const chosen = picker.staff.find((s) => s.id === staffId)
  if (!chosen)
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-ink">Siapa yang berjaga?</h1>
        <ul className="grid w-full grid-cols-2 gap-3">
          {picker.staff.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setStaffId(s.id)}
                className="w-full rounded-xl bg-white p-4 font-medium text-ink shadow-sm hover:ring-2 hover:ring-brand"
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      </Shell>
    )
  return <PinPad staff={chosen} onBack={() => setStaffId(undefined)} />
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'hapus', '0', 'masuk'] as const

function PinPad({ staff, onBack }: { staff: { id: string; name: string }; onBack: () => void }) {
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [lockedFor, setLockedFor] = useState(0)

  useEffect(() => {
    if (lockedFor <= 0) return
    const t = setTimeout(() => setLockedFor((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [lockedFor])

  async function submit() {
    if (pin.length < 4 || busy || lockedFor > 0) return
    setBusy(true)
    setError(undefined)
    const res = await pinSignIn({ data: { staffId: staff.id, pin } }).catch(() => ({
      ok: false as const,
      error: 'Gagal masuk, coba lagi.',
      retryAfter: undefined,
    }))
    setBusy(false)
    setPin('')
    if (res.ok) return navigate({ to: '/' })
    setError(res.error)
    if (res.retryAfter) setLockedFor(res.retryAfter)
  }

  function press(k: (typeof KEYS)[number]) {
    if (k === 'hapus') return setPin((p) => p.slice(0, -1))
    if (k === 'masuk') return void submit()
    setPin((p) => (p.length < 8 ? p + k : p))
  }

  return (
    <Shell>
      <button type="button" onClick={onBack} className="self-start text-sm text-brand hover:underline">
        ← Ganti kasir
      </button>
      <h1 className="text-2xl font-semibold text-ink">Halo, {staff.name}</h1>
      <p className="text-ink-muted">Masukkan PIN kamu</p>
      <div className="flex h-6 gap-2" aria-label={`${pin.length} angka dimasukkan`}>
        {Array.from({ length: Math.max(pin.length, 4) }, (_, i) => (
          <span key={i} className={`size-3 rounded-full ${i < pin.length ? 'bg-brand' : 'bg-ink/15'}`} />
        ))}
      </div>
      <p role="alert" className="min-h-5 text-sm text-error">
        {lockedFor > 0 ? `Terlalu banyak PIN salah. Coba lagi dalam ${lockedFor} detik.` : error}
      </p>
      <div className="grid w-full max-w-xs grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            disabled={busy || lockedFor > 0 || (k === 'masuk' && pin.length < 4)}
            className={`h-16 rounded-xl text-xl font-medium shadow-sm disabled:opacity-40 ${
              k === 'masuk' ? 'bg-brand text-base text-white' : k === 'hapus' ? 'bg-white text-base text-ink-muted' : 'bg-white text-ink'
            }`}
          >
            {k === 'masuk' ? (busy ? '…' : 'Masuk') : k === 'hapus' ? 'Hapus' : k}
          </button>
        ))}
      </div>
    </Shell>
  )
}
