import { useRef, useState } from 'react'
import { Button } from '@umkmall/ui/primitives'
import { downloadPeriodCsv } from './-csv-download'

/**
 * "Unduh CSV" for a screen with a period: one line, 44 px (the `ActionRow` that holds it sets that and stacks it on a
 * phone), locked with a loader while the file is made. A second tap in one tick starts one download.
 */
export function CsvButton({ jenis, period }: { jenis: string; period: string }) {
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const start = async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    await downloadPeriodCsv({ jenis, period, retry: () => void start() }).finally(() => {
      running.current = false
      setBusy(false)
    })
  }
  return (
    <Button htmlType="button" type="outline" color="primary" width="auto" isLoading={busy} onClick={() => void start()}>
      Unduh CSV
    </Button>
  )
}
