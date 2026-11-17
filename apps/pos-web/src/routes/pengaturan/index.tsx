import { Alert, Button, Select, TextField, Upload, toast } from '@umkmall/ui/primitives'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@umkmall/ui/compositions'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useConfirm } from '@/components/confirm'
import { NoAccess, Page, PageError, PageLoading, Panel, RequiredLabel } from '@/components/page'
import { useCan } from '@/components/shell'
import { GENERIC_ERROR, placeErrors } from '@/lib/refusal'
import { IMAGE_ERROR, splitImages, storeProfileErrors, taxToBps, type Errors } from '@/lib/validate'
import {
  BUSINESS_TYPES,
  deleteLogo,
  loadSettings,
  saveAppSettings,
  saveProfile,
  uploadLogo,
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
  return (
    <Page title="Pengaturan" crumbs={[{ label: 'Pengaturan' }]}>
      {!canEdit ? (
        <NoAccess permission="Mengelola katalog" />
      ) : (
        <Tabs defaultValue="profil">
          <TabsList label="Pengaturan">
            <TabsTrigger value="profil">Profil toko</TabsTrigger>
            <TabsTrigger value="aplikasi">Aplikasi</TabsTrigger>
            <TabsTrigger value="tentang">Tentang</TabsTrigger>
          </TabsList>
          <TabsContent value="profil">
            <ProfileForm profile={profile} />
          </TabsContent>
          <TabsContent value="aplikasi">
            <AppForm taxBps={taxBps} timezone={timezone} />
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

function ProfileForm({ profile }: { profile: Profile }) {
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
    if (Object.keys(found).length) return toast('Periksa kembali isian kamu', { variant: 'danger' })
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
        return toast(saved.error, { variant: 'danger' })
      }
      if (logo) {
        const body = new FormData()
        body.set('file', logo)
        const up = await uploadLogo({ data: body })
        if (up.error) {
          setErrors((all) => ({ ...all, file: up.errors?.file ?? up.error! }))
          toast(`Profil disimpan, tapi logo belum: ${up.error}`, { variant: 'warning' })
        } else setLogo(null)
      }
      toast('Pengaturan toko disimpan', { variant: 'success' })
      await router.invalidate() // the shell shows the new store name
    } catch {
      setError(GENERIC_ERROR)
      toast(GENERIC_ERROR, { variant: 'danger' })
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
                      if (r.error) return r.error
                      toast('Logo dihapus', { variant: 'success' })
                      await router.invalidate()
                    })
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
      <div>
        <Button htmlType="submit" type="primary" color="primary" size="small" width="auto" isLoading={busy}>
          Simpan
        </Button>
      </div>
      {confirm.dialog}
    </form>
  )
}

function AppForm({ taxBps, timezone }: { taxBps: number | null; timezone: string | null }) {
  const router = useRouter()
  const [tax, setTax] = useState(taxBps === null ? '' : String(taxBps / 100).replace('.', ','))
  const [tz, setTz] = useState(timezone ?? 'Asia/Jakarta')
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
      return toast('Periksa kembali isian kamu', { variant: 'danger' })
    }
    setErrors({})
    setBusy(true)
    const r = await saveAppSettings({
      data: { taxBps: parsed.bps, ...(timezone === null ? {} : { timezone: tz }) },
    }).catch(() => ({ error: GENERIC_ERROR, errors: undefined }))
    setBusy(false)
    if (r.error) {
      const placed = placeErrors({ error: r.error, errors: r.errors }, ['tax', 'timezone'])
      setErrors(placed.byField)
      setError(placed.formError)
      return toast(r.error, { variant: 'danger' })
    }
    toast('Pengaturan aplikasi disimpan', { variant: 'success' })
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
      <div>
        <Button htmlType="submit" type="primary" color="primary" size="small" width="auto" isLoading={busy}>
          Simpan
        </Button>
      </div>
    </form>
  )
}
