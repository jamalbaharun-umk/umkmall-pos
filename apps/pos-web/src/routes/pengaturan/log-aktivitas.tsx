import { Badge, Button, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@umkmall/ui'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { Page, Panel } from '@/components/page'
import { Empty } from '@/components/pos-page'
import { showError } from '@/lib/feedback'
import { PERMISSION_LABELS } from '../staf/-api'
import { loadLog, loadLogStaff, type LogFailure } from './-log-api'
import {
  actionLabel,
  actorLabel,
  DEFAULT_PERIOD,
  detailLines,
  detailText,
  GROUPS,
  isFiltered,
  parseSearch,
  PER_PAGE,
  PERIODS,
  staffOptions,
  targetLabel,
  whenLabel,
  type LogPage,
  type LogRow,
  type LogSearch,
} from './-log-helpers'

// "Log aktivitas" (UMK-1969, design 32): who did what and when, for what touches money and access. Read only and
// append only: the page has no button that changes or deletes a row. The owner only (`staff.manage`); the menu entry
// is hidden for everyone else and pos-api answers 403.
export const Route = createFileRoute('/pengaturan/log-aktivitas')({
  validateSearch: (s: Record<string, unknown>): LogSearch => parseSearch(s),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    // A call that never got an answer (offline) is a failure to show in the dialog, not a crashed page.
    const [first, staff] = await Promise.all([
      loadLog({ data: { search: deps, page: 1 } }).catch((): LogFailure => ({ ok: false, status: 0, error: '' })),
      loadLogStaff().catch(() => []),
    ])
    return { first, staff }
  },
  pendingComponent: LogLoading,
  component: LogScreen,
})

const crumbs = [{ label: 'Pengaturan', to: '/pengaturan' }, { label: 'Log aktivitas' }]
const permissionLabel = (key: string) => PERMISSION_LABELS[key] ?? key
const GROUP_TONE = { money: 'warning', access: 'primary', shift: 'light' } as const

function LogLoading() {
  return (
    <Page title="Log aktivitas" crumbs={crumbs}>
      <Panel>
        <div role="status" aria-label="Memuat" className="flex flex-col gap-3 p-4">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Panel>
    </Page>
  )
}

function LogScreen() {
  const { first, staff } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/pengaturan/log-aktivitas' })
  const router = useRouter()
  const filtered = isFiltered(search)

  // The first page comes from the loader; "Muat lebih banyak" appends the next ones. Both reset with the filters.
  const [more, setMore] = useState<{ key: string; rows: LogRow[]; page: number }>({ key: '', rows: [], page: 1 })
  const key = JSON.stringify(search)
  const extra = more.key === key ? more : { key, rows: [], page: 1 }
  const [loadingMore, setLoadingMore] = useState(false)
  const [open, setOpen] = useState<string>()

  // The load failed: the error dialog says what happened and offers "Muat ulang".
  const failed = first.ok ? undefined : first
  useEffect(() => {
    if (failed) showFailure(failed, () => void router.invalidate())
  }, [failed, router])

  function setFilter(next: Partial<LogSearch>) {
    void navigate({ search: parseSearch({ ...search, ...next }) })
  }

  async function loadMore() {
    setLoadingMore(true)
    const res = await loadLog({ data: { search, page: extra.page + 1 } }).catch(
      (): LogFailure => ({ ok: false, status: 0, error: '' }),
    )
    setLoadingMore(false)
    if (!res.ok) return showFailure(res, () => void loadMore())
    setMore({ key, rows: [...extra.rows, ...res.page.data], page: extra.page + 1 })
  }

  if (failed)
    return (
      <Page title="Log aktivitas" crumbs={crumbs}>
        <Panel>
          <Empty
            title="Log aktivitas belum bisa dimuat"
            hint={failed.status === 403 ? failed.error : 'Periksa sambungan, lalu muat ulang.'}
            action={
              failed.status === 403 ? undefined : (
                <Button width="auto" size="small" onClick={() => void router.invalidate()}>
                  Muat ulang
                </Button>
              )
            }
          />
        </Panel>
      </Page>
    )

  const page = (first as { ok: true; page: LogPage }).page
  const rows = [...page.data, ...extra.rows]
  const hasMore = rows.length < page.total
  const timezone = page.timezone

  return (
    <Page title="Log aktivitas" crumbs={crumbs}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Jenis aksi">
        {GROUPS.map((g) => {
          const on = (search.group ?? 'all') === g.value
          return (
            <Button
              key={g.value}
              width="auto"
              size="small"
              type={on ? 'primary' : 'outline'}
              color={on ? 'primary' : 'light'}
              aria-pressed={on}
              onClick={() => setFilter({ group: g.value === 'all' ? undefined : g.value })}
            >
              {g.label}
            </Button>
          )
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        <Select
          label="Staf"
          size="small"
          options={staffOptions(staff)}
          value={search.staff ?? 'all'}
          onValueChange={(v) => setFilter({ staff: v === 'all' ? undefined : v })}
        />
        <Select
          label="Tanggal"
          size="small"
          options={PERIODS.map((p) => ({ value: p.value, label: p.value === 'all' || p.value === '1' ? p.label : `${p.label} terakhir` }))}
          value={search.period ?? DEFAULT_PERIOD}
          onValueChange={(v) => setFilter({ period: v as LogSearch['period'] })}
        />
      </div>

      <Panel>
        {rows.length === 0 ? (
          filtered ? (
            <Empty
              title="Tidak ada aktivitas untuk filter ini."
              action={
                <Button width="auto" size="small" type="outline" color="light" onClick={() => void navigate({ search: {} })}>
                  Hapus filter
                </Button>
              }
            />
          ) : (
            <Empty title="Belum ada aktivitas." hint="Aksi seperti void, ubah harga, dan tutup shift akan tercatat di sini." />
          )
        ) : (
          <>
            <ul className="divide-y divide-default-primary md:hidden" aria-label="Daftar aktivitas">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-expanded={open === r.id}
                    onClick={() => setOpen(open === r.id ? undefined : r.id)}
                    className="flex w-full flex-col gap-1 px-4 py-3 text-left"
                  >
                    <span className="font-medium text-default-primary">
                      {actorLabel(r.actor)} · {actionLabel(r.event)} {targetLabel(r)}
                    </span>
                    <span className="text-sm text-default-secondary">
                      {whenLabel(r.occurredAt, timezone)}
                      {detailText(r, permissionLabel) && ` · ${detailText(r, permissionLabel)}`}
                    </span>
                  </button>
                  {open === r.id && <Detail row={r} timezone={timezone} />}
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Siapa</TableHead>
                    <TableHead>Aksi</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Rincian</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">Rincian lengkap</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <Fragment key={r.id}>
                      <TableRow
                        tabIndex={0}
                        aria-expanded={open === r.id}
                        className="cursor-pointer"
                        onClick={() => setOpen(open === r.id ? undefined : r.id)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen(open === r.id ? undefined : r.id))}
                      >
                        <TableCell className="whitespace-nowrap">{whenLabel(r.occurredAt, timezone)}</TableCell>
                        <TableCell>{actorLabel(r.actor)}</TableCell>
                        <TableCell>
                          {r.group ? (
                            <Badge color={GROUP_TONE[r.group]} size="small">
                              {actionLabel(r.event)}
                            </Badge>
                          ) : (
                            actionLabel(r.event)
                          )}
                        </TableCell>
                        <TableCell>{targetLabel(r)}</TableCell>
                        <TableCell className="text-default-secondary">{detailText(r, permissionLabel)}</TableCell>
                        <TableCell>{open === r.id ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}</TableCell>
                      </TableRow>
                      {open === r.id && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-default-secondary">
                            <Detail row={r} timezone={timezone} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col items-center gap-3 border-t border-default-primary p-4 sm:flex-row sm:justify-between">
              <span className="text-sm text-default-secondary">
                Menampilkan {rows.length} dari {page.total} aktivitas
              </span>
              {hasMore && (
                <ActionRow>
                  <Button width="auto" size="small" type="outline" color="light" isLoading={loadingMore} onClick={() => void loadMore()}>
                    Muat lebih banyak ({PER_PAGE} baris)
                  </Button>
                </ActionRow>
              )}
            </div>
          </>
        )}
      </Panel>
      <p className="text-sm text-default-secondary">
        Log hanya menambah dan tidak bisa diubah atau dihapus. PIN, token, nomor telepon, dan nama pelanggan tidak tercatat.
      </p>
    </Page>
  )
}

function Detail({ row, timezone }: { row: LogRow; timezone: string }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-4 py-3 text-sm md:px-0">
      {detailLines(row, timezone, permissionLabel).map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-default-secondary">{label}</dt>
          <dd className="text-default-primary">{value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

function showFailure(failure: LogFailure, retry: () => void) {
  showError(failure, { action: 'memuat log aktivitas', retry })
}
