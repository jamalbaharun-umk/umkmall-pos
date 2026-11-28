import { createServerFn } from '@tanstack/react-start'
import { loadWidget, type Result } from '../laporan/-api'
import type { CostAlerts } from '../resep/-recipe'
import type { Period } from './wording'

// Server functions of the dashboard widgets. pos-api computes every figure (integer rupiah); these only relay.
// The expenses card reuses the existing profit-loss loader (`loadProfitLoss`).

export type Figures = {
  sales: number
  salesCount: number
  averageBasket: number
  grossProfit: number
}
export type Bucket = Figures & { from: string; to: string }
export type Overview = {
  period: Period
  timezone: string
  from: string
  to: string
  current: Figures
  previous: Figures
  /** Percent for money (null: nothing before to compare with), the plain difference for the transaction count. */
  delta: {
    sales: number | null
    salesCount: number
    averageBasket: number | null
    grossProfit: number | null
  }
  trend: Bucket[]
}
export type Hourly = {
  date: string
  timezone: string
  hours: { hour: number; sales: number; count: number }[]
  total: number
  transactions: number
  peak: { hour: number; sales: number } | null
}
export type PaymentMix = {
  period: Period
  total: number
  parts: { name: string; value: number; count: number }[]
}
export type TopProducts = {
  period: Period
  rows: {
    productId: string
    name: string
    sku: string
    unit: string
    qty: number
    sales: number
  }[]
}
export type LowStock = {
  total: number
  out: number
  low: number
  rows: {
    productId: string
    name: string
    sku: string
    unit: string
    onHand: number
    threshold: number
    fullLevel: number
    status: 'out' | 'low'
  }[]
}
export type Expiring = {
  days: number
  /** Products whose stock expires within the window or already has. */
  total: number
  /** Of those, the products whose earliest date is already past. */
  expired: number
  rows: {
    productId: string
    name: string
    sku: string
    unit: string
    qty: number
    expiresAt: string
    daysLeft: number
    expired: boolean
  }[]
}
export type Aging = {
  total: number
  customers: number
  buckets: { key: string; label: string; amount: number; customers: number }[]
}

const get = <T>(path: string) => loadWidget({ data: path }) as unknown as Promise<Result<T>>

export const loadOverview = createServerFn()
  .validator((p: Period) => p)
  .handler(({ data }) => get<Overview>(`/reports/widgets/overview?period=${encodeURIComponent(data)}`))

export const loadHourly = createServerFn().handler(() => get<Hourly>('/reports/widgets/hourly'))

export const loadPaymentMix = createServerFn().handler(() => get<PaymentMix>('/reports/widgets/payment-mix?period=today'))

export const loadTopProducts = createServerFn().handler(() =>
  get<TopProducts>('/reports/widgets/top-products?period=week&limit=5'),
)

export const loadLowStock = createServerFn().handler(() => get<LowStock>('/reports/widgets/low-stock?limit=5'))

export const loadExpiring = createServerFn().handler(() => get<Expiring>('/reports/widgets/expiring?days=30&limit=5'))

export const loadAging = createServerFn().handler(() => get<Aging>('/reports/receivables/aging'))

/** UMK-2126 "Biaya naik": recipes whose cost per portion rose 5% or more since the cost price was set (needs catalog.manage). */
export const loadCostAlerts = createServerFn().handler(() => get<CostAlerts>('/recipes/cost-alerts?limit=5'))
