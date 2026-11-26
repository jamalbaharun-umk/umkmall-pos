import { Alert } from '@umkmall/ui'
import type { ReactNode } from 'react'
import { notifySuccess, showError, type ErrorContext } from '../lib/feedback'
import { Empty as PageEmpty } from './page'

// Extras the ui-parity-b screens (kasir, pemasok, pembelian, stok-opname) add on top of the shell's page pieces
// (./page, ./confirm): an inline form error, the date format, and the toast + field-error plumbing for forms.

export { Page, PageError as LoadError, PageLoading as Pending, rupiah } from './page'
export { useConfirm } from './confirm'
export { check, compact, type FieldErrors } from '../lib/form-checks'
import type { FieldErrors } from '../lib/form-checks'

export type Outcome = { ok: true } | { ok: false; error: string; errors?: FieldErrors; status?: number; code?: string }

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })

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

const OFFLINE = 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.'

/**
 * Runs one server action for a form or button: a success toast, or the shared error dialog ("Gagal {action}") with
 * what happened; its field errors are returned for the caller to put on fields too. A thrown call (network) becomes a
 * failure, never a hang.
 */
export async function act<R extends Outcome>(
  run: () => Promise<R>,
  success: string,
  action: ErrorContext,
): Promise<{ ok: true; res: R } | { ok: false; error: string; errors: FieldErrors; res: Extract<R, { ok: false }> | Outcome }> {
  const res: Outcome = await run().catch(() => ({ ok: false as const, status: 0, error: OFFLINE }))
  if (res.ok) {
    notifySuccess(success)
    return { ok: true, res: res as R }
  }
  showError(res, action)
  return { ok: false, error: res.error, errors: res.errors ?? {}, res }
}

/** A required marker for controls without a `required` prop (Select): the same red asterisk TextField draws. */
export const req = (label: string) => (
  <>
    {label}
    <span aria-hidden className="text-default-error">
      *
    </span>
  </>
)
