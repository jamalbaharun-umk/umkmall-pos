import { toast } from '@umkmall/ui/primitives'
import { describeError, type ErrorDescription } from './describe-error'

// The one way a screen tells the user how an action went (guideline "Panduan Dasar UI POS", section 2):
// a success toast, or an error dialog. The dialog itself is `components/feedback-host.tsx`, mounted once in the root.

export { describeError, type ErrorDescription, type FailureLike } from './describe-error'

/** A success toast: one short Indonesian sentence saying what happened, shown after the server answered. */
export function notifySuccess(message: string): void {
  toast(message, { variant: 'success' })
}

export type ErrorContext =
  | string
  | {
      /** The failed action, lower case, after "Gagal": "menyimpan pengeluaran". */
      action: string
      /** Runs when the person presses the main "Coba lagi" button. Without it the dialog offers only "Tutup". */
      retry?: () => void
      /** Indonesian sentence for "Apa yang terjadi" when the failure says nothing usable. */
      fallback?: string
    }

export type ErrorDialogState = ErrorDescription & { title: string; retry?: () => void }

type Listener = () => void
let current: ErrorDialogState | null = null
const listeners = new Set<Listener>()

const emit = () => listeners.forEach((l) => l())

export const subscribeErrorDialog = (l: Listener) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
export const errorDialogState = () => current
export function dismissError(): void {
  current = null
  emit()
}

/**
 * Opens the error dialog for a failed action. `error` is whatever the call gave back (a refusal object with `status`
 * and `error`, a thrown Error, a string); `context` names the action. Never pass a PIN, token or customer data in it.
 * A second failure replaces the first: one dialog at a time.
 */
export function showError(error: unknown, context: ErrorContext): void {
  const { action, retry, fallback } = typeof context === 'string' ? { action: context } : context
  const described = describeError(error, fallback ?? 'Aksi ini belum berhasil.')
  current = { ...described, title: `Gagal ${action}`, retry }
  emit()
}
