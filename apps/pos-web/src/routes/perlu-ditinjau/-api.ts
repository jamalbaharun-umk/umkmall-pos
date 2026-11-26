import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { NO_PERMISSION } from '@/components/page'
import { parseReview, type Review } from './-review'

// "Perlu ditinjau" (UMK-2041): one read of pos-api's `GET /payment-review` (the owner only, `payments.manage`). pos-api
// takes the store from the session and asks payment-api; nothing here names a store.

export const loadReview = createServerFn()
  .validator((d: { needsReview?: boolean; page: number }) => d)
  .handler(async ({ data }): Promise<Review> => {
    const q = new URLSearchParams({ page: String(data.page), perPage: '20' })
    if (data.needsReview !== undefined) q.set('needsReview', String(data.needsReview))
    const res = await api(`/payment-review?${q.toString()}`)
    if (res.status === 403) throw new Error(`${NO_PERMISSION}: hanya pemilik toko yang bisa melihat daftar ini.`)
    if (res.status === 503) throw new Error('Layanan pembayaran tidak menjawab. Coba lagi sebentar lagi.')
    if (!res.ok) throw new Error('Daftar belum bisa dimuat. Coba lagi sebentar lagi.')
    const review = parseReview(await res.json().catch(() => null))
    if (!review) throw new Error('Daftar tidak bisa dibaca. Coba lagi sebentar lagi.')
    return review
  })
