/**
 * A failed load that means "this record is not there" (pos-api 404: a missing id, or another store's). Server
 * functions rethrow only the message, so the screens' 404 wording is what we can read ("Shift tidak ditemukan.",
 * "Data tidak ditemukan, mungkin sudah dihapus."): a short message that ENDS its first clause with it. Retrying such
 * a load can never succeed.
 */
export const isNotFoundError = (error: unknown): boolean =>
  error instanceof Error && /^[^.,]{1,60} tidak ditemukan(?:[.,]|$)/i.test(error.message)

/** The list a detail page belongs to: "/kasir/shift/abc" -> "/kasir/shift"; the root stays "/". */
export function parentPath(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  return parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : '/'
}
