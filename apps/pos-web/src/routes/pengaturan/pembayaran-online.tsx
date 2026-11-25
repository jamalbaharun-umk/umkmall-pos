import { Alert, Badge, Button, CheckBox, Select, Switch, TextField } from '@umkmall/ui/primitives'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '@/components/confirm'
import { Empty, Page, PageError, PageLoading, Panel, RequiredLabel, dateTime } from '@/components/page'
import { useCan } from '@/components/shell'
import { notifySuccess, showError } from '@/lib/feedback'
import {
  BUSINESS_TYPES,
  PERMISSION,
  canEditDraft,
  canSwitchMethods,
  describeOnlineError,
  draftErrors,
  draftOf,
  methodHint,
  methodLabel,
  modeLabel,
  providerLabel,
  safeHostedUrl,
  statusView,
  submitErrors,
  type DraftErrors,
  type DraftForm,
  type MerchantAccount,
} from '@/lib/online-payments'
import {
  loadOnlinePayments,
  saveOnlineDraft,
  setOnlineMethod,
  submitOnline,
  syncOnline,
  verificationLink,
  type OnlineFailure,
} from './-online-api'

export const Route = createFileRoute('/pengaturan/pembayaran-online')({
  loader: () => loadOnlinePayments(),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: OnlinePaymentsPage,
})

const CRUMBS = [{ label: 'Pengaturan', to: '/pengaturan' }, { label: 'Pembayaran Online' }]
const POLL_MS = 30_000

/** "Pembayaran Online" (UMK-2020, owner only): register the store at a payment gateway, then switch QRIS and VA on. */
function OnlinePaymentsPage() {
  const { enabled, mode, accounts } = Route.useLoaderData()
  const canManage = useCan(PERMISSION)
  const router = useRouter()
  const waiting = accounts.some((a) => a.status === 'submitted')

  // Status arrives by webhook and the server's own checks: while one is waiting, look again now and then.
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => void router.invalidate(), POLL_MS)
    return () => clearInterval(t)
  }, [waiting, router])

  if (!canManage)
    return (
      <Page title="Pembayaran Online" crumbs={CRUMBS}>
        <Panel>
          <Empty title="Hanya pemilik">
            Halaman ini memuat data usaha dan pencairan, jadi hanya pemilik toko yang bisa membukanya.
          </Empty>
        </Panel>
      </Page>
    )

  return (
    <Page title="Pembayaran Online" crumbs={CRUMBS}>
      {!enabled ? (
        <Panel>
          <Empty title="Pembayaran online belum tersedia">
            Layanan pembayaran belum dinyalakan di server ini. Hubungi bantuan UMKMall bila Anda ingin memakainya.
          </Empty>
        </Panel>
      ) : accounts.length === 0 ? (
        <Panel>
          <Empty title="Belum ada penyedia pembayaran">
            Belum ada penyedia yang bisa dipakai di lingkungan ini ({modeLabel(mode ?? '')}).
          </Empty>
        </Panel>
      ) : (
        accounts.map((a) => <AccountView key={a.provider} account={a} />)
      )}
    </Page>
  )
}

type Failed = OnlineFailure | undefined

/** Opens the gateway's page in a new tab. The tab is opened inside the click (a later one is blocked as a pop-up). */
async function openHosted(provider: string, onFail: (f: OnlineFailure) => void): Promise<boolean> {
  const tab = window.open('', '_blank')
  const res = await verificationLink({ data: provider }).catch(
    (): OnlineFailure => ({ ok: false, status: 0, error: 'Tidak bisa terhubung' }),
  )
  const url = res.ok ? safeHostedUrl(res.data.url) : null
  if (res.ok && url && tab) {
    tab.opener = null
    tab.location.href = url
    return true
  }
  tab?.close()
  onFail(res.ok ? { ok: false, status: tab ? 502 : 0, error: tab ? 'Alamat verifikasi tidak valid' : 'Tab baru diblokir peramban' } : res)
  return false
}

function AccountView({ account }: { account: MerchantAccount }) {
  const router = useRouter()
  const view = statusView(account.status)
  const [busy, setBusy] = useState<'sync' | 'link' | null>(null)
  const lock = useRef(false) // a double tap arrives before `busy` re-renders

  const fail = (f: unknown, action: string, retry?: () => void) =>
    showError(f, { action, retry, fallback: 'Aksi ini belum berhasil.' }, describeOnlineError)

  async function sync() {
    if (lock.current) return
    lock.current = true
    setBusy('sync')
    const res = await syncOnline({ data: account.provider }).catch((): OnlineFailure => ({ ok: false, status: 0, error: '' }))
    lock.current = false
    setBusy(null)
    if (!res.ok) return fail(res, 'memeriksa status', () => void sync())
    notifySuccess(`Status diperbarui: ${statusView(res.data.status).label}`)
    await router.invalidate()
  }

  async function hosted() {
    if (lock.current) return
    lock.current = true
    setBusy('link')
    let failed: Failed
    await openHosted(account.provider, (f) => (failed = f))
    lock.current = false
    setBusy(null)
    if (failed) fail(failed, 'membuka halaman verifikasi', () => void hosted())
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-3 p-4 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-default-primary">Status</h2>
          <Badge color={view.tone} size="small">
            {view.label}
          </Badge>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-default-secondary">Penyedia</dt>
          <dd className="text-right md:text-left">{providerLabel(account.provider)}</dd>
          <dt className="text-default-secondary">Mode</dt>
          <dd className="text-right md:text-left">
            <Badge color="light" size="small">
              {modeLabel(account.mode)}
            </Badge>
          </dd>
        </dl>
      </Panel>

      {account.status === 'not_submitted' && <DraftForm account={account} />}

      {account.status === 'submitted' && (
        <Panel className="flex flex-col gap-3 p-4 md:p-6">
          <Alert variant="warning">Menunggu verifikasi gateway. Data tidak bisa diubah sementara ini.</Alert>
          <p className="text-sm text-default-secondary">
            Langkah Anda: lengkapi identitas, dokumen usaha, dan rekening pencairan di halaman gateway.
            {account.profile.email ? ` Undangan juga dikirim ke ${account.profile.email}.` : ''}
          </p>
          <p className="text-xs text-default-secondary">
            Status diperbarui otomatis saat gateway menjawab.
            {account.lastSyncedAt ? ` Terakhir dicek ${dateTime(account.lastSyncedAt)}.` : ''}
          </p>
          <Actions>
            <Button type="outline" color="primary" size="medium" width="auto" isLoading={busy === 'sync'} disabled={busy !== null} onClick={() => void sync()}>
              Cek status
            </Button>
            <Button type="primary" color="primary" size="medium" width="auto" isLoading={busy === 'link'} disabled={busy !== null} onClick={() => void hosted()}>
              Lanjutkan verifikasi ↗
            </Button>
          </Actions>
        </Panel>
      )}

      {account.status === 'needs_fix' && (
        <Panel className="flex flex-col gap-3 p-4 md:p-6">
          <Alert variant="warning">
            <b>Alasan dari gateway:</b> {account.statusReason ?? 'Gateway meminta perbaikan data.'}
          </Alert>
          <p className="text-sm text-default-secondary">
            Perbaiki di halaman gateway, lalu kembali ke sini. Anda tidak perlu mengisi ulang data di POS.
          </p>
          <Actions>
            <Button type="outline" color="primary" size="medium" width="auto" isLoading={busy === 'sync'} disabled={busy !== null} onClick={() => void sync()}>
              Cek status
            </Button>
            <Button type="primary" color="primary" size="medium" width="auto" isLoading={busy === 'link'} disabled={busy !== null} onClick={() => void hosted()}>
              Perbaiki di gateway ↗
            </Button>
          </Actions>
        </Panel>
      )}

      {account.status === 'rejected' && (
        <Panel className="flex flex-col gap-3 p-4 md:p-6">
          <Alert variant="danger">
            <b>Alasan dari gateway:</b> {account.statusReason ?? 'Pengajuan tidak dapat diverifikasi.'}
          </Alert>
          <p className="text-sm text-default-secondary">
            Pengajuan ini tidak bisa diajukan ulang dari POS. Hubungi bantuan UMKMall dan sebutkan nama penyedia dan
            nama usaha Anda.
          </p>
        </Panel>
      )}

      {account.status === 'suspended' && (
        <Panel className="flex flex-col gap-3 p-4 md:p-6">
          <Alert variant="danger">
            <b>Alasan:</b> {account.statusReason ?? 'Akun dibekukan oleh gateway.'}
          </Alert>
          <p className="text-sm text-default-secondary">
            QRIS dan VA tidak muncul di kasir sampai penangguhan dicabut. Uang tunai, transfer, EDC, dan QRIS statis
            tetap bisa dipakai.
          </p>
          <Actions>
            <Button type="outline" color="primary" size="medium" width="auto" isLoading={busy === 'sync'} disabled={busy !== null} onClick={() => void sync()}>
              Cek status
            </Button>
          </Actions>
        </Panel>
      )}

      {account.status === 'verified' && <Alert variant="success">Verifikasi lolos. Nyalakan metode yang ingin dipakai di kasir.</Alert>}

      {(canSwitchMethods(account.status) || account.status === 'suspended') && <Methods account={account} />}
    </div>
  )
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2 md:flex-row md:justify-end">{children}</div>
}

function Methods({ account }: { account: MerchantAccount }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [busyMethod, setBusyMethod] = useState<string | null>(null)
  const unlocked = canSwitchMethods(account.status)

  async function change(method: string, enabled: boolean): Promise<OnlineFailure | void> {
    setBusyMethod(method)
    const res = await setOnlineMethod({ data: { provider: account.provider, method, enabled } }).catch(
      (): OnlineFailure => ({ ok: false, status: 0, error: '' }),
    )
    setBusyMethod(null)
    if (!res.ok) return res
    notifySuccess(enabled ? `${methodLabel(method)} menyala di kasir` : `${methodLabel(method)} dimatikan`)
    await router.invalidate()
  }

  function toggle(method: string, enabled: boolean) {
    if (enabled) {
      void change(method, true).then((f) => f && showError(f, { action: `menyalakan ${methodLabel(method)}`, retry: () => toggle(method, true) }, describeOnlineError))
      return
    }
    confirm.ask(
      `Matikan ${methodLabel(method)}?`,
      async () => {
        const f = await change(method, false)
        if (f) return { ...f, status: f.status || 0 }
      },
      {
        body: `Pembayaran ${methodLabel(method)} yang sedang menunggu tetap diselesaikan. Kasir tidak bisa memilih ${methodLabel(method)} untuk penjualan baru. Anda bisa menyalakannya lagi kapan saja.`,
        label: 'Matikan',
        action: `mematikan ${methodLabel(method)}`,
      },
    )
  }

  return (
    <Panel className="flex flex-col">
      <h2 className="border-b border-border-light p-4 font-semibold text-default-primary">Metode pembayaran</h2>
      {account.methods.length === 0 ? (
        <Empty title="Belum ada metode">Penyedia ini belum punya metode yang bisa dinyalakan.</Empty>
      ) : (
        <ul className="divide-y divide-border-light">
          {account.methods.map((m) => (
            <li key={m.method} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium text-default-primary">{methodLabel(m.method)}</p>
                <p className="text-sm text-default-secondary">{methodHint(m, account.status)}</p>
              </div>
              <Switch
                label={methodLabel(m.method)}
                checked={unlocked && m.enabled}
                disabled={!unlocked}
                loading={busyMethod === m.method}
                onCheckedChange={(on) => toggle(m.method, on)}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-border-light p-4 text-xs text-default-secondary">
        {account.status === 'verified'
          ? 'Status menjadi Aktif saat minimal satu metode menyala.'
          : 'Metode yang menyala muncul di kasir. Mematikan metode tidak membatalkan pembayaran yang sedang menunggu.'}
      </p>
      {confirm.dialog}
    </Panel>
  )
}

/** The short draft: four fields and the terms. KTP, business documents and bank account are filled on the gateway's page. */
function DraftForm({ account }: { account: MerchantAccount }) {
  const router = useRouter()
  const [form, setForm] = useState<DraftForm>(() => draftOf(account))
  const [errors, setErrors] = useState<DraftErrors>({})
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null)
  const lock = useRef(false)
  const editable = canEditDraft(account.status)

  const set = <K extends keyof DraftForm>(k: K, v: DraftForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  /** Server's per-field messages go under their inputs; returns true when it did. */
  function place(res: OnlineFailure): boolean {
    const map: Record<string, keyof DraftForm> = { businessType: 'businessType', businessName: 'businessName', email: 'email', phone: 'phone', termsAccepted: 'terms' }
    const placed: DraftErrors = {}
    for (const [path, message] of Object.entries(res.errors ?? {})) if (map[path]) placed[map[path]] = message
    setErrors(placed)
    return Object.keys(placed).length > 0
  }

  async function saveDraft(): Promise<OnlineFailure | undefined> {
    const res = await saveOnlineDraft({ data: { provider: account.provider, form } }).catch(
      (): OnlineFailure => ({ ok: false, status: 0, error: '' }),
    )
    return res.ok ? undefined : res
  }

  async function onSaveDraft() {
    if (lock.current) return
    const e = draftErrors(form)
    setErrors(e)
    if (Object.keys(e).length) return
    lock.current = true
    setBusy('draft')
    const failed = await saveDraft()
    lock.current = false
    setBusy(null)
    if (failed) {
      place(failed)
      return showError(failed, { action: 'menyimpan draf', retry: () => void onSaveDraft() }, describeOnlineError)
    }
    notifySuccess('Draf tersimpan')
    await router.invalidate()
  }

  async function onSubmit() {
    if (lock.current) return
    const e = submitErrors(form)
    setErrors(e)
    if (Object.keys(e).length) return
    lock.current = true
    setBusy('submit')
    // The draft first (it is what is submitted); if only the submit fails, the draft stays saved.
    const failed =
      (await saveDraft()) ??
      (await submitOnline({ data: account.provider })
        .then((r) => (r.ok ? undefined : r))
        .catch((): OnlineFailure => ({ ok: false, status: 0, error: '' })))
    lock.current = false
    setBusy(null)
    if (failed) {
      place(failed)
      return showError(failed, { action: 'mengajukan Pembayaran Online', retry: () => void onSubmit() }, describeOnlineError)
    }
    notifySuccess('Pengajuan terkirim. Lanjutkan verifikasi di halaman gateway')
    await router.invalidate()
  }

  return (
    <Panel className="flex flex-col gap-4 p-4 md:p-6">
      <Alert variant="info">
        Daftarkan toko agar pelanggan bisa membayar dengan QRIS dinamis dan VA. Tidak ada komisi UMKMall; toko hanya
        membayar biaya gateway.
      </Alert>
      <form
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault()
          void onSubmit()
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 md:max-w-3xl md:grid-cols-2">
          <Select
            label={<RequiredLabel>Jenis usaha</RequiredLabel>}
            options={BUSINESS_TYPES}
            value={form.businessType}
            onValueChange={(v) => set('businessType', v)}
            placeholder="Pilih jenis usaha"
            error={errors.businessType}
            disabled={!editable}
          />
          <TextField
            label="Nama usaha"
            value={form.businessName}
            onChange={(e) => set('businessName', e.target.value)}
            maxLength={120}
            required
            error={errors.businessName}
            disabled={!editable}
          />
          <TextField
            label="Email penanggung jawab"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            maxLength={254}
            required
            error={errors.email}
            disabled={!editable}
          />
          <TextField
            label="Nomor HP penanggung jawab"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            maxLength={24}
            required
            error={errors.phone}
            disabled={!editable}
          />
        </div>
        <CheckBox
          label="Saya setuju dengan syarat UMKMall"
          checked={form.terms}
          onChange={(e) => set('terms', e.target.checked)}
          error={errors.terms}
        />
        <p className="text-xs text-default-secondary">
          KTP, dokumen usaha, dan rekening diisi di halaman gateway di langkah berikutnya. POS tidak menerimanya.
          Isian bisa disimpan sebagai draf.
        </p>
        <Actions>
          <Button htmlType="button" type="outline" color="primary" size="medium" width="auto" isLoading={busy === 'draft'} disabled={busy !== null} onClick={() => void onSaveDraft()}>
            Simpan draf
          </Button>
          <Button htmlType="submit" type="primary" color="primary" size="medium" width="auto" isLoading={busy === 'submit'} disabled={busy !== null}>
            Ajukan
          </Button>
        </Actions>
      </form>
    </Panel>
  )
}
