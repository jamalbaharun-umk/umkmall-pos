import { notifySuccess, showError } from '@/lib/feedback'
import { periodCsvFailure, periodCsvFilename, periodCsvQuery } from './-csv'

/** Downloads a period CSV through the session route; a success toast, or the error dialog saying what went wrong. */
export async function downloadPeriodCsv(params: { jenis: string; period: string; retry?: () => void }): Promise<boolean> {
  const res = await fetch(`/laporan/csv/${params.jenis}?${periodCsvQuery(params.period)}`).catch(() => null)
  if (!res?.ok) {
    const body = res?.headers.get('content-type')?.includes('application/json')
      ? ((await res.json().catch(() => null)) as { message?: unknown; code?: unknown } | null)
      : null
    showError(periodCsvFailure(res?.status ?? 0, body), {
      action: 'membuat file CSV',
      fallback: 'File CSV belum bisa dibuat.',
      retry: params.retry,
    })
    return false
  }
  const url = URL.createObjectURL(await res.blob())
  const a = Object.assign(document.createElement('a'), { href: url, download: periodCsvFilename(params.jenis, params.period) })
  a.click()
  URL.revokeObjectURL(url)
  notifySuccess('File CSV siap diunduh')
  return true
}
