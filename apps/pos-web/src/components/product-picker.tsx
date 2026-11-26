import { Select } from '@umkmall/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { searchStockProducts } from '../routes/pembelian/-api'
import { latestOnly, PICKER_DEBOUNCE_MS, pickerOptions, remember, type PickerProduct } from '../lib/product-search'

/**
 * A product picker for a line of a purchase or a stock opname. Searches pos-api as you type (name, SKU or
 * barcode, 20 rows a time) instead of holding the whole catalogue, so a store of 500+ products stays light.
 * `initial` is the first page (shown before anything is typed); `known` holds products of lines that are
 * already saved, so their names show before any search.
 */
export function ProductPicker({
  label,
  value,
  initial,
  known,
  error,
  onPick,
}: {
  label: string
  value: string
  initial: PickerProduct[]
  known?: PickerProduct[]
  error?: string
  onPick: (product: PickerProduct) => void
}) {
  const [results, setResults] = useState<PickerProduct[]>(initial)
  const [seen, setSeen] = useState<ReadonlyMap<string, PickerProduct>>(() =>
    remember(new Map(), [...(known ?? []), ...initial]),
  )
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
        const page = await searchStockProducts({ data: { q } })
        if (!order.current.isLatest(n)) return
        setResults(page.data)
        setSeen((s) => remember(s, page.data))
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

  const options = useMemo(() => pickerOptions(results, seen.get(value)), [results, seen, value])

  return (
    <Select
      aria-label={label}
      size="small"
      showSearch
      placeholder="Pilih produk"
      searchPlaceholder="Cari nama, SKU, atau barcode"
      emptyMessage={failed ? 'Gagal memuat produk. Coba lagi.' : 'Produk tidak ditemukan'}
      loading={loading}
      loadingMessage="Mencari produk…"
      error={error}
      options={options}
      value={value || undefined}
      onSearch={onSearch}
      onValueChange={(v) => {
        const picked = seen.get(v)
        if (picked) onPick(picked)
      }}
    />
  )
}
