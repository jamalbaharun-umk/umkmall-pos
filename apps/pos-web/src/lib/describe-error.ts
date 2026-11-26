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
  /** What to do next, for a 400/422 whose problem is not a marked field (replaces "Perbaiki isian yang ditandai merah"). */
  todo?: string
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

/**
 * The payment-gateway flow's stable lower-case codes (UMK-1991: 409 and 503 bodies of /sales/:id/payment/*, refunds and
 * a sale refused at the PG). Each says what happened and what to do in the cashier's words; the server's own long text
 * is never used for these. `primary` is the dialog's main button.
 */
export const PAYMENT_CODES: Record<string, { what: string; todo: string; primary: PrimaryAction; helpCode?: string }> = {
  payment_unavailable: {
    what: 'Layanan pembayaran tidak menjawab, jadi tidak ada yang berubah.',
    todo: 'Coba lagi sebentar. Jika berulang, hubungi pemilik.',
    primary: 'retry',
  },
  // a cancel, a refund retry or a manual mark got no answer: the request may have reached payment-api
  payment_unclear: {
    what: 'Layanan pembayaran tidak menjawab. Permintaan Anda mungkin sudah sampai, jadi belum pasti apa yang berubah.',
    todo: 'Periksa statusnya dulu (Cek status atau muat ulang halaman), baru ulangi bila perlu.',
    primary: 'none',
  },
  // the switch to cash got no answer: the bill may already be closed
  cash_switch_unanswered: {
    what: 'Layanan pembayaran tidak menjawab, jadi penjualan belum menjadi tunai.',
    todo: 'Tekan Cek status dulu sebelum menerima uang. Jika tagihan sudah tertutup, penjualan ini dibatalkan dan harus dibuat ulang.',
    primary: 'none',
  },
  // the sale IS a cash sale; only the record of its cash is missing
  cash_payment_pending: {
    what: 'Penjualan ini sudah menjadi tunai, tetapi catatan uangnya belum tersimpan.',
    todo: 'Tekan Simpan tunai lagi sampai berhasil. Jangan membuat penjualan baru.',
    primary: 'retry',
  },
  // the sale was written but the charge got no answer: the same key repeats it, never a second sale
  sale_waiting: {
    what: 'Sistem pembayaran online tidak menjawab. Stok ditahan untuk penjualan ini dan belum pasti ada tagihan.',
    todo: 'Coba lagi dengan cara bayar yang sama; tagihan tidak akan ganda. Bila Anda memilih cara bayar lain, penjualan ini tetap tercatat di Menunggu sampai sistem menutupnya atau Anda membatalkannya di sana.',
    primary: 'retry',
    helpCode: 'PAYMENT_UNAVAILABLE',
  },
  already_paid: {
    what: 'Pelanggan sudah membayar. Gateway memastikan tagihan ini sudah lunas, jadi permintaan ditolak. Penjualan selesai dengan pembayaran online.',
    todo: 'Jika Anda sudah menerima uang tunai, kembalikan ke pelanggan.',
    primary: 'reload',
  },
  not_awaiting: {
    what: 'Penjualan ini tidak lagi menunggu pembayaran.',
    todo: 'Muat ulang untuk melihat keadaan terbarunya.',
    primary: 'reload',
  },
  not_online: {
    what: 'Penjualan ini tidak dibayar lewat QRIS atau VA.',
    todo: 'Tidak ada pembayaran online yang perlu diganti.',
    primary: 'none',
  },
  not_own_sale: {
    what: 'Hanya kasir yang membuat penjualan ini yang bisa menerima tunainya.',
    todo: 'Minta kasir tersebut, atau batalkan penjualannya.',
    primary: 'none',
  },
  cancel_refused: {
    what: 'Tagihan belum bisa ditutup, jadi penjualan masih menunggu pembayaran.',
    todo: 'Tekan Cek status, lalu coba lagi.',
    primary: 'none',
  },
  payment_refused: {
    what: 'Layanan pembayaran menolak permintaan ini.',
    todo: 'Coba lagi atau hubungi pemilik.',
    primary: 'none',
  },
  use_void: {
    what: 'Pembayaran tunai tidak bisa direfund.',
    todo: 'Gunakan Void (Batalkan transaksi).',
    primary: 'reload',
  },
  use_refund: {
    what: 'Pembayaran online tidak bisa di-void.',
    todo: 'Gunakan Refund struk.',
    primary: 'reload',
  },
  not_refund_failed: {
    what: 'Hanya refund yang ditolak gateway yang bisa ditandai dikembalikan manual.',
    todo: 'Muat ulang untuk melihat status refund terbaru.',
    primary: 'reload',
  },
  merchant_not_active: {
    what: 'Pembayaran online belum aktif untuk toko ini. Penjualan dibatalkan dan stok kembali.',
    todo: 'Pilih cara bayar lain. Pemilik bisa mengaktifkannya di Pembayaran Online.',
    primary: 'none',
  },
  method_disabled: {
    what: 'Metode ini sedang dimatikan di Pembayaran Online. Penjualan dibatalkan dan stok kembali.',
    todo: 'Pilih cara bayar lain, atau minta pemilik menyalakannya.',
    primary: 'none',
  },
  live_disabled: {
    what: 'Pembayaran online uang nyata belum diizinkan. Penjualan dibatalkan dan stok kembali.',
    todo: 'Pilih cara bayar lain.',
    primary: 'none',
  },
  merchant_mode_mismatch: {
    what: 'Akun pembayaran online toko ini tidak cocok dengan lingkungan ini. Penjualan dibatalkan dan stok kembali.',
    todo: 'Pilih cara bayar lain, lalu hubungi pemilik.',
    primary: 'none',
  },
}

/**
 * A shift close refused because sales still wait for payment (UMK-2058): name them as the waiting list does
 * ("Menunggu #3", not a bare "#3") and say what to do. The sales are listed with links on the closing screen.
 */
export function awaitingCloseText(serverText?: string): ErrorDescription {
  const named = serverText?.replace(/#(\d+)/g, 'Menunggu #$1')
  return {
    what: named ?? 'Shift belum bisa ditutup karena masih ada penjualan yang menunggu pembayaran.',
    todo: 'Selesaikan pembayarannya atau batalkan penjualan yang menunggu lewat daftar di halaman Tutup shift (tombol Buka atau Ke kasir), lalu tutup shift lagi.',
    code: 'SALES_AWAITING_PAYMENT',
    primary: 'none',
  }
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
  if (f.code === 'sales_awaiting_payment' && status === 409) return awaitingCloseText(text)
  const paymentCode = typeof f.code === 'string' ? PAYMENT_CODES[f.code] : undefined
  // A bad permission or a missing sale keeps its own, stricter text below; every other status takes the payment code's.
  if (paymentCode && status !== 401 && status !== 403 && status !== 404 && status !== 422 && status !== 429) {
    const { helpCode, ...text } = paymentCode
    return { ...text, code: helpCode ?? f.code!.toUpperCase() }
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
        todo: f.todo ?? 'Perbaiki isian yang ditandai merah, lalu simpan lagi.',
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
