import { notifySuccess, showError } from '@/lib/feedback'
import { pdfFailure, pdfFilename } from './-pdf'

/**
 * Downloads a report's PDF through the session route: a success toast ("PDF laporan … siap diunduh"), or the error
 * dialog saying what went wrong, with "Coba lagi" when `retry` is given. Returns whether it worked.
 */
export async function downloadPdf(params: { jenis: string; query: Record<string, string | undefined>; label: string; retry?: () => void }): Promise<boolean> {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params.query)) if (v) q.set(k, v)
  const res = await fetch(`/laporan/pdf/${params.jenis}?${q}`).catch(() => null)
  if (!res?.ok) {
    const body = res?.headers.get('content-type')?.includes('application/json')
      ? ((await res.json().catch(() => null)) as { message?: unknown; code?: unknown } | null)
      : null
    showError(pdfFailure(res?.status ?? 0, body), { action: 'membuat PDF', fallback: 'PDF laporan belum bisa dibuat.', retry: params.retry })
    return false
  }
  const url = URL.createObjectURL(await res.blob())
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: pdfFilename(res.headers.get('content-disposition'), `laporan-${params.jenis}.pdf`),
  })
  a.click()
  URL.revokeObjectURL(url)
  notifySuccess(`PDF laporan ${params.label} siap diunduh`)
  return true
}
