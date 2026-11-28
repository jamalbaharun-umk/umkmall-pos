import { Alert, BarChart, Button, Skeleton, TextField } from '@umkmall/ui'
import { useEffect, useRef, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { Panel } from '@/components/page'
import { rupiah } from '@/components/pos-page'
import { loadSuggestedPrice } from './-api'
import { checkTargetMargin, DEFAULT_TARGET_MARGIN, permilleText, priceCompare, type Recipe, type SuggestedPrice } from './-recipe'

const DELAY_MS = 300

type State = { kind: 'ready'; value: SuggestedPrice | null } | { kind: 'loading' } | { kind: 'error'; message: string }

/**
 * UMK-2126, design 43 screen 6: "Harga usulan". The owner types a target margin; pos-api answers the selling price that gives it
 * (cost per portion / (1 - margin), rounded UP to Rp100). The panel only displays it and, on request, hands it to `onUse`, which
 * asks the owner and changes the price through the catalog route. Nothing here changes a price by itself.
 */
export function SuggestedPricePanel({ recipe: r, onUse, busy }: { recipe: Recipe; onUse: (price: number) => void; busy: boolean }) {
  const [text, setText] = useState(String(r.suggestedPrice?.targetMargin ?? DEFAULT_TARGET_MARGIN))
  const [state, setState] = useState<State>({
    kind: 'ready',
    value: r.suggestedPrice,
  })
  const [retry, setRetry] = useState(0)
  const seq = useRef(0)
  const checked = checkTargetMargin(text)
  const margin = 'value' in checked ? checked.value : null
  // The server's first answer (default margin) is the starting point; later margins are asked for.
  const first = useRef(true)

  useEffect(() => {
    if (margin === null) return
    if (first.current && r.suggestedPrice && r.suggestedPrice.targetMargin === margin) {
      first.current = false
      setState({ kind: 'ready', value: r.suggestedPrice })
      return
    }
    first.current = false
    const mine = ++seq.current
    setState({ kind: 'loading' })
    const timer = setTimeout(async () => {
      const res = await loadSuggestedPrice({
        data: { id: r.id, targetMargin: margin },
      }).catch(() => null)
      if (mine !== seq.current) return
      if (!res)
        return setState({
          kind: 'error',
          message: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.',
        })
      setState(res.ok ? { kind: 'ready', value: res.data } : { kind: 'error', message: res.errors?.targetMargin ?? res.error })
    }, DELAY_MS)
    return () => clearTimeout(timer)
  }, [margin, r.id, r.suggestedPrice, retry])

  const ready = state.kind === 'ready' && margin !== null ? state.value : null
  const usable = ready !== null && ready.targetMargin === margin
  const incomplete = state.kind === 'ready' && state.value === null && margin !== null

  return (
    <Panel className="p-4">
      <h2 className="font-semibold text-default-primary">Harga usulan</h2>
      <p className="mt-1 text-sm text-default-secondary">
        Harga jual yang memberi margin sesuai target, dibulatkan ke atas Rp100. Harga tidak berubah kecuali Anda mengubahnya.
      </p>
      <div className="mt-3 max-w-xs">
        <TextField
          label="Target margin (%)"
          inputMode="numeric"
          value={text}
          error={margin === null && 'error' in checked ? checked.error : undefined}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      {state.kind === 'loading' && margin !== null && (
        <div className="mt-4 flex flex-col gap-2" aria-busy="true" aria-label="Memuat harga usulan">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {state.kind === 'error' && (
        <div className="mt-4 flex flex-col gap-2">
          <Alert variant="danger" size="small" role="alert">
            {state.message}
          </Alert>
          <ActionRow align="start">
            <Button width="auto" type="outline" color="primary" size="small" onClick={() => setRetry((n) => n + 1)}>
              Coba lagi
            </Button>
          </ActionRow>
        </div>
      )}
      {incomplete && (
        <p className="mt-4 text-sm text-default-secondary">Harga usulan belum bisa dihitung. Lengkapi harga bahan sampai biaya per porsi terisi.</p>
      )}
      {usable && ready && (
        <div className="mt-4 flex flex-col gap-3">
          <BarChart
            title="Biaya dan harga per porsi"
            unit="rupiah"
            orientation="horizontal"
            categoryLabel="Angka"
            categories={['Biaya per porsi', 'Harga jual sekarang', 'Harga usulan']}
            series={[
              {
                label: 'Rupiah',
                values: [r.costPerPortion, ready.currentPrice, ready.price],
              },
            ]}
          />
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-default-secondary">Harga usulan (margin {ready.targetMargin}%)</dt>
              <dd className="font-bold text-default-primary">{rupiah(ready.price)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-default-secondary">Harga jual sekarang</dt>
              <dd className="font-medium text-default-primary">
                {rupiah(ready.currentPrice)}
                {ready.marginAtCurrentPermille !== null && ` (margin ${permilleText(ready.marginAtCurrentPermille)})`}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-default-secondary">{priceCompare(ready)}</p>
          <ActionRow align="start">
            <Button width="auto" isLoading={busy} disabled={ready.price === ready.currentPrice} onClick={() => onUse(ready.price)}>
              Pakai harga jual
            </Button>
          </ActionRow>
        </div>
      )}
    </Panel>
  )
}
