import { Alert, Button, TextField } from '@umkmall/ui/primitives'
import { useEffect, useState, type FormEvent } from 'react'
import { ActionRow } from '@/components/action-row'
import { Panel } from '@/components/page'
import { notifySuccess, showError } from '@/lib/feedback'
import { GENERIC_ERROR } from '@/lib/refusal'
import { saveDailyTarget, type SaveFailure } from './-api'
import { useSummary } from './-panels'
import { parseTarget } from './-summary'

const BAD = 'Isi dengan angka rupiah bulat, antara Rp1 dan Rp1.000.000.000'

/** Pengaturan, tab Aplikasi: the owner's optional daily sales target. Empty = no target (nothing shows on the receipt). */
export function DailyTargetForm() {
  const { loaded, reload } = useSummary('daily-target')
  const [text, setText] = useState('')
  const [saved, setSaved] = useState<number | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loaded.state !== 'ready') return
    setSaved(loaded.data.target)
    setText(loaded.data.target === null ? '' : loaded.data.target.toLocaleString('id-ID'))
  }, [loaded])

  async function save(target: number | null) {
    if (busy) return
    setBusy(true)
    const res = await saveDailyTarget({ data: target }).catch((): SaveFailure => ({
      ok: false,
      status: 0,
      error: GENERIC_ERROR,
    }))
    setBusy(false)
    if (!res.ok) {
      setError(res.errors?.target ?? res.error)
      return showError(res, {
        action: 'menyimpan target harian',
        retry: () => void save(target),
      })
    }
    setError(undefined)
    setSaved(res.data.target)
    setText(res.data.target === null ? '' : res.data.target.toLocaleString('id-ID'))
    notifySuccess(res.data.target === null ? 'Target harian dihapus' : 'Target harian disimpan')
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseTarget(text)
    if (parsed === 'invalid') {
      setError(BAD)
      return showError(
        {
          status: 422,
          error: 'Target harian belum benar. Periksa isian yang ditandai merah.',
        },
        'menyimpan target harian',
      )
    }
    void save(parsed)
  }

  return (
    <form noValidate onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <Panel className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-lg font-semibold text-default-primary">Target penjualan harian</h2>
          <p className="text-sm text-default-secondary">
            Boleh dikosongkan. Bila diisi, kasir melihat kemajuan hari ini terhadap target setelah penjualan selesai.
          </p>
        </div>
        {loaded.state === 'error' ? (
          <div className="flex flex-col gap-3">
            <Alert variant="danger" size="small">
              Target harian tidak bisa dimuat.
            </Alert>
            <ActionRow align="start">
              <Button type="outline" color="primary" size="small" width="auto" onClick={reload}>
                Muat ulang
              </Button>
            </ActionRow>
          </div>
        ) : (
          <div className="md:w-1/2">
            <TextField
              label="Target per hari"
              prefix="Rp"
              prefixPlacement="outside"
              inputMode="numeric"
              value={text}
              disabled={loaded.state === 'loading'}
              onChange={(e) => {
                setText(e.target.value)
                setError(undefined)
              }}
              placeholder="Contoh: 2.000.000"
              error={error}
            />
          </div>
        )}
      </Panel>
      <ActionRow align="start">
        {saved !== null && (
          <Button
            type="outline"
            color="light"
            size="small"
            width="auto"
            disabled={busy}
            onClick={() => void save(null)}
          >
            Hapus target
          </Button>
        )}
        <Button
          htmlType="submit"
          type="primary"
          color="primary"
          size="small"
          width="auto"
          isLoading={busy}
          disabled={loaded.state !== 'ready'}
        >
          Simpan target
        </Button>
      </ActionRow>
    </form>
  )
}
