import { Button, Dialog, Icon } from '@umkmall/ui/primitives'
import { useSyncExternalStore } from 'react'
import { dismissError, errorDialogState, subscribeErrorDialog } from '@/lib/feedback'

/**
 * The error notification dialog (guideline section 2), mounted once in the root. Title names the failed action,
 * then what happened, what to do, a small help code and the buttons: main action first in the DOM, so a phone shows
 * it on top at full width and a desktop shows it rightmost (`md:flex-row-reverse`). Below `md` the Dialog is a
 * bottom sheet, from `md` up a centred card.
 */
export function FeedbackHost() {
  const state = useSyncExternalStore(subscribeErrorDialog, errorDialogState, () => null)
  if (!state) return null

  const main = (() => {
    if (state.primary === 'retry' && state.retry) {
      const retry = state.retry
      return { label: 'Coba lagi', run: () => (dismissError(), retry()) }
    }
    if (state.primary === 'reload') return { label: 'Muat ulang', run: () => window.location.reload() }
    if (state.primary === 'signin') return { label: 'Masuk lagi', run: () => window.location.assign('/') }
    return null
  })()

  return (
    <Dialog open onOpenChange={(open) => !open && dismissError()} title={state.title} size="small">
      <div role="alert" className="flex flex-col gap-4 px-6 pt-2 pb-6">
        <div className="flex gap-3">
          <Icon name="alert-circle" className="mt-0.5 size-5 shrink-0 text-default-error" />
          <div className="flex flex-col gap-3 text-sm text-default-primary">
            <div>
              <p className="text-xs font-semibold uppercase text-default-secondary">Apa yang terjadi</p>
              <p>{state.what}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-default-secondary">Yang bisa dilakukan</p>
              <p>{state.todo}</p>
            </div>
            <p className="text-xs text-default-secondary">Kode: {state.code}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 md:flex-row-reverse md:justify-start">
          {main ? (
            <>
              <Button type="primary" size="medium" width="auto" className="w-full md:w-auto" onClick={main.run}>
                {main.label}
              </Button>
              <Button type="outline" color="light" size="medium" width="auto" className="w-full md:w-auto" onClick={dismissError}>
                Tutup
              </Button>
            </>
          ) : (
            <Button type="primary" size="medium" width="auto" className="w-full md:w-auto" onClick={dismissError}>
              Mengerti
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
