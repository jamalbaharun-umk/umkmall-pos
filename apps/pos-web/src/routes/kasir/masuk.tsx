import { Alert, Button, Spinner } from '@umkmall/ui/primitives'
import { Card } from '@umkmall/ui/compositions'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Delete, UserRound } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { notifySuccess, showError } from '@/lib/feedback'
import { loadPicker, pinSignIn } from '../staf/-api'
import { PairingScreen } from './-pairing-screen'
import { pinKeyOf } from './-pin-keys'

// Cashier sign-in on a bound device (U4, POS-only): pick your name, enter your PIN. Full-screen, no shell.
export const Route = createFileRoute('/kasir/masuk')({
  // UMK-1969: `berakhir=1` is set when a cashier's session ended (the 401 redirect of api.server.ts).
  validateSearch: (s: Record<string, unknown>): { berakhir?: 1 } => (s.berakhir ? { berakhir: 1 } : {}),
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
  const ended = Route.useSearch().berakhir === 1
  return (
    <main className="flex min-h-svh items-center justify-center bg-default-secondary px-4 py-8">
      <Card variant="outlined" padding="large" className="flex w-full max-w-md flex-col items-center gap-5 bg-default-primary text-center">
        {ended && (
          <Alert variant="warning" size="small" className="w-full text-left">
            Sesi Anda berakhir. Demi keamanan, masuk lagi dengan PIN. Keranjang Anda tetap ada.
          </Alert>
        )}
        {title && <h1 className="text-2xl font-bold text-default-primary">{title}</h1>}
        {children}
        <a href="/" className="text-sm text-default-secondary hover:text-default-brand">
          Masuk sebagai pemilik toko
        </a>
      </Card>
    </main>
  )
}

function CashierSignIn() {
  const picker = Route.useLoaderData()
  const [staffId, setStaffId] = useState<string>()

  // A device with no store shows a pairing code (UMK-2022); the owner enters it on their own signed-in device.
  if (!picker.bound)
    return (
      <Screen>
        <PairingScreen />
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
      status: 0,
      code: undefined,
    }))
    setBusy(false)
    setPin('')
    if (res.ok) {
      notifySuccess(`Selamat bertugas, ${staff.name}`)
      await router.invalidate() // the shell's "who is signed in" is cached at the root
      return navigate({ to: '/kasir' })
    }
    setError(res.error)
    showError(res, 'masuk')
    if (res.retryAfter) setLockedFor(res.retryAfter)
  }

  function press(k: (typeof KEYS)[number]) {
    // The keypad buttons are disabled while busy or locked; the hardware keyboard must obey the same rule.
    if (busy || lockedFor > 0) return
    if (k === 'hapus') return setPin((p) => p.slice(0, -1))
    if (k === 'masuk') return void submit()
    setPin((p) => (p.length < 8 ? p + k : p))
  }

  // A hardware keyboard works too: digits, Backspace, Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = pinKeyOf({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, repeat: e.repeat, target: e.target as HTMLElement | null })
      if (k) press(k as (typeof KEYS)[number])
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
        <p className="text-sm text-default-secondary">Masukkan PIN Anda</p>
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
