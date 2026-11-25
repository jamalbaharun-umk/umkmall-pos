import { Button, Dialog } from '@umkmall/ui/primitives'
import { useRef, useState, type ReactNode } from 'react'
import { showError, type FailureLike } from '@/lib/feedback'

/**
 * Lakasir's confirmation modal (Filament "Are you sure?") for destructive actions. `run` returns the refusal (an
 * object with `error` and `status`, or a message) to show in the shared error dialog, or nothing to close it. A `run`
 * that already reported its own failure (through `act`) returns nothing.
 */
export function useConfirm() {
  const [state, setState] = useState<{
    title: string
    body?: ReactNode
    label: string
    action: string
    run: () => Promise<string | FailureLike | void>
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false) // a double click arrives before `busy` re-renders

  /** `opts.action` names the action for a failure title: "Gagal {action}" (for example "menghapus kategori"). */
  const ask = (
    title: string,
    run: () => Promise<string | FailureLike | void>,
    opts: { body?: ReactNode; label?: string; action?: string } = {},
  ) => {
    setState({ title, run, body: opts.body, label: opts.label ?? 'Hapus', action: opts.action ?? 'menjalankan aksi ini' })
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
              if (!state || lock.current) return
              lock.current = true
              setBusy(true)
              const failed = await state.run().catch((e: unknown) => e ?? { status: 0 })
              lock.current = false
              setBusy(false)
              const { action } = state
              setState(null)
              if (failed) showError(typeof failed === 'string' ? { error: failed } : failed, action)
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
