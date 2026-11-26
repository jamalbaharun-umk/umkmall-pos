import { notifySuccess, showError } from '@/lib/feedback'
import { exportFailure, type KasbonFilter } from './-kasbon'

/** Downloads the CSV through the session route; a success toast, or the error dialog saying what went wrong. */
export async function downloadKasbonCsv(params: { filter: KasbonFilter; memberId?: string }): Promise<boolean> {
  const q = new URLSearchParams({ filter: params.filter, ...(params.memberId ? { memberId: params.memberId } : {}) })
  const res = await fetch(`/laporan/csv/kasbon?${q}`).catch(() => null)
  if (!res?.ok) {
    const body = res?.headers.get('content-type')?.includes('application/json')
      ? ((await res.json().catch(() => null)) as { message?: unknown; code?: unknown } | null)
      : null
    showError(exportFailure(res?.status ?? 0, body), {
      action: 'membuat file CSV',
      fallback: 'File CSV belum bisa dibuat.',
    })
    return false
  }
  const url = URL.createObjectURL(await res.blob())
  const a = Object.assign(document.createElement('a'), { href: url, download: 'laporan-kasbon.csv' })
  a.click()
  URL.revokeObjectURL(url)
  notifySuccess('File CSV piutang siap diunduh')
  return true
}
