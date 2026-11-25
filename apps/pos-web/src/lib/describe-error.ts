// Pure mapping of a failed action to the Indonesian error dialog's text (guideline "Panduan Dasar UI POS", section 2).
// No React, no I/O: unit-tested on its own. It never echoes a raw server or runtime message: only pos-api's own
// 409/422 text (Indonesian, internals-free by contract) passes, and only after the safety filter below.

/** What a failed action can carry; every key is optional because the relays return several shapes. */
export type FailureLike = {
  /** HTTP status of pos-api's answer; 0 means no answer at all. */
  status?: number
  /** A stable machine code, shown small under the text (never raw server text). */
  code?: string
  /** pos-api's refusal text (the relays call it `error`; a thrown Error carries it as `message`). */
  error?: string
  message?: string
  /** Seconds until a locked action can be tried again (429/423). */
  retryAfter?: number
  /** Set when the call never reached pos-api. */
  offline?: boolean
}

export type PrimaryAction = 'retry' | 'reload' | 'signin' | 'none'

export type ErrorDescription = {
  /** "Apa yang terjadi". */
  what: string
  /** "Yang bisa dilakukan". */
  todo: string
  /** The small help code: a stable code, the HTTP status, or OFFLINE. */
  code: string
  /** What the main button does; `none` leaves only "Tutup". */
  primary: PrimaryAction
}

export const OFFLINE_TEXT = 'Perangkat tidak terhubung ke internet. Data belum tersimpan.'
export const SERVER_UNREACHABLE_TEXT = 'Tidak bisa terhubung ke server kasir. Data belum tersimpan.'

const UNSAFE =
  /bearer|token|jwt|eyj|authorization|cookie|password|secret|stack|exception|sql|postgres|econn|enotfound|\bselect\b.*\bfrom\b|\binsert into|\bdelete from|fetch failed|undefined|\bnull\b|\[object|<\/?\w+|\bat \S+:\d+/i

/** Whether a server-sent sentence may be shown: short, no internals, no token-like or phone/PIN-like digit run. */
export function isSafeText(text: unknown): text is string {
  if (typeof text !== 'string') return false
  const t = text.trim()
  if (!t || t.length > 220) return false
  if (UNSAFE.test(t)) return false
  return !/\d{6,}|\d(?:[ -]?\d){7,}/.test(t)
}

const browserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** A thrown value that means "no connection" (the browser's fetch error, or the server function's own text). */
function looksOffline(error: Error): boolean {
  if (error instanceof TypeError) return true
  return /failed to fetch|networkerror|network request failed|load failed|tidak bisa terhubung|tidak terhubung/i.test(
    error.message,
  )
}

function codeOf(f: FailureLike, fallback: string): string {
  return typeof f.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(f.code) ? f.code : fallback
}

const waitHint = (seconds?: number) =>
  typeof seconds === 'number' && seconds > 0
    ? seconds >= 90
      ? ` Bisa dicoba lagi dalam ${Math.ceil(seconds / 60)} menit.`
      : ` Bisa dicoba lagi dalam ${Math.ceil(seconds)} detik.`
    : ''

function normalize(error: unknown): FailureLike {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status
    return {
      message: error.message,
      status: typeof status === 'number' ? status : undefined,
      offline: looksOffline(error) || undefined,
    }
  }
  if (typeof error === 'string') return { error }
  if (error && typeof error === 'object') return error as FailureLike
  return {}
}

/**
 * Turns any failure into the dialog's text. `fallback` is the caller's own Indonesian sentence for "what happened"
 * when the failure says nothing usable (it must not contain internals either).
 */
export function describeError(error: unknown, fallback: string): ErrorDescription {
  const f = normalize(error)
  const status = typeof f.status === 'number' ? f.status : undefined
  const text = isSafeText(f.error) ? f.error.trim() : isSafeText(f.message) ? f.message.trim() : undefined

  if (f.offline || status === 0 || f.code === 'OFFLINE' || (status === undefined && browserOffline())) {
    return {
      what: browserOffline() || status !== 0 ? OFFLINE_TEXT : SERVER_UNREACHABLE_TEXT,
      todo: 'Cek sinyal, lalu coba lagi. Isian Anda masih ada.',
      code: 'OFFLINE',
      primary: 'retry',
    }
  }
  if (f.code === 'PIN_INVALID') {
    return {
      what: 'PIN yang dimasukkan tidak cocok.',
      todo: 'Periksa PIN lalu coba lagi, atau minta admin lain.',
      code: 'PIN_INVALID',
      primary: 'none',
    }
  }
  switch (status) {
    case 401:
      return {
        what: 'Demi keamanan, sesi Anda berakhir.',
        todo: 'Masuk lagi. Isian yang belum disimpan mungkin hilang.',
        code: codeOf(f, '401'),
        primary: 'signin',
      }
    case 403:
      return {
        what: 'Akun Anda tidak boleh melakukan ini.',
        todo: 'Minta pemilik memberi izin, atau masuk dengan akun pemilik.',
        code: codeOf(f, '403'),
        primary: 'none',
      }
    case 404:
      return {
        what: 'Data tidak ditemukan atau sudah dihapus.',
        todo: 'Muat ulang halaman untuk melihat data terbaru.',
        code: codeOf(f, '404'),
        primary: 'reload',
      }
    case 409:
      return {
        what: text ?? 'Aksi ini bentrok dengan data yang sudah ada atau sudah diubah.',
        todo: 'Muat ulang halaman, periksa datanya, lalu ulangi bila perlu.',
        code: codeOf(f, '409'),
        primary: 'reload',
      }
    case 400:
    case 422:
      return {
        what: text ?? 'Isian belum benar.',
        todo: 'Perbaiki isian yang ditandai merah, lalu simpan lagi.',
        code: codeOf(f, String(status)),
        primary: 'none',
      }
    case 423:
    case 429:
      return {
        what: 'Terlalu banyak percobaan, jadi dikunci sementara.',
        todo: `Tunggu sebentar, lalu coba lagi.${waitHint(f.retryAfter)}`,
        code: codeOf(f, String(status)),
        primary: 'none',
      }
  }
  if (status !== undefined && status >= 500) {
    return {
      what: 'Ada gangguan di sistem kami. Data Anda aman dan tidak tersimpan setengah.',
      todo: 'Coba lagi sebentar. Jika berulang, sebutkan kode ini ke bantuan.',
      code: codeOf(f, String(status)),
      primary: 'retry',
    }
  }
  // No status (a relay that kept only pos-api's text, or an unknown failure): trust only text that passes the filter.
  return {
    what: text ?? fallback,
    todo: 'Coba lagi sebentar. Jika berulang, sebutkan kode ini ke bantuan.',
    code: codeOf(f, 'UNKNOWN'),
    primary: 'retry',
  }
}
