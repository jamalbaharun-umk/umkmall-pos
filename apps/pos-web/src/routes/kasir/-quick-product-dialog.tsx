import { Button, Dialog, TextField } from '@umkmall/ui'
import { useEffect, useRef, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { notifySuccess, showError } from '@/lib/feedback'
import { createQuickProduct, type Product } from './-api'
import { quickProductBody, quickProductServerErrors, type QuickProductErrors } from './-quick-product'

/**
 * UMK-2130 "Produk cepat" (design 44, screen 5): name, selling price and an optional cost, without leaving the till.
 * "Tambah dan jual" makes the product (pos-api puts it in "Lainnya", non-stock) and puts one in the cart.
 */
export function QuickProductDialog({
  open,
  initialName,
  onClose,
  onCreated,
}: {
  open: boolean
  /** What the cashier searched for and did not find. */
  initialName: string
  onClose: () => void
  onCreated: (product: Product) => void
}) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [errors, setErrors] = useState<QuickProductErrors>({})
  const [busy, setBusy] = useState(false)
  // A ref, not the state: two Enter presses in one tick both see the state's old value.
  const sending = useRef(false)

  useEffect(() => {
    if (!open) return
    setName(initialName)
    setPrice('')
    setCost('')
    setErrors({})
  }, [open, initialName])

  async function submit() {
    // Enter pressed twice must not make two products (PR 88 review).
    if (sending.current) return
    const parsed = quickProductBody({ name, price, cost })
    if (!parsed.ok) {
      setErrors(parsed.errors)
      return
    }
    sending.current = true
    setBusy(true)
    try {
      const r = await createQuickProduct({ data: parsed.body })
      if (!r.ok) {
        const fields = quickProductServerErrors(r.errors)
        setErrors(fields)
        // Field errors stay under their fields; everything else (403, no connection) gets the error dialog.
        if (!Object.keys(fields).length) showError(r, { action: 'menambah produk', retry: () => void submit() })
        return
      }
      notifySuccess(`${r.data.name} ditambahkan ke keranjang`)
      onCreated(r.data)
    } catch (e) {
      showError(e, { action: 'menambah produk', retry: () => void submit() })
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} centered size="small" title="Produk cepat">
      <form
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <TextField
          label="Nama"
          autoFocus
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <TextField
          label="Harga jual"
          inputMode="numeric"
          placeholder="Rp0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={errors.sellingPrice}
        />
        <TextField
          label="Harga modal (opsional)"
          inputMode="numeric"
          placeholder="Belum diisi"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          error={errors.costPrice}
        />
        <p className="text-sm text-default-secondary">Produk ini muncul di kasir sekarang. Lengkapi modal nanti.</p>
        <ActionRow>
          <Button width="auto" type="outline" color="light" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button width="auto" htmlType="submit" disabled={busy}>
            Tambah dan jual
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}
