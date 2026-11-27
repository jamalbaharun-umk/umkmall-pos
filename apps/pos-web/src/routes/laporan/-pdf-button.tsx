import { useRef, useState } from 'react'
import { Button } from '@umkmall/ui/primitives'
import { downloadPdf } from './-pdf-download'

/**
 * "Unduh PDF" (design feature 37): one line, 44 px (the `ActionRow` that holds it sets that and stacks it on a phone),
 * locked with a loader while the server makes the file, same width. A second tap in one tick starts one download.
 */
export function PdfButton({
  jenis,
  query,
  label,
  disabled,
  beforeStart,
}: {
  jenis: string
  query: Record<string, string | undefined>
  /** The period as the toast says it: "20 sampai 26 Nov 2026". */
  label: string
  disabled?: boolean
  /** Return false to stop (a form check); it shows its own messages. */
  beforeStart?: () => boolean
}) {
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const start = async () => {
    if (running.current || beforeStart?.() === false) return
    running.current = true
    setBusy(true)
    await downloadPdf({ jenis, query, label, retry: () => void start() }).finally(() => {
      running.current = false
      setBusy(false)
    })
  }
  return (
    <Button htmlType="button" type="outline" color="primary" width="auto" isLoading={busy} disabled={disabled} onClick={() => void start()}>
      Unduh PDF
    </Button>
  )
}
