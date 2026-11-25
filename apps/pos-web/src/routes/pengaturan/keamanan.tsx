import { Alert, Badge, Button, TextField } from '@umkmall/ui/primitives'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { useRef, useState, type FormEvent } from 'react'
import { useConfirm } from '@/components/confirm'
import { Empty, NoAccess, Page, PageError, PageLoading, Panel } from '@/components/page'
import { useCan, type Me } from '@/components/shell'
import { notifySuccess, showError } from '@/lib/feedback'
import { failureOf, pinDigits, pinSetErrors, lockText, type VoidFailure } from '../kasir/-void-helpers'
import { loadSecurity, resetPin, setPin, unlockPin } from './-keamanan-api'

export const Route = createFileRoute('/pengaturan/keamanan')({
  loader: () => loadSecurity(),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: SecurityPage,
})

const root = getRouteApi('__root__')

/**
 * Keamanan: each admin's own 6-digit void PIN (UMK-1962). An actor holding `sales.void` sets and changes their own;
 * the owner also sees who has one, unlocks a locked admin and removes a forgotten PIN.
 */
function SecurityPage() {
  const { status, approvers } = Route.useLoaderData()
  const canSet = useCan('sales.void')
  const me = root.useLoaderData() as Me | null
  const isOwner = me?.actor.kind === 'owner'
  return (
    <Page title="Keamanan" crumbs={[{ label: 'Pengaturan', to: '/pengaturan' }, { label: 'Keamanan' }]}>
      {!canSet || !status ? (
        <NoAccess permission="Menyetujui pembatalan struk" />
      ) : (
        <div className="flex flex-col gap-6">
          <PinForm status={status} />
          {approvers && <ApproverList approvers={approvers} selfId={me?.actor.id} isOwner={isOwner} />}
        </div>
      )}
    </Page>
  )
}

function PinForm({ status }: { status: { hasPin: boolean; lockedUntil: string | null } }) {
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
    const f = r.failure
    const field = { currentPin: f.errors.currentPin, pin: f.errors.pin }
    setErrors(field)
    showError(failureOf(f), 'menyimpan PIN')
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
        <div className="flex justify-end">
          <Button htmlType="submit" width="auto" isLoading={busy}>
            Simpan PIN
          </Button>
        </div>
      </form>
    </Panel>
  )
}

type ApproverRow = { id: string; kind: 'owner' | 'cashier'; name: string; hasPin: boolean; lockedUntil: string | null }

function ApproverList({ approvers, selfId, isOwner }: { approvers: ApproverRow[]; selfId?: string; isOwner: boolean }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [busyId, setBusyId] = useState<string>()

  const act = async (id: string, run: () => Promise<{ ok: boolean; failure?: VoidFailure }>, done: string) => {
    setBusyId(id)
    const r = await run().catch(() => null)
    setBusyId(undefined)
    if (r?.ok) {
      notifySuccess(done)
      await router.invalidate()
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
                  {a.id === selfId && <span className="text-default-secondary"> (kamu)</span>}
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
