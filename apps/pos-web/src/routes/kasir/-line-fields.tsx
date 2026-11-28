import { Button, Dialog, SelectionCard, TextField } from '@umkmall/ui'
import { useEffect, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { rupiah } from '@/components/pos-page'
import type { Product } from './-api'
import { unitOptions } from './-helpers'
import { qtyError } from './-money'

// The cart's quantity field and the unit picker, shared by the till and the helper's sales-only till (UMK-2124).

/**
 * The cart quantity: free typing (it may be empty while editing), applied only when it is a whole number 1–100.000;
 * anything else is shown as an error and the cart keeps the last good quantity until blur restores it.
 */
export function QtyField({ name, qty, onChange }: { name: string; qty: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(qty))
  useEffect(() => setText(String(qty)), [qty])
  const error = qtyError(text)
  return (
    <TextField
      aria-label={`Jumlah ${name}`}
      size="xsmall"
      inputMode="numeric"
      className="w-16"
      value={text}
      error={text === String(qty) ? undefined : error}
      onChange={(e) => {
        setText(e.target.value)
        if (!qtyError(e.target.value)) onChange(Number(e.target.value.trim()))
      }}
      onBlur={() => setText(String(qty))}
    />
  )
}

/** UMK-1985: which unit to add (the base unit is chosen first) and how many of it. Prices are the list prices. */
export function UnitPicker({
  product,
  onClose,
  onAdd,
}: {
  product?: Product
  onClose: () => void
  onAdd: (product: Product, unit: string | null, qty: number) => void
}) {
  const [choice, setChoice] = useState('')
  const [qtyText, setQtyText] = useState('1')
  useEffect(() => {
    setChoice('')
    setQtyText('1')
  }, [product?.id])
  const options = product ? unitOptions(product) : []
  const qtyBad = qtyError(qtyText)
  const picked = options.find((o) => (o.unit ?? '') === choice) ?? options[0]
  return (
    <Dialog
      open={!!product}
      onOpenChange={(o) => !o && onClose()}
      centered
      size="small"
      title={product?.name ?? 'Pilih satuan'}
    >
      {product && picked && (
        <form
          noValidate
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (!qtyBad) onAdd(product, picked.unit, Number(qtyText.trim()))
          }}
        >
          <SelectionCard
            label="Pilih satuan"
            options={options.map((o) => ({
              value: o.unit ?? '',
              label: o.unitQty > 1 ? `${o.label} (isi ${o.unitQty})` : o.label,
              badge: rupiah(o.price),
              description:
                o.saving > 0 ? `Hemat ${rupiah(o.saving)} dibanding ${o.unitQty} ${product.unit}` : undefined,
            }))}
            value={[picked.unit ?? '']}
            onValueChange={(v) => setChoice(v[0] ?? '')}
          />
          <TextField
            label="Jumlah"
            inputMode="numeric"
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            error={qtyBad}
          />
          <ActionRow>
            <Button width="auto" type="outline" color="light" onClick={onClose}>
              Batal
            </Button>
            <Button width="auto" htmlType="submit">
              Tambah ke pesanan
            </Button>
          </ActionRow>
        </form>
      )}
    </Dialog>
  )
}
