import { Button, Dialog } from '@umkmall/ui/primitives'
import { useState, type ReactNode } from 'react'

/**
 * Lakasir's confirmation modal (Filament "Are you sure?") for destructive actions. `onConfirm` returns an error
 * message to show in the dialog, or nothing to close it.
 */
export function useConfirm() {
  const [state, setState] = useState<{
    title: string
    body?: ReactNode
    label: string
    run: () => Promise<string | void>
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const ask = (title: string, run: () => Promise<string | void>, opts: { body?: ReactNode; label?: string } = {}) => {
    setError(undefined)
    setState({ title, run, body: opts.body, label: opts.label ?? 'Hapus' })
  }

  const dialog = (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => !open && !busy && setState(null)}
      title={state?.title}
      size="small"
      centered
    >
      <div className="flex flex-col gap-4 px-6 pt-2 pb-6">
        {state?.body && <div className="text-sm text-default-secondary">{state.body}</div>}
        {error && (
          <p role="alert" className="text-sm text-default-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="outline" color="light" size="small" width="auto" disabled={busy} onClick={() => setState(null)}>
            Batal
          </Button>
          <Button
            type="primary"
            color="danger"
            size="small"
            width="auto"
            isLoading={busy}
            onClick={async () => {
              if (!state) return
              setBusy(true)
              const failed = await state.run().catch(() => 'Terjadi kesalahan. Coba lagi sebentar lagi.')
              setBusy(false)
              if (failed) setError(failed)
              else setState(null)
            }}
          >
            {state?.label}
          </Button>
        </div>
      </div>
    </Dialog>
  )

  return { ask, dialog }
}
