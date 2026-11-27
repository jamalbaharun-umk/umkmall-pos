/**
 * A failed load that means "this record is not there" (pos-api 404: a missing id, or another store's). Server
 * functions rethrow only the message, so the screens' 404 wording is what we can read ("Shift tidak ditemukan.",
 * "Data tidak ditemukan, mungkin sudah dihapus."). Retrying such a load can never succeed.
 */
export const isNotFoundError = (error: unknown): boolean =>
  error instanceof Error && /tidak ditemukan/i.test(error.message)
