import { Alert, toast } from '@umkmall/ui'
import type { ReactNode } from 'react'
import { Empty as PageEmpty } from './page'

// Extras the ui-parity-b screens (kasir, pemasok, pembelian, stok-opname) add on top of the shell's page pieces
// (./page, ./confirm): an inline form error, the date format, and the toast + field-error plumbing for forms.

export { Page, PageError as LoadError, PageLoading as Pending, rupiah } from './page'
export { useConfirm } from './confirm'
export { check, compact, type FieldErrors } from '../lib/form-checks'
import type { FieldErrors } from '../lib/form-checks'

export type Outcome = { ok: true } | { ok: false; error: string; errors?: FieldErrors }

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
 * Runs one server action for a form or button: a success toast, or a failure toast with the server's message and
 * its field errors returned for the caller to put on fields. A thrown call (network) becomes a failure, never a hang.
 */
export async function act<R extends Outcome>(
  run: () => Promise<R>,
  success: string,
): Promise<{ ok: true; res: R } | { ok: false; error: string; errors: FieldErrors }> {
  const res: Outcome = await run().catch(() => ({ ok: false as const, error: OFFLINE }))
  if (res.ok) {
    toast(success, { variant: 'success' })
    return { ok: true, res: res as R }
  }
  toast(res.error, { variant: 'danger' })
  return { ok: false, error: res.error, errors: res.errors ?? {} }
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
