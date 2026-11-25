// Pure helpers of the "Pembayaran Online" screen (UMK-2020): status vocabulary, the short draft's checks, the
// hosted-verification link guard and the error text. No React, no I/O: unit-tested on their own.
// The POS never asks for an identity document, identity number or bank account: the draft has four fields only.

import { describeError, isSafeText, type ErrorDescription, type FailureLike } from './describe-error'

export const PERMISSION = 'payments.manage'

export type MerchantStatus =
  | 'not_submitted'
  | 'submitted'
  | 'needs_fix'
  | 'rejected'
  | 'verified'
  | 'active'
  | 'suspended'

export type MerchantMethod = { method: string; enabled: boolean; chargeable: boolean }
export type MerchantAccount = {
  provider: string
  mode: string
  status: string
  statusReason: string | null
  verification: string
  profile: { businessType: string | null; businessName: string | null; email: string | null; phone: string | null }
  termsAcceptedAt: string | null
  submittedAt: string | null
  methods: MerchantMethod[]
  lastSyncedAt: string | null
  updatedAt: string | null
}

export type BadgeTone = 'success' | 'warning' | 'danger' | 'light'

type StatusView = {
  label: string
  tone: BadgeTone
  /** What the screen's main button is for this status. */
  step: 'fill' | 'verify' | 'fix' | 'help' | 'methods' | 'locked'
}

const STATUS: Record<MerchantStatus, StatusView> = {
  not_submitted: { label: 'Belum diajukan', tone: 'light', step: 'fill' },
  submitted: { label: 'Diajukan', tone: 'warning', step: 'verify' },
  needs_fix: { label: 'Perlu perbaikan', tone: 'warning', step: 'fix' },
  rejected: { label: 'Ditolak', tone: 'danger', step: 'help' },
  verified: { label: 'Terverifikasi', tone: 'success', step: 'methods' },
  active: { label: 'Aktif', tone: 'success', step: 'methods' },
  suspended: { label: 'Ditangguhkan', tone: 'danger', step: 'locked' },
}

/** How a status looks and what comes next. An unknown status (a newer payment-api) is shown as is, read-only. */
export function statusView(status: string): StatusView {
  return (STATUS as Record<string, StatusView>)[status] ?? { label: 'Status tidak dikenal', tone: 'light', step: 'locked' }
}

/** Methods may be switched only while the account is verified or active (design 22: the first one needs `verified`). */
export const canSwitchMethods = (status: string) => status === 'verified' || status === 'active'

/** The draft is editable only before it is submitted. */
export const canEditDraft = (status: string) => status === 'not_submitted'

const MODES: Record<string, string> = { fake: 'Mode: Tiruan', sandbox: 'Mode: Sandbox', live: 'Mode: Live' }
export const modeLabel = (mode: string) => MODES[mode] ?? 'Mode: -'

const PROVIDERS: Record<string, string> = { xendit: 'Xendit', fake: 'Gateway tiruan' }
export const providerLabel = (provider: string) =>
  PROVIDERS[provider] ?? (provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'Penyedia')

const METHODS: Record<string, string> = {
  fake_qris: 'QRIS dinamis',
  qris: 'QRIS dinamis',
  fake_va: 'Virtual Account (VA)',
  va: 'Virtual Account (VA)',
}
export const methodLabel = (method: string) => METHODS[method] ?? method.replace(/_/g, ' ')

/** The small line under a method's name. */
export function methodHint(m: MerchantMethod, status: string): string {
  if (!canSwitchMethods(status)) return 'Belum bisa dinyalakan'
  return m.enabled ? 'Menyala di kasir' : 'Mati'
}

// --- the short draft -----------------------------------------------------------------------------------------

export const BUSINESS_TYPES = [
  { value: 'individual', label: 'Perorangan' },
  { value: 'company', label: 'Badan usaha (PT atau CV)' },
]

export type DraftForm = { businessType: string; businessName: string; email: string; phone: string; terms: boolean }
export type DraftErrors = Partial<Record<keyof DraftForm, string>>

export const emptyDraft = (): DraftForm => ({ businessType: '', businessName: '', email: '', phone: '', terms: false })

export function draftOf(a: MerchantAccount | undefined): DraftForm {
  const p = a?.profile
  return {
    businessType: p?.businessType ?? '',
    businessName: p?.businessName ?? '',
    email: p?.email ?? '',
    phone: p?.phone ?? '',
    terms: false,
  }
}

/** "0812 3456-7890" and "+62 812 ..." become digits (with an optional leading +), the shape pos-api accepts. */
export const normalizePhone = (v: string) => v.replace(/[\s\-().]/g, '')

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[0-9]{8,15}$/

/** Checks of the filled fields (a saved draft may be partial): only a wrong value is an error here. */
export function draftErrors(f: DraftForm): DraftErrors {
  const e: DraftErrors = {}
  if (f.businessName.trim().length > 120) e.businessName = 'Nama usaha maksimal 120 karakter'
  if (f.email.trim() && (f.email.trim().length > 254 || !EMAIL.test(f.email.trim()))) e.email = 'Format email belum benar'
  if (f.phone.trim() && !PHONE.test(normalizePhone(f.phone))) e.phone = 'Nomor HP harus 8 sampai 15 angka'
  return e
}

/** Submitting needs all four fields and the terms. */
export function submitErrors(f: DraftForm): DraftErrors {
  const e = draftErrors(f)
  if (!f.businessType) e.businessType = 'Pilih jenis usaha'
  if (!f.businessName.trim()) e.businessName = 'Nama usaha wajib diisi'
  if (!f.email.trim()) e.email = 'Email wajib diisi'
  if (!f.phone.trim()) e.phone = 'Nomor HP wajib diisi'
  if (!f.terms) e.terms = 'Syarat UMKMall harus disetujui'
  return e
}

/** The body of the draft route: only the four fields, trimmed; an empty text is sent as null (clears it). */
export function draftBody(f: DraftForm) {
  const t = (v: string) => v.trim() || null
  return {
    businessType: f.businessType === 'individual' || f.businessType === 'company' ? f.businessType : null,
    businessName: t(f.businessName),
    email: t(f.email),
    phone: f.phone.trim() ? normalizePhone(f.phone) : null,
  }
}

// --- the hosted verification page ------------------------------------------------------------------------------

/** The gateway's page is opened only when it is a plain http(s) address (never `javascript:` or `data:`). */
export function safeHostedUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

// --- errors ----------------------------------------------------------------------------------------------------

type Known = { what: string; todo: string; primary: ErrorDescription['primary'] }

const BY_CODE: Record<string, Known> = {
  not_found: {
    what: 'Penyedia pembayaran ini tidak ditemukan.',
    todo: 'Muat ulang halaman untuk melihat daftar terbaru.',
    primary: 'reload',
  },
  merchant_locked: {
    what: 'Data usaha tidak bisa diubah pada status ini.',
    todo: 'Muat ulang halaman untuk melihat status terbaru.',
    primary: 'reload',
  },
  draft_incomplete: {
    what: 'Data usaha belum lengkap.',
    todo: 'Isi jenis usaha, nama usaha, email, dan nomor HP, lalu ajukan lagi.',
    primary: 'none',
  },
  merchant_not_verified: {
    what: 'Metode baru bisa dinyalakan setelah akun terverifikasi.',
    todo: 'Selesaikan verifikasi di halaman gateway, lalu tekan Cek status.',
    primary: 'none',
  },
  verification_not_open: {
    what: 'Akun ini tidak sedang menunggu verifikasi.',
    todo: 'Muat ulang halaman untuk melihat status terbaru.',
    primary: 'reload',
  },
  verification_not_hosted: {
    what: 'Penyedia ini tidak punya halaman verifikasi.',
    todo: 'Hubungi bantuan UMKMall dan sebutkan kode di bawah.',
    primary: 'none',
  },
  verification_unsupported: {
    what: 'Cara pendaftaran ini belum didukung.',
    todo: 'Hubungi bantuan UMKMall dan sebutkan kode di bawah.',
    primary: 'none',
  },
  live_disabled: {
    what: 'Pembayaran sungguhan belum diaktifkan.',
    todo: 'Tunggu kabar dari UMKMall, atau hubungi bantuan UMKMall.',
    primary: 'none',
  },
  mode_unsupported: {
    what: 'Penyedia ini belum tersedia di lingkungan ini.',
    todo: 'Pilih penyedia lain, atau hubungi bantuan UMKMall.',
    primary: 'none',
  },
}

export type OnlineFailure = FailureLike & { code?: string }

/**
 * The error dialog's text for a failed action on this screen. pos-api's own Indonesian refusals carry a stable lower
 * case `code` (payment-api's); those, and 403, 409, 422 and 503, get sentences written for this screen. Anything else
 * goes through the shared `describeError`. The raw server text is never shown unless it passes the safety filter.
 */
export function describeOnlineError(failure: unknown, fallback: string): ErrorDescription {
  const f = (failure && typeof failure === 'object' ? failure : {}) as OnlineFailure
  const code = typeof f.code === 'string' ? f.code : undefined
  const shownCode = code && /^[a-z][a-z0-9_]{0,39}$/.test(code) ? code.toUpperCase() : undefined
  const known = code ? BY_CODE[code] : undefined
  if (known && shownCode) return { ...known, code: shownCode }

  switch (f.status) {
    case 403:
      return {
        what: 'Pembayaran Online hanya bisa diatur oleh pemilik toko.',
        todo: 'Masuk dengan akun pemilik toko.',
        code: shownCode ?? '403',
        primary: 'none',
      }
    case 409:
      return {
        what: isSafeText(f.error) ? f.error.trim() : 'Status pembayaran online sudah berubah.',
        todo: 'Muat ulang halaman, periksa statusnya, lalu ulangi bila perlu.',
        code: shownCode ?? '409',
        primary: 'reload',
      }
    case 422:
      return {
        what: isSafeText(f.error) ? f.error.trim() : 'Isian belum benar.',
        todo: 'Perbaiki isian yang ditandai merah. Isian Anda masih ada.',
        code: shownCode ?? '422',
        primary: 'none',
      }
    case 503:
      return {
        what: 'Gateway pembayaran tidak menjawab. Isian Anda aman dan tidak hilang.',
        todo: 'Coba lagi beberapa saat lagi. Bila terus gagal, hubungi bantuan UMKMall.',
        code: shownCode ?? 'GATEWAY_UNAVAILABLE',
        primary: 'retry',
      }
  }
  return describeError(failure, fallback)
}
