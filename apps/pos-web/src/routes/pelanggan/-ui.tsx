import { useRouter } from '@tanstack/react-router'
import {
  Alert,
  Button,
  Card,
  Dialog,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextField,
  toast,
} from '@umkmall/ui'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Empty, Page, PageError, PageLoading, type Crumb } from '@/components/page'
import { checkFields, toBody, type Errors, type Field, type Values } from './-form'
import { removeResource, saveResource, type Resource, type Result } from './-api'

// Page pieces for the U7 screens (pelanggan, voucher, metode pembayaran, piutang): Filament's page header,
// loading / empty / error states, and the list + modal form Lakasir's simple resources use.

export const rupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n)

export { Empty, Page, PageError as LoadError, PageLoading as Pending }

export const formatDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('id-ID', { dateStyle: 'medium' })

export type { Field } from './-form'

export type Column<T> = {
  label: string
  cell: (row: T) => ReactNode
  right?: boolean
}
/**
 * Lakasir's simple resource: a table with Ubah/Hapus row actions and a "Tambah" header action, create and edit
 * in a modal form. pos-api validates; its message is shown in the form.
 */
export function ResourcePage<T extends { id: string }>(props: {
  title: string
  crumbs: Crumb[]
  singular: string
  resource: Resource
  rows: T[]
  columns: Column<T>[]
  fields: Field[]
  emptyHint: string
  canManage?: (row: T) => boolean
  toolbar?: ReactNode
  /** pos-api returns at most this many rows: say so instead of silently cutting the list. */
  cap?: number
}) {
  const router = useRouter()
  const [form, setForm] = useState<{ id?: string; values: Values }>()
  const [deleting, setDeleting] = useState<T>()
  const [busy, setBusy] = useState(false)
  // Set synchronously: two clicks in one tick both see busy=false, never inFlight=false.
  const inFlight = useRef(false)
  const [error, setError] = useState<string>()
  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const names = new Set(props.fields.map((f) => f.name))
  const Singular = props.singular[0].toUpperCase() + props.singular.slice(1)

  /** Runs one save/delete: no double submit, server field errors onto fields, a toast either way. */
  async function run(action: () => Promise<Result>, success: string, done: () => void) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(undefined)
    try {
      const res = await action()
      if (!res.ok) {
        const onFields = Object.fromEntries(Object.entries(res.errors ?? {}).filter(([k]) => names.has(k)))
        setFieldErrors(onFields)
        // What no field shows goes to the form-level alert.
        const rest = Object.entries(res.errors ?? {}).filter(([k]) => !names.has(k))
        setError(Object.keys(onFields).length && !rest.length ? undefined : (rest[0]?.[1] ?? res.error))
        toast(res.error, { variant: 'danger' })
        return
      }
      // Fresh list first, then close and toast together: no moment showing the old rows.
      await router.invalidate()
      done()
      toast(success, { variant: 'success' })
    } catch {
      setError('Terjadi kesalahan. Coba lagi sebentar lagi.')
      toast('Terjadi kesalahan. Coba lagi sebentar lagi.', { variant: 'danger' })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const open = (row?: T) => {
    setError(undefined)
    setFieldErrors({})
    const r = row as Record<string, unknown> | undefined
    setForm({
      id: row?.id,
      // A select starts on its first option, like Filament's default.
      values: Object.fromEntries(
        props.fields.map((f) => [f.name, r?.[f.name] == null ? (f.options?.[0]?.value ?? '') : String(r[f.name])]),
      ),
    })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!form || busy) return
    const errors = checkFields(props.fields, form.values)
    setFieldErrors(errors)
    if (Object.keys(errors).length) return setError('Periksa kembali isian yang ditandai.')
    void run(
      () =>
        saveResource({
          data: {
            resource: props.resource,
            id: form.id,
            body: toBody(props.fields, form.values),
          },
        }),
      form.id ? `${Singular} tersimpan` : `${Singular} ditambahkan`,
      () => setForm(undefined),
    )
  }

  const set = (name: string, value: string) => {
    setForm((f) => f && { ...f, values: { ...f.values, [name]: value } })
    setFieldErrors(({ [name]: _gone, ...rest }) => rest)
  }
  const manage = props.canManage ?? (() => true)

  return (
    <Page
      title={props.title}
      crumbs={props.crumbs}
      actions={<Button onClick={() => open()}>Tambah {props.singular}</Button>}
    >
      <Card variant="outlined" padding="none" className="overflow-hidden">
        {props.toolbar && <div className="border-b border-default-primary p-4">{props.toolbar}</div>}
        {props.cap && props.rows.length >= props.cap && (
          <p className="border-b border-default-primary px-4 py-2 text-sm text-default-secondary">
            Menampilkan {props.cap} data pertama. Gunakan pencarian untuk mempersempit.
          </p>
        )}
        {props.rows.length === 0 ? (
          <Empty title={`Belum ada ${props.singular}`}>{props.emptyHint}</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {props.columns.map((c) => (
                  <TableHead key={c.label} className={c.right ? 'text-right' : undefined}>
                    {c.label}
                  </TableHead>
                ))}
                <TableHead className="text-right">
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.rows.map((row) => (
                <TableRow key={row.id}>
                  {props.columns.map((c) => (
                    <TableCell key={c.label} className={c.right ? 'text-right' : undefined}>
                      {c.cell(row)}
                    </TableCell>
                  ))}
                  <TableCell className="whitespace-nowrap text-right">
                    {manage(row) && (
                      <span className="flex justify-end gap-1">
                        <Button type="text" size="small" width="auto" onClick={() => open(row)}>
                          Ubah
                        </Button>
                        <Button type="text" color="danger" size="small" width="auto" onClick={() => {
                            setError(undefined)
                            setDeleting(row)
                          }}>
                          Hapus
                        </Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={!!form}
        onOpenChange={(o) => !o && setForm(undefined)}
        centered
        title={form?.id ? `Ubah ${props.singular}` : `Tambah ${props.singular}`}
      >
        <form onSubmit={submit} noValidate className="space-y-4 px-6 pb-6">
          <div className="grid max-h-[60vh] gap-4 overflow-y-auto p-1 sm:grid-cols-2">
            {props.fields.map((f) =>
              f.options ? (
                <Select
                  key={f.name}
                  label={f.label}
                  options={f.options}
                  value={form?.values[f.name] ?? ''}
                  onValueChange={(v) => set(f.name, v)}
                  error={fieldErrors[f.name]}
                />
              ) : (
                <TextField
                  key={f.name}
                  label={f.optional ? `${f.label} (opsional)` : f.label}
                  type={f.type === 'date' ? 'date' : f.type === 'phone' ? 'tel' : 'text'}
                  inputMode={f.type === 'number' ? 'numeric' : f.type === 'phone' ? 'tel' : undefined}
                  placeholder={f.placeholder}
                  value={form?.values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  required={!f.optional}
                  error={fieldErrors[f.name]}
                />
              ),
            )}
          </div>
          {error && (
            <Alert variant="danger" size="small" role="alert">
              {error}
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button type="outline" color="dark" width="auto" onClick={() => setForm(undefined)}>
              Batal
            </Button>
            <Button htmlType="submit" width="auto" isLoading={busy} disabled={busy}>
              Simpan
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        centered
        size="small"
        title={`Hapus ${props.singular}?`}
      >
        <div className="space-y-4 px-6 pb-6">
          <p className="text-default-secondary">Data yang dihapus tidak tampil lagi. Transaksi lama tetap tersimpan.</p>
          {error && (
            <Alert variant="danger" size="small" role="alert">
              {error}
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button type="outline" color="dark" width="auto" onClick={() => setDeleting(undefined)}>
              Batal
            </Button>
            <Button
              color="danger"
              width="auto"
              isLoading={busy}
              onClick={() =>
                deleting &&
                void run(
                  () =>
                    removeResource({
                      data: { resource: props.resource, id: deleting.id },
                    }),
                  `${Singular} dihapus`,
                  () => setDeleting(undefined),
                )
              }
            >
              Hapus
            </Button>
          </div>
        </div>
      </Dialog>
    </Page>
  )
}
