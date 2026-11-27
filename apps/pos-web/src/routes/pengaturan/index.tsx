import { Alert, Button, Select, TextField, Upload } from '@umkmall/ui/primitives'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@umkmall/ui/compositions'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { SCROLL_TABS } from '@/lib/scroll-row'
import { notifySuccess, showError } from '@/lib/feedback'
import { ActionRow } from '@/components/action-row'
import { useConfirm } from '@/components/confirm'
import { NoAccess, Page, PageError, PageLoading, Panel, RequiredLabel } from '@/components/page'
import { useCan, useIsOwner } from '@/components/shell'
import { DailyTargetForm } from '../ringkasan/-target-form'
import { SetupBoard } from '../ringkasan/-panels'
import { appSettingsPayload } from './-app-settings'
import { GENERIC_ERROR, placeErrors } from '@/lib/refusal'
import { IMAGE_ERROR, splitImages, storeProfileErrors, taxToBps, type Errors } from '@/lib/validate'
import {
  BUSINESS_TYPES,
  deleteLogo,
  deleteQris,
  loadSettings,
  saveAppSettings,
  saveProfile,
  uploadLogo,
  uploadQris,
  type Profile,
} from './-api'

export const Route = createFileRoute('/pengaturan/')({
  loader: () => loadSettings(),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: SettingsPage,
})

const TIMEZONES = [
  { value: 'Asia/Jakarta', label: 'WIB (Asia/Jakarta)' },
  { value: 'Asia/Makassar', label: 'WITA (Asia/Makassar)' },
  { value: 'Asia/Jayapura', label: 'WIT (Asia/Jayapura)' },
]

/** Lakasir's General Setting: Profile (shop name, business type, address, logo), App (tax, timezone), About. */
function SettingsPage() {
  const { profile, taxBps, timezone } = Route.useLoaderData()
  const canEdit = useCan('catalog.manage')
  // The daily target is set by the owner (owner ruling); an admin with catalog.manage does not see the form.
  const owner = useIsOwner()
  // "Kelengkapan toko" reads the store's steps again after a form on this page saves.
  const [setupRound, setSetupRound] = useState(0)
  const onSaved = () => setSetupRound((n) => n + 1)
  return (
    <Page title="Pengaturan" crumbs={[{ label: 'Pengaturan' }]}>
      {canEdit && <SetupBoard refresh={setupRound} />}
      {!canEdit ? (
        <NoAccess permission="Mengelola katalog" />
      ) : (
        <Tabs defaultValue="profil">
          <TabsList label="Pengaturan" className={SCROLL_TABS}>
            <TabsTrigger value="profil">Profil toko</TabsTrigger>
            <TabsTrigger value="pembayaran">Pembayaran</TabsTrigger>
            <TabsTrigger value="aplikasi">Aplikasi</TabsTrigger>
            <TabsTrigger value="tentang">Tentang</TabsTrigger>
          </TabsList>
          <TabsContent value="profil">
            <ProfileForm profile={profile} onSaved={onSaved} />
          </TabsContent>
          <TabsContent value="pembayaran">
            <QrisForm profile={profile} />
          </TabsContent>
          <TabsContent value="aplikasi">
            <AppForm taxBps={taxBps} timezone={timezone} onSaved={onSaved} />
            {owner && <DailyTargetForm />}
          </TabsContent>
          <TabsContent value="tentang">
            <Panel className="mt-4 flex flex-col gap-2 p-6 text-sm text-default-secondary">
              <p className="font-semibold text-default-primary">UMKMall Kasir</p>
              <p>Kasir untuk toko UMKMall: penjualan, stok, pembelian, staf dan laporan.</p>
              <p>
                Dibangun dari Lakasir (lisensi GPL-3.0). Kode sumber dan pemberitahuan lisensinya tersedia bersama
                aplikasi ini.
              </p>
            </Panel>
          </TabsContent>
        </Tabs>
      )}
    </Page>
  )
}

function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [form, setForm] = useState({
    name: profile.name ?? '',
    businessType: profile.businessType ?? '',
    otherBusinessType: profile.otherBusinessType ?? '',
    address: profile.address ?? '',
  })
  const [logo, setLogo] = useState<File | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors(({ [k]: _gone, ...rest }) => rest)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(undefined)
    const found = storeProfileErrors(form)
    setErrors(found)
    if (Object.keys(found).length) return showError({ status: 422, error: 'Beberapa isian belum benar. Periksa yang ditandai merah.' }, 'menyimpan pengaturan toko')
    setBusy(true)
    try {
      const saved = await saveProfile({
        data: {
          name: form.name.trim(),
          businessType: form.businessType,
          address: form.address.trim(),
          ...(form.businessType === 'other' ? { otherBusinessType: form.otherBusinessType.trim() } : {}),
        },
      })
      if (saved.error) {
        const placed = placeErrors({ error: saved.error, errors: saved.errors }, Object.keys(form))
        setErrors(placed.byField)
        setError(placed.formError)
        return showError(saved, 'menyimpan pengaturan toko')
      }
      if (logo) {
        const body = new FormData()
        body.set('file', logo)
        const up = await uploadLogo({ data: body })
        if (up.error) {
          setErrors((all) => ({ ...all, file: up.errors?.file ?? up.error! }))
          showError(up, 'mengunggah logo (profil toko sudah tersimpan)')
        } else setLogo(null)
      }
      notifySuccess('Pengaturan toko disimpan')
      onSaved()
      await router.invalidate() // the shell shows the new store name
    } catch (e) {
      setError(GENERIC_ERROR)
      showError(e, 'menyimpan pengaturan toko')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="mt-4 flex flex-col gap-6">
      <Panel className="grid gap-5 p-6 md:grid-cols-2">
        <div className="md:col-span-2">
          <TextField
            label="Nama toko"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            maxLength={120}
            required
            error={errors.name}
          />
        </div>
        <Select
          label={<RequiredLabel>Jenis usaha</RequiredLabel>}
          options={BUSINESS_TYPES}
          value={form.businessType}
          onValueChange={(v) => set('businessType', v)}
          placeholder="Pilih jenis usaha"
          error={errors.businessType}
        />
        {form.businessType === 'other' ? (
          <TextField
            label="Jenis usaha lainnya"
            value={form.otherBusinessType}
            onChange={(e) => set('otherBusinessType', e.target.value)}
            maxLength={60}
            required
            error={errors.otherBusinessType}
          />
        ) : (
          <span />
        )}
        <div className="md:col-span-2">
          <TextField
            label="Alamat toko"
            multiline
            rows={3}
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            maxLength={500}
            required
            error={errors.address}
          />
        </div>
        <div className="flex flex-col gap-3 md:col-span-2">
          <Upload
            label="Logo toko"
            accept="image/jpeg,image/png,image/webp"
            filled={Boolean(logo)}
            onFilesChange={(picked) => {
              const { accepted, refused } = splitImages(picked.slice(0, 1))
              setLogo(accepted[0] ?? null)
              setErrors(({ file: _gone, ...rest }) => (refused.length ? { ...rest, file: IMAGE_ERROR } : rest))
            }}
            helperText="JPG, PNG atau WebP, paling besar 2 MB. Diunggah saat disimpan."
            browseLabel="Pilih"
            error={errors.file}
          >
            {logo ? logo.name : 'Tarik logo ke sini atau pilih dari perangkat'}
          </Upload>
          {(logo || profile.hasLogo) && (
            <div className="flex items-center gap-3">
              <img
                src={logo ? URL.createObjectURL(logo) : `/pengaturan/logo?v=${encodeURIComponent(String(profile.hasLogo))}`}
                alt="Logo toko"
                className="size-20 rounded-lg border border-border-light object-cover"
              />
              {profile.hasLogo && !logo && (
                <Button
                  type="text"
                  color="danger"
                  size="small"
                  width="auto"
                  onClick={() =>
                    confirm.ask('Hapus logo toko?', async () => {
                      const r = await deleteLogo()
                      if (r.error) return r
                      notifySuccess('Logo dihapus')
                      await router.invalidate()
                    }, { action: 'menghapus logo' })
                  }
                >
                  Hapus logo
                </Button>
              )}
            </div>
          )}
        </div>
      </Panel>
      {error && <Alert variant="danger">{error}</Alert>}
      <ActionRow align="start">
        <Button htmlType="submit" type="primary" color="primary" size="small" width="auto" isLoading={busy}>
          Simpan
        </Button>
      </ActionRow>
      {confirm.dialog}
    </form>
  )
}

/** UMK-1992: the store's static QRIS, shown to the customer in the cashier's wallet payment step. */
function QrisForm({ profile }: { profile: Profile }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [broken, setBroken] = useState(false)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : undefined), [file])
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview])
  const saved = profile.qrisConfigured
  const hasProfile = profile.name !== null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !file) return
    setError(undefined)
    setBusy(true)
    try {
      const body = new FormData()
      body.set('file', file)
      const up = await uploadQris({ data: body })
      if (up.error) {
        setError(up.errors?.file ?? up.error)
        return showError(up, 'mengunggah kode QRIS')
      }
      setFile(null)
      setBroken(false)
      notifySuccess(saved ? 'Kode QRIS diganti' : 'Kode QRIS disimpan')
      await router.invalidate()
    } catch {
      setError(GENERIC_ERROR)
      showError(undefined, 'mengunggah kode QRIS')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="mt-4 flex flex-col gap-6">
      <Panel className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <p className="font-semibold text-default-primary">QRIS toko</p>
          <p className="text-sm text-default-secondary">
            Kode QRIS statis milik toko. Kasir menampilkannya ke pelanggan saat metode bayar dompet digital dipilih.
          </p>
        </div>
        {!hasProfile && <Alert variant="warning">Simpan profil toko dulu sebelum mengunggah kode QRIS.</Alert>}
        {saved && !file && (
          <div className="flex items-start gap-4">
            {broken ? (
              <p className="text-sm text-default-error">Kode QRIS tersimpan tetapi gagal dimuat. Coba muat ulang.</p>
            ) : (
              <img
                src={`/pengaturan/qris?v=${encodeURIComponent(profile.updatedAt ?? '')}`}
                alt="Kode QRIS toko"
                onError={() => setBroken(true)}
                className="size-40 rounded-lg border border-border-light bg-white object-contain"
              />
            )}
            <Button
              type="text"
              color="danger"
              size="small"
              width="auto"
              onClick={() =>
                confirm.ask(
                  'Hapus kode QRIS toko? Kasir tidak bisa menampilkan QRIS sampai Anda mengunggah lagi.',
                  async () => {
                    const r = await deleteQris()
                    if (r.error) return r
                    notifySuccess('Kode QRIS dihapus')
                    await router.invalidate()
                  },
                  { action: 'menghapus kode QRIS' },
                )
              }
            >
              Hapus QRIS
            </Button>
          </div>
        )}
        {!saved && !file && hasProfile && (
          <p className="text-sm text-default-secondary">Belum ada kode QRIS. Kasir akan melihat "QRIS belum diatur".</p>
        )}
        {hasProfile && (
          <>
            <Upload
              label={saved ? 'Ganti kode QRIS' : 'Kode QRIS'}
              accept="image/jpeg,image/png,image/webp"
              filled={Boolean(file)}
              onFilesChange={(picked) => {
                const { accepted, refused } = splitImages(picked.slice(0, 1))
                setFile(accepted[0] ?? null)
                setError(refused.length ? 'Kode QRIS harus JPG, PNG atau WebP, maksimal 2 MB' : undefined)
              }}
              helperText="JPG, PNG atau WebP, paling besar 2 MB. Pakai gambar QRIS statis dari penyedia pembayaranmu."
              browseLabel="Pilih"
              error={error}
            >
              {file ? file.name : 'Tarik gambar QRIS ke sini atau pilih dari perangkat'}
            </Upload>
            {preview && (
              <img
                src={preview}
                alt="Pratinjau kode QRIS"
                className="size-40 rounded-lg border border-border-light bg-white object-contain"
              />
            )}
          </>
        )}
      </Panel>
      {hasProfile && (
        <ActionRow align="start">
          <Button
            htmlType="submit"
            type="primary"
            color="primary"
            size="small"
            width="auto"
            isLoading={busy}
            disabled={!file}
          >
            {saved ? 'Ganti QRIS' : 'Simpan QRIS'}
          </Button>
        </ActionRow>
      )}
      {confirm.dialog}
    </form>
  )
}

function AppForm({
  taxBps,
  timezone,
  onSaved,
}: {
  taxBps: number | null
  timezone: string | null
  onSaved: () => void
}) {
  const router = useRouter()
  const [tax, setTax] = useState(taxBps === null ? '' : String(taxBps / 100).replace('.', ','))
  const [tz, setTz] = useState(timezone ?? 'Asia/Jakarta')
  const [taxTouched, setTaxTouched] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const zones = TIMEZONES.some((z) => z.value === tz) ? TIMEZONES : [...TIMEZONES, { value: tz, label: tz }]

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(undefined)
    const parsed = taxToBps(tax)
    if ('error' in parsed) {
      setErrors({ tax: parsed.error })
      return showError({ status: 422, error: 'Beberapa isian belum benar. Periksa yang ditandai merah.' }, 'menyimpan pengaturan aplikasi')
    }
    setErrors({})
    setBusy(true)
    const r = await saveAppSettings({
      data: appSettingsPayload({ bps: parsed.bps, taxTouched, timezone, tz }),
    }).catch(() => ({ error: GENERIC_ERROR, errors: undefined, status: 0 }))
    setBusy(false)
    if (r.error) {
      const placed = placeErrors({ error: r.error, errors: r.errors }, ['tax', 'timezone'])
      setErrors(placed.byField)
      setError(placed.formError)
      return showError(r, 'menyimpan pengaturan aplikasi')
    }
    notifySuccess('Pengaturan aplikasi disimpan')
    onSaved()
    await router.invalidate()
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="mt-4 flex flex-col gap-6">
      <Panel className="grid gap-5 p-6 md:grid-cols-2">
        <TextField
          label="Pajak bawaan"
          prefix="%"
          prefixPlacement="outside"
          inputMode="decimal"
          value={tax}
          onChange={(e) => {
            setTax(e.target.value)
            setTaxTouched(true)
            setErrors({})
          }}
          placeholder="0"
          required
          error={errors.tax}
        />
        {timezone !== null ? (
          <Select
            label={<RequiredLabel>Zona waktu laporan</RequiredLabel>}
            options={zones}
            value={tz}
            onValueChange={setTz}
            error={errors.timezone}
          />
        ) : (
          <p className="self-end text-sm text-default-secondary">Zona waktu laporan butuh izin melihat laporan.</p>
        )}
        <p className="text-xs text-default-secondary md:col-span-2">
          Pajak dihitung setelah diskon untuk setiap penjualan baru. Mata uang: Rupiah (IDR).
        </p>
      </Panel>
      {error && <Alert variant="danger">{error}</Alert>}
      <ActionRow align="start">
        <Button htmlType="submit" type="primary" color="primary" size="small" width="auto" isLoading={busy}>
          Simpan
        </Button>
      </ActionRow>
    </form>
  )
}
