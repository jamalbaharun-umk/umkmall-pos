import { Alert, Button, Dialog, Skeleton, Text } from '@umkmall/ui'
import { useState, type ReactNode } from 'react'

// Extras the ui-parity-b screens (kasir, pemasok, pembelian, stok-opname) add on top of the shell's page pieces
// (./page): an inline error, a confirm dialog and the date format.

import { Empty as PageEmpty } from './page'

export { Page, PageError as LoadError, PageLoading as Pending, rupiah } from './page'

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <PageEmpty title={title} action={action}>
      {hint}
    </PageEmpty>
  )
}

export function ErrorText({ children }: { children?: ReactNode }) {
  return children ? (
    <Alert variant="danger" size="small" role="alert">
      {children}
    </Alert>
  ) : null
}

/** "Are you sure?" before an irreversible action (Filament's requiresConfirmation). */
export function useConfirm() {
  const [ask, setAsk] = useState<{
    title: string
    body: string
    confirm: string
    danger?: boolean
    resolve: (ok: boolean) => void
  }>()
  const confirm = (title: string, body: string, opts: { confirm?: string; danger?: boolean } = {}) =>
    new Promise<boolean>((resolve) =>
      setAsk({
        title,
        body,
        confirm: opts.confirm ?? 'Ya, lanjutkan',
        danger: opts.danger,
        resolve,
      }),
    )
  const close = (ok: boolean) => {
    ask?.resolve(ok)
    setAsk(undefined)
  }
  const dialog = (
    <Dialog open={!!ask} onOpenChange={(o) => !o && close(false)} centered size="small" title={ask?.title}>
      <div className="space-y-4 px-6 pb-6">
        <p className="text-default-secondary">{ask?.body}</p>
        <div className="flex justify-end gap-2">
          <Button width="auto" type="outline" color="light" onClick={() => close(false)}>
            Batal
          </Button>
          <Button width="auto" color={ask?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {ask?.confirm}
          </Button>
        </div>
      </div>
    </Dialog>
  )
  return { confirm, dialog }
}
