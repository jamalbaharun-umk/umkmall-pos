import { Button, Dialog, TextField, toast } from '@umkmall/ui'
import { useEffect, useState } from 'react'
import { ErrorText, rupiah } from '@/components/pos-page'
import { checkVoucher, pickMembers, type MemberOption } from './-api'

// U7 pieces of the cashier (member picker, voucher field), kept out of index.tsx so the cashier screen
// (ui-parity-b) only gains a few lines. pos-api re-validates both inside the sale.

export type AppliedVoucher = { code: string; discount: number }

/** Lakasir's "Member" row: pick a member (needed for kasbon) or clear it. */
export function MemberRow({ member, onChange }: { member: MemberOption | null; onChange: (m: MemberOption | null) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [options, setOptions] = useState<MemberOption[]>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open) return
    let live = true
    const t = setTimeout(() => {
      pickMembers({ data: q.trim() })
        .then((rows) => live && (setOptions(rows), setError(undefined)))
        .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Gagal memuat pelanggan.'))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [open, q])

  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-default-secondary">Pelanggan</dt>
      <dd className="flex min-w-0 items-center gap-2 text-right">
        <button type="button" onClick={() => setOpen(true)} className="max-w-48 truncate text-default-brand hover:underline">
          {member ? `${member.name} (${member.code})` : 'Pilih pelanggan'}
        </button>
        {member && (
          <button type="button" aria-label="Hapus pelanggan" className="text-default-secondary" onClick={() => onChange(null)}>
            ×
          </button>
        )}
      </dd>
      <Dialog open={open} onOpenChange={setOpen} centered title="Pilih pelanggan">
        <div className="space-y-3 px-6 pb-6">
          <TextField
            aria-label="Cari pelanggan"
            placeholder="Cari nama atau kode"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <ErrorText>{error}</ErrorText>
          {options === undefined ? (
            <p className="text-sm text-default-secondary" role="status">
              Memuat…
            </p>
          ) : options.length === 0 ? (
            <p className="text-sm text-default-secondary">Pelanggan tidak ditemukan. Tambahkan di menu Pelanggan.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-default-primary overflow-y-auto">
              {options.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-3 py-2 text-left hover:text-default-brand"
                    onClick={() => {
                      onChange(m)
                      setOpen(false)
                    }}
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="text-sm text-default-secondary">{m.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
    </div>
  )
}

/** Lakasir's "Voucher" row: apply a code (checked against the current subtotal) or remove it. */
export function VoucherRow({
  voucher,
  amount,
  onChange,
}: {
  voucher: AppliedVoucher | null
  amount: number
  onChange: (v: AppliedVoucher | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  // The cart changed: the discount (percentage, minimum) is checked again; a voucher that no longer applies is removed.
  useEffect(() => {
    if (!voucher) return
    let live = true
    void checkVoucher({ data: { code: voucher.code, amount } }).then((res) => {
      if (!live) return
      if (res.ok) {
        if (res.data.discount !== voucher.discount) onChange({ code: voucher.code, discount: res.data.discount })
      } else {
        onChange(null)
        toast(`Voucher ${voucher.code} dilepas: ${res.error}`, { variant: 'warning' })
      }
    })
    return () => {
      live = false
    }
    // Re-check only when the amount changes (voucher and onChange are read at that moment).
  }, [amount])

  async function apply(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const c = code.trim().toUpperCase()
    if (!c) return setError('Wajib diisi')
    if (/\s/.test(c)) return setError('Kode tanpa spasi')
    setBusy(true)
    setError(undefined)
    const res = await checkVoucher({ data: { code: c, amount } }).catch(() => ({
      ok: false as const,
      error: 'Tidak bisa terhubung. Coba lagi.',
    }))
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      toast(res.error, { variant: 'danger' })
      return
    }
    onChange({ code: c, discount: res.data.discount })
    setOpen(false)
    toast(`Voucher ${c} dipakai: potongan ${rupiah(res.data.discount)}`, { variant: 'success' })
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-default-secondary">Voucher</dt>
      <dd className="flex min-w-0 items-center gap-2 text-right">
        <button
          type="button"
          disabled={amount === 0}
          onClick={() => {
            setCode(voucher?.code ?? '')
            setError(undefined)
            setOpen(true)
          }}
          className="max-w-48 truncate text-default-brand hover:underline disabled:text-default-secondary disabled:no-underline"
        >
          {voucher ? `${voucher.code} (−${rupiah(voucher.discount)})` : 'Pakai voucher'}
        </button>
        {voucher && (
          <button
            type="button"
            aria-label="Lepas voucher"
            className="text-default-secondary"
            onClick={() => {
              onChange(null)
              toast(`Voucher ${voucher.code} dilepas`, { variant: 'info' })
            }}
          >
            ×
          </button>
        )}
      </dd>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)} centered size="small" title="Pakai voucher">
        <form onSubmit={apply} noValidate className="space-y-3 px-6 pb-6">
          <TextField
            label="Kode voucher"
            placeholder="Contoh: HEMAT10"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              setError(undefined)
            }}
            error={error}
            required
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="outline" color="dark" width="auto" disabled={busy} onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button htmlType="submit" width="auto" isLoading={busy} disabled={busy}>
              Pakai
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
