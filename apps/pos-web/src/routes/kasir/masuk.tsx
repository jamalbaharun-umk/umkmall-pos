import { Alert, Button, Spinner, toast } from '@umkmall/ui/primitives'
import { Card } from '@umkmall/ui/compositions'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Delete, UserRound } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { loadPicker, pinSignIn } from '../staf/-api'

// Cashier sign-in on a bound device (U4, POS-only): pick your name, enter your PIN. Full-screen, no shell.
export const Route = createFileRoute('/kasir/masuk')({
  loader: () => loadPicker(),
  component: CashierSignIn,
  pendingComponent: () => (
    <Screen>
      <Spinner label="Memuat" />
    </Screen>
  ),
  errorComponent: ({ error }) => (
    <Screen title="Daftar kasir belum bisa dimuat">
      <p className="text-sm text-default-secondary">
        {(error instanceof Error && error.message) || 'Coba muat ulang sebentar lagi.'}
      </p>
    </Screen>
  ),
})

function Screen({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-default-secondary px-4 py-8">
      <Card variant="outlined" padding="large" className="flex w-full max-w-md flex-col items-center gap-5 bg-default-primary text-center">
        {title && <h1 className="text-2xl font-bold text-default-primary">{title}</h1>}
        {children}
      </Card>
    </main>
  )
}

function CashierSignIn() {
  const picker = Route.useLoaderData()
  const [staffId, setStaffId] = useState<string>()

  if (!picker.bound)
    return (
      <Screen title="Perangkat belum terhubung">
        <p className="text-sm text-default-secondary">
          Minta pemilik toko membuka Pengguna → Perangkat di perangkat ini dan menekan Hubungkan.
        </p>
      </Screen>
    )
  if (picker.staff.length === 0)
    return (
      <Screen title="Belum ada kasir">
        <p className="text-sm text-default-secondary">Pemilik toko perlu menambahkan staf terlebih dahulu.</p>
      </Screen>
    )

  const chosen = picker.staff.find((s) => s.id === staffId)
  if (!chosen)
    return (
      <Screen title="Siapa yang berjaga?">
        <ul className="grid w-full grid-cols-2 gap-3">
          {picker.staff.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setStaffId(s.id)}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-border-light p-4 font-medium text-default-primary hover:border-default-brand hover:bg-weak-brand"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-weak-brand text-default-brand">
                  <UserRound className="size-5" aria-hidden />
                </span>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      </Screen>
    )
  return <PinPad staff={chosen} onBack={() => setStaffId(undefined)} />
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'hapus', '0', 'masuk'] as const

function PinPad({ staff, onBack }: { staff: { id: string; name: string }; onBack: () => void }) {
  const navigate = useNavigate()
  const router = useRouter()
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
    if (res.ok) {
      toast(`Selamat bertugas, ${staff.name}`, { variant: 'success' })
      await router.invalidate() // the shell's "who is signed in" is cached at the root
      return navigate({ to: '/kasir' })
    }
    setError(res.error)
    if (res.retryAfter) setLockedFor(res.retryAfter)
  }

  function press(k: (typeof KEYS)[number]) {
    if (k === 'hapus') return setPin((p) => p.slice(0, -1))
    if (k === 'masuk') return void submit()
    setPin((p) => (p.length < 8 ? p + k : p))
  }

  // A hardware keyboard works too: digits, Backspace, Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key as (typeof KEYS)[number])
      else if (e.key === 'Backspace') press('hapus')
      else if (e.key === 'Enter') press('masuk')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const message = lockedFor > 0 ? `Terlalu banyak PIN salah. Coba lagi dalam ${lockedFor} detik.` : error

  return (
    <Screen>
      <Button type="text" color="primary" size="small" width="auto" className="self-start" onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden /> Ganti kasir
      </Button>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-default-primary">Halo, {staff.name}</h1>
        <p className="text-sm text-default-secondary">Masukkan PIN kamu</p>
      </div>
      <div className="flex h-4 gap-2" role="status" aria-label={`${pin.length} angka dimasukkan`}>
        {Array.from({ length: Math.max(pin.length, 4) }, (_, i) => (
          <span key={i} className={`size-3 rounded-full ${i < pin.length ? 'bg-default-brand' : 'bg-weak-neutral'}`} />
        ))}
      </div>
      {message && (
        <Alert variant="danger" className="w-full text-left">
          {message}
        </Alert>
      )}
      <div className="grid w-full max-w-xs grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <Button
            key={k}
            type={k === 'masuk' ? 'primary' : 'outline'}
            color={k === 'masuk' ? 'primary' : 'light'}
            size="large"
            className="h-16 text-xl"
            aria-label={k === 'hapus' ? 'Hapus angka' : undefined}
            isLoading={k === 'masuk' && busy}
            disabled={busy || lockedFor > 0 || (k === 'masuk' && pin.length < 4)}
            onClick={() => press(k)}
          >
            {k === 'masuk' ? 'Masuk' : k === 'hapus' ? <Delete className="size-5" aria-hidden /> : k}
          </Button>
        ))}
      </div>
    </Screen>
  )
}
