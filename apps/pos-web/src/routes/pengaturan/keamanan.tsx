import { Alert, Badge, Button, Dialog, TextField } from '@umkmall/ui/primitives'
import { Link, createFileRoute, getRouteApi, useNavigate, useRouter } from '@tanstack/react-router'
import { useRef, useState, type FormEvent } from 'react'
import { useConfirm } from '@/components/confirm'
import { Empty, NoAccess, Page, PageError, PageLoading, Panel } from '@/components/page'
import { useCan, type Me } from '@/components/shell'
import { notifySuccess, showError } from '@/lib/feedback'
import { failureOf, pinDigits, pinSetErrors, lockText, type VoidFailure } from '../kasir/-void-helpers'
import { loadSecurity, replaceForgottenPin, resetPin, setPin, unlockPin } from './-keamanan-api'
import { freshSignInText, wrongOldPin, type FreshReason } from './-keamanan-helpers'
import { ActionRow } from '@/components/action-row'

export const Route = createFileRoute('/pengaturan/keamanan')({
  // `lupa`: the owner pressed "Lupa PIN", signed in again and landed here to make a new PIN (UMK-2054).
  validateSearch: (search): { lupa?: 1 } => (search.lupa ? { lupa: 1 } : {}),
  loader: () => loadSecurity(),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: SecurityPage,
})

const root = getRouteApi('__root__')

/**
 * Keamanan: each admin's own 6-digit void PIN (UMK-1962). An actor holding `sales.void` sets and changes their own;
 * the owner also sees who has one, unlocks a locked admin and removes an admin's forgotten PIN.
 *
 * The owner's own PIN (UMK-2054) is never changed by the session alone: the change form asks the old PIN, and
 * "Lupa PIN" (also the first PIN and the owner's own lock) sends the owner to sign in again with UMKMall
 * (`POST /masuk/ulang`), back to this page with `?lupa=1`, where a new PIN is made within 5 minutes.
 */
function SecurityPage() {
  const { status, approvers } = Route.useLoaderData()
  const { lupa } = Route.useSearch()
  const canSet = useCan('sales.void')
  const me = root.useLoaderData() as Me | null
  const isOwner = me?.actor.kind === 'owner'
  const [fresh, setFresh] = useState<FreshReason | null>(null)
  return (
    <Page title="Keamanan" crumbs={[{ label: 'Pengaturan', to: '/pengaturan' }, { label: 'Keamanan' }]}>
      {!canSet || !status ? (
        <NoAccess permission="Menyetujui pembatalan struk" />
      ) : (
        <div className="flex flex-col gap-6">
          {isOwner && lupa && me ? (
            <ForgotPinForm askSignIn={setFresh} />
          ) : (
            <PinForm status={status} isOwner={isOwner} askSignIn={setFresh} />
          )}
          {approvers && (
            <ApproverList approvers={approvers} selfId={me?.actor.id} isOwner={isOwner} askSignIn={setFresh} />
          )}
          {/* UMK-2121: the solo owner's menu hides Log aktivitas, so it stays one tap away here. */}
          {isOwner && (
            <Panel className="flex flex-col gap-1 p-6">
              <h2 className="text-base font-semibold">Log aktivitas</h2>
              <p className="text-sm text-default-secondary">
                Catatan masuk, pembatalan, perubahan harga dan PIN.{' '}
                <Link to="/pengaturan/log-aktivitas" className="font-semibold underline">
                  Lihat log aktivitas
                </Link>
              </p>
            </Panel>
          )}
        </div>
      )}
      <SignInAgainDialog reason={fresh} onClose={() => setFresh(null)} />
    </Page>
  )
}

/**
 * "Masuk lagi": a full-page POST to `/masuk/ulang`, which drops the POS session and sends the owner to UMKMall's
 * login; the sign-in that follows lands back here with `?lupa=1`.
 */
function SignInAgainDialog({ reason, onClose }: { reason: FreshReason | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  // The text stays while the dialog closes.
  const last = useRef<FreshReason>('forgot')
  if (reason) last.current = reason
  const text = freshSignInText(last.current)
  return (
    <Dialog open={reason !== null} onOpenChange={(open) => !open && !busy && onClose()} title={text.title} size="small" centered>
      <form method="post" action="/masuk/ulang" onSubmit={() => setBusy(true)} className="flex flex-col gap-4 px-6 pt-2 pb-6">
        <p className="text-sm text-default-secondary">{text.body}</p>
        <ActionRow>
          <Button type="outline" color="light" size="small" width="auto" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <Button htmlType="submit" type="primary" color="primary" size="small" width="auto" isLoading={busy}>
            Masuk lagi
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}

/** The owner after "Lupa PIN" and a new sign-in: a new PIN without the old one, within 5 minutes of signing in. */
function ForgotPinForm({ askSignIn }: { askSignIn: (reason: FreshReason) => void }) {
  const router = useRouter()
  const navigate = useNavigate({ from: '/pengaturan/keamanan' })
  const [pin, setPinText] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Partial<Record<'pin' | 'confirm', string>>>({})
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  const leave = () => navigate({ search: {}, replace: true })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (lock.current) return
    const bad = pinSetErrors({ pin, confirm, currentPin: '' }, false)
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    lock.current = true
    setBusy(true)
    const r = await replaceForgottenPin({ data: { pin } }).catch(() => null)
    setPinText('')
    setConfirm('')
    lock.current = false
    setBusy(false)
    if (!r) {
      showError({ status: 0 }, 'menyimpan PIN baru')
      return
    }
    if (r.ok) {
      notifySuccess('PIN baru disimpan')
      await router.invalidate()
      await leave()
      return
    }
    if (r.fresh) {
      askSignIn('expired')
      return
    }
    setErrors({ pin: r.failure.errors.pin })
    showError(failureOf(r.failure), 'menyimpan PIN baru')
    await router.invalidate()
  }

  return (
    <Panel className="p-6">
      <form noValidate onSubmit={submit} className="flex max-w-md flex-col gap-4">
        <h2 className="text-base font-semibold">Buat PIN baru</h2>
        <Alert variant="info" size="small">
          Anda sudah masuk lagi dengan akun UMKMall. Buat PIN baru dalam 5 menit sejak masuk. PIN lama dan kuncinya
          dihapus saat PIN baru disimpan.
        </Alert>
        <TextField
          label="PIN baru (6 angka)"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => {
            setPinText(pinDigits(e.target.value))
            setErrors((x) => ({ ...x, pin: undefined }))
          }}
          error={errors.pin}
        />
        <TextField
          label="Ulangi PIN baru"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={confirm}
          onChange={(e) => {
            setConfirm(pinDigits(e.target.value))
            setErrors((x) => ({ ...x, confirm: undefined }))
          }}
          error={errors.confirm}
        />
        <ActionRow>
          <Button type="outline" color="light" width="auto" disabled={busy} onClick={() => void leave()}>
            Batal
          </Button>
          <Button htmlType="submit" width="auto" isLoading={busy}>
            Simpan PIN baru
          </Button>
        </ActionRow>
      </form>
    </Panel>
  )
}

function PinForm({
  status,
  isOwner,
  askSignIn,
}: {
  status: { hasPin: boolean; lockedUntil: string | null }
  isOwner: boolean
  askSignIn: (reason: FreshReason) => void
}) {
  const router = useRouter()
  const [currentPin, setCurrentPin] = useState('')
  const [pin, setPinText] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Partial<Record<'currentPin' | 'pin' | 'confirm', string>>>({})
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const locked = lockText(status.lockedUntil)

  const clear = () => {
    setCurrentPin('')
    setPinText('')
    setConfirm('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (lock.current) return
    const bad = pinSetErrors({ pin, confirm, currentPin }, status.hasPin)
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    lock.current = true
    setBusy(true)
    const r = await setPin({ data: { pin, ...(status.hasPin ? { currentPin } : {}) } }).catch(() => null)
    clear() // the PIN fields are emptied after every submit, whatever the answer
    lock.current = false
    setBusy(false)
    if (!r) {
      showError({ status: 0 }, 'menyimpan PIN')
      return
    }
    if (r.ok) {
      notifySuccess(status.hasPin ? 'PIN diganti' : 'PIN dibuat')
      await router.invalidate()
      return
    }
    // The owner's first PIN has no old PIN to ask for: pos-api wants a sign-in of the last 5 minutes instead.
    if (r.fresh) {
      askSignIn('first')
      return
    }
    const f = r.failure
    const field = { currentPin: f.errors.currentPin, pin: f.errors.pin }
    setErrors(field)
    const oldPinWrong = f.kind === 'invalid' && f.errors.currentPin === 'PIN salah'
    showError(oldPinWrong ? wrongOldPin(isOwner) : failureOf(f), 'menyimpan PIN')
    if (f.kind === 'locked') await router.invalidate()
  }

  return (
    <Panel className="p-6">
      <form noValidate onSubmit={submit} className="flex max-w-md flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">PIN admin saya</h2>
          {locked ? (
            <Badge color="danger" size="small">
              {locked}
            </Badge>
          ) : (
            <Badge color={status.hasPin ? 'success' : 'warning'} size="small">
              {status.hasPin ? 'Aktif' : 'Belum diatur'}
            </Badge>
          )}
        </div>
        <p className="text-sm text-default-secondary">
          Dipakai untuk menyetujui pembatalan struk dan pengembalian uang. Tiap admin punya PIN sendiri, jadi riwayat
          menunjukkan siapa yang menyetujui. PIN disimpan terenkripsi di server dan tidak bisa dilihat lagi.
        </p>
        {status.hasPin && (
          <TextField
            label="PIN lama"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={currentPin}
            onChange={(e) => {
              setCurrentPin(pinDigits(e.target.value))
              setErrors((x) => ({ ...x, currentPin: undefined }))
            }}
            error={errors.currentPin}
          />
        )}
        {status.hasPin && !isOwner && (
          <p className="text-sm text-default-secondary">Lupa PIN lama? Minta pemilik menghapus PIN Anda, lalu buat PIN baru di sini.</p>
        )}
        <TextField
          label={status.hasPin ? 'PIN baru (6 angka)' : 'PIN (6 angka)'}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => {
            setPinText(pinDigits(e.target.value))
            setErrors((x) => ({ ...x, pin: undefined }))
          }}
          error={errors.pin}
        />
        <TextField
          label="Ulangi PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={confirm}
          onChange={(e) => {
            setConfirm(pinDigits(e.target.value))
            setErrors((x) => ({ ...x, confirm: undefined }))
          }}
          error={errors.confirm}
        />
        <Alert variant="info" size="small">
          Jangan pakai tanggal lahir atau angka berurutan. Jangan beritahu kasir. Salah 5 kali mengunci PIN 5 menit.
        </Alert>
        <ActionRow>
          {isOwner && (status.hasPin || locked) && (
            <Button type="text" color="primary" width="auto" disabled={busy} onClick={() => askSignIn('forgot')}>
              Lupa PIN?
            </Button>
          )}
          <Button htmlType="submit" width="auto" isLoading={busy}>
            {status.hasPin ? 'Ganti PIN' : 'Simpan PIN'}
          </Button>
        </ActionRow>
      </form>
    </Panel>
  )
}

type ApproverRow = { id: string; kind: 'owner' | 'cashier'; name: string; hasPin: boolean; lockedUntil: string | null }

function ApproverList({
  approvers,
  selfId,
  isOwner,
  askSignIn,
}: {
  approvers: ApproverRow[]
  selfId?: string
  isOwner: boolean
  askSignIn: (reason: FreshReason) => void
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [busyId, setBusyId] = useState<string>()

  const act = async (
    id: string,
    run: () => Promise<{ ok: boolean; failure?: VoidFailure; fresh?: true }>,
    done: string,
  ) => {
    setBusyId(id)
    const r = await run().catch(() => null)
    setBusyId(undefined)
    if (r?.ok) {
      notifySuccess(done)
      await router.invalidate()
      return undefined
    }
    // The owner's own lock is cleared only after a new sign-in (UMK-2054): offer it instead of an error.
    if (r?.fresh) {
      askSignIn('unlock')
      return undefined
    }
    return r?.failure ? failureOf(r.failure) : { status: 0 }
  }

  return (
    <Panel>
      <div className="border-b border-border-light p-4">
        <h2 className="text-base font-semibold">Admin yang bisa menyetujui</h2>
      </div>
      {approvers.length === 0 ? (
        <Empty title="Belum ada admin">Beri izin “Menyetujui pembatalan struk” ke sebuah peran di menu Peran.</Empty>
      ) : (
        <ul className="divide-y divide-border-light">
          {approvers.map((a) => {
            const locked = lockText(a.lockedUntil)
            return (
              <li key={`${a.kind}:${a.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="font-medium">
                  {a.kind === 'owner' ? 'Pemilik' : a.name}
                  {a.id === selfId && <span className="text-default-secondary"> (Anda)</span>}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {locked ? (
                    <Badge color="danger" size="small">
                      {locked}
                    </Badge>
                  ) : (
                    <Badge color={a.hasPin ? 'success' : 'light'} size="small">
                      {a.hasPin ? 'Aktif' : 'Belum ada PIN'}
                    </Badge>
                  )}
                  {isOwner && locked && (
                    <Button
                      type="outline"
                      color="light"
                      size="small"
                      width="auto"
                      disabled={busyId === a.id}
                      onClick={() =>
                        void act(a.id, () => unlockPin({ data: a.id }), 'Kunci dibuka').then(
                          (failed) => failed && showError(failed, 'membuka kunci PIN'),
                        )
                      }
                    >
                      Buka kunci
                    </Button>
                  )}
                  {isOwner && a.hasPin && a.id !== selfId && (
                    <Button
                      type="outline"
                      color="danger"
                      size="small"
                      width="auto"
                      disabled={busyId === a.id}
                      onClick={() =>
                        confirm.ask(
                          `Hapus PIN ${a.kind === 'owner' ? 'pemilik' : a.name}?`,
                          () => act(a.id, () => resetPin({ data: a.id }), 'PIN dihapus'),
                          {
                            label: 'Hapus PIN',
                            action: 'menghapus PIN',
                            body: 'Admin ini tidak bisa menyetujui pembatalan sampai membuat PIN baru.',
                          },
                        )
                      }
                    >
                      Hapus PIN
                    </Button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {confirm.dialog}
    </Panel>
  )
}
