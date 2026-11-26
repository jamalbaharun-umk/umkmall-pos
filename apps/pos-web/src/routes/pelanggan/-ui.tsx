import { useRouter } from '@tanstack/react-router'
import {
  Alert,
  Button,
  Card,
  Dialog,
  Pagination,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextField,
} from '@umkmall/ui'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { notifySuccess, showError } from '@/lib/feedback'
import { Empty, Page, PageError, PageLoading, type Crumb } from '@/components/page'
import { checkFields, toBody, visibleFields, type Errors, type Field, type Values } from './-form'
import { removeResource, saveResource, type Resource, type Result } from './-api'
import { ActionRow } from '@/components/action-row'

// Page pieces for the U7 screens (pelanggan, voucher, metode pembayaran, piutang): Filament's page header,
// loading / empty / error states, and the list + modal form Lakasir's simple resources use.

// One formatter for every screen ("Rp12.000"), not Intl's currency style ("Rp 12.000").
export { rupiah } from '@/components/page'

export { Empty, Page, PageError as LoadError, PageLoading as Pending }

export { formatDay, formatMomentDay } from './-form'

export type { Field } from './-form'

/** Table footer like the product list: the range shown out of the total, and page buttons when there are several. */
export function ListFooter({
  page,
  perPage,
  total,
  shown,
  noun,
  onPage,
}: {
  page: number
  perPage: number
  total: number
  shown: number
  noun: string
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / perPage))
  const first = (page - 1) * perPage + 1
  return (
    <div className="flex flex-col items-center gap-3 border-t border-default-primary p-4 sm:flex-row sm:justify-between">
      <span className="text-sm text-default-secondary">
        {shown === 0
          ? `Halaman ${page} kosong dari ${total} ${noun}`
          : `Menampilkan ${first}–${first + shown - 1} dari ${total} ${noun}`}
      </span>
      {pages > 1 && <Pagination page={page} pageCount={pages} size="small" onPageChange={onPage} />}
    </div>
  )
}

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
  /** Server paging (Lakasir's table footer: "Menampilkan X–Y dari Z" and page buttons). */
  paging?: { page: number; perPage: number; total: number; onPage: (page: number) => void }
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

  /** Runs one save/delete: no double submit, server field errors onto fields, a toast on success, the error dialog on failure. */
  async function run(action: () => Promise<Result>, success: string, failing: string, done: () => void) {
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
        showError(res, failing)
        return
      }
      // Fresh list first, then close and toast together: no moment showing the old rows.
      await router.invalidate()
      done()
      notifySuccess(success)
    } catch (e) {
      setError('Terjadi kesalahan. Coba lagi sebentar lagi.')
      showError(e, failing)
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
      `menyimpan ${props.singular}`,
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
        {props.paging && props.paging.total > 0 && (
          <ListFooter {...props.paging} shown={props.rows.length} noun={props.singular} />
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
            {visibleFields(props.fields, form?.values ?? {}).map((f) =>
              f.options ? (
                <Select
                  portal
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
          <ActionRow>
            <Button type="outline" color="light" width="auto" onClick={() => setForm(undefined)}>
              Batal
            </Button>
            <Button htmlType="submit" width="auto" isLoading={busy} disabled={busy}>
              Simpan
            </Button>
          </ActionRow>
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
          <ActionRow>
            <Button type="outline" color="light" width="auto" onClick={() => setDeleting(undefined)}>
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
                  `menghapus ${props.singular}`,
                  () => setDeleting(undefined),
                )
              }
            >
              Hapus
            </Button>
          </ActionRow>
        </div>
      </Dialog>
    </Page>
  )
}
