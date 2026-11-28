import { Select } from '@umkmall/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { latestOnly, PICKER_DEBOUNCE_MS } from '@/lib/product-search'
import { pickerOptions } from './-recipe'
import { type PickerKind, type PickerProduct, searchPickerProducts } from './-api'

/**
 * Searches pos-api as you type (20 rows a time, never the whole catalogue) for an ingredient (`kind` ingredient) or
 * for the product a recipe is for (`kind` sale). `initial` is the first page; `known` holds the names of rows already
 * saved, so they show before any search.
 */
export function ProductSearchSelect({
  label,
  kind,
  value,
  initial,
  known = [],
  taken,
  error,
  onPick,
}: {
  label: string
  kind: PickerKind
  value: string
  initial: PickerProduct[]
  known?: PickerProduct[]
  /** Product ids that cannot be picked (they already have a recipe). */
  taken?: ReadonlySet<string>
  error?: string
  onPick: (p: PickerProduct) => void
}) {
  const [results, setResults] = useState(initial)
  const [seen, setSeen] = useState(() => new Map([...known, ...initial].map((p) => [p.id, p])))
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const order = useRef(latestOnly())
  useEffect(() => () => clearTimeout(timer.current), [])

  function onSearch(q: string) {
    clearTimeout(timer.current)
    const n = order.current.next()
    if (!q.trim()) {
      setResults(initial)
      setLoading(false)
      setFailed(false)
      return
    }
    setLoading(true)
    timer.current = setTimeout(async () => {
      try {
        const rows = await searchPickerProducts({ data: { q, kind } })
        if (!order.current.isLatest(n)) return
        setResults(rows)
        setSeen((s) => new Map([...s, ...rows.map((p) => [p.id, p] as const)]))
        setFailed(false)
      } catch {
        if (!order.current.isLatest(n)) return
        setResults([])
        setFailed(true)
      } finally {
        if (order.current.isLatest(n)) setLoading(false)
      }
    }, PICKER_DEBOUNCE_MS)
  }

  const options = useMemo(() => {
    const picked = seen.get(value)
    const rows = picked && !results.some((p) => p.id === picked.id) ? [picked, ...results] : results
    return pickerOptions(rows, taken ?? new Set())
  }, [results, seen, value, taken])

  return (
    <Select
      aria-label={label}
      size="small"
      showSearch
      placeholder={kind === 'ingredient' ? 'Pilih bahan' : 'Pilih produk'}
      searchPlaceholder="Cari nama atau SKU"
      emptyMessage={failed ? 'Gagal memuat. Coba lagi.' : kind === 'ingredient' ? 'Bahan tidak ditemukan' : 'Produk tidak ditemukan'}
      loading={loading}
      loadingMessage="Mencari…"
      error={error}
      options={options}
      value={value || undefined}
      onSearch={onSearch}
      onValueChange={(v) => {
        const p = seen.get(v)
        if (p) onPick(p)
      }}
    />
  )
}
