import { Alert, Button, Skeleton } from '@umkmall/ui/primitives'
import { useRouter } from '@tanstack/react-router'
import { CheckCircle2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { notifySuccess, showError } from '@/lib/feedback'
import { WARN_SECONDS, formatCountdown, groupCode, secondsLeft } from '@/lib/pairing'
import { currentPairing, pairingStatus, startPairing, type PairingResult, type PairingStatus } from '../staf/-pairing-api'
import { ActionRow } from '@/components/action-row'

const POLL_MS = 3000
const POLL_SLOW_MS = 8000

type Phase =
  | { kind: 'loading' }
  | { kind: 'showing'; code: string; deadline: number }
  | { kind: 'ended' } // the code ran out, or its pairing is gone: ask for a new one
  | { kind: 'failed' } // no code could be asked for
  | { kind: 'paired'; deviceName: string }

const down = (): PairingResult => ({ ok: false, status: 0, error: 'Tidak bisa terhubung ke server kasir.' })

/**
 * What a signed-out, unpaired device shows at /kasir/masuk (UMK-2022): a 6-digit code with its countdown. The owner
 * types the code on their own signed-in device (Pengguna > Perangkat); this screen polls and moves on by itself.
 */
export function PairingScreen() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [now, setNow] = useState(() => Date.now())
  const [checking, setChecking] = useState(false)
  const [asking, setAsking] = useState(false)
  const begun = useRef(false)
  const lock = useRef(false)

  const ask = useCallback(async (fresh: boolean) => {
    if (lock.current) return
    lock.current = true
    setAsking(true)
    const res = (fresh ? null : await currentPairing().catch(() => null)) ?? (await startPairing().catch(down))
    lock.current = false
    setAsking(false)
    if (!res.ok) {
      setPhase({ kind: 'failed' })
      return showError(res, { action: 'meminta kode pasang', retry: () => void ask(true), fallback: 'Kode pasang belum bisa dibuat.' })
    }
    setNow(Date.now())
    setPhase({ kind: 'showing', code: res.code, deadline: Date.now() + res.remaining * 1000 })
  }, [])

  useEffect(() => {
    if (begun.current) return // React's dev double mount must not ask for two codes
    begun.current = true
    void ask(false)
  }, [ask])

  // The countdown.
  const showing = phase.kind === 'showing'
  useEffect(() => {
    if (!showing) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [showing])
  const left = phase.kind === 'showing' ? secondsLeft(phase.deadline, now) : 0
  useEffect(() => {
    if (phase.kind === 'showing' && left === 0) setPhase({ kind: 'ended' })
  }, [phase.kind, left])

  const look = useCallback(async (): Promise<number> => {
    const s: PairingStatus = await pairingStatus().catch((): PairingStatus => ({ state: 'retry' }))
    if (s.state === 'paired') {
      setPhase({ kind: 'paired', deviceName: s.deviceName })
      notifySuccess('Perangkat terhubung')
    } else if (s.state === 'gone') setPhase({ kind: 'ended' })
    else if (s.state === 'pending') setPhase((p) => (p.kind === 'showing' ? { ...p, deadline: Date.now() + s.remaining * 1000 } : p))
    else return (s.retryAfter ?? 0) > 0 ? Math.max(POLL_SLOW_MS, s.retryAfter! * 1000) : POLL_SLOW_MS
    return POLL_MS
  }, [])

  // The poll: every few seconds while a code is on screen; slower after a failed or rate-limited look.
  useEffect(() => {
    if (!showing) return
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const loop = async () => {
      const next = await look()
      if (!stop) timer = setTimeout(() => void loop(), next)
    }
    timer = setTimeout(() => void loop(), POLL_MS)
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [showing, look])

  async function checkNow() {
    if (checking) return
    setChecking(true)
    await look()
    setChecking(false)
  }

  if (phase.kind === 'paired')
    return (
      <Frame title="Perangkat terhubung">
        <CheckCircle2 className="size-12 text-default-success" aria-hidden />
        <p className="text-sm text-default-secondary">
          {phase.deviceName} siap dipakai. Staf masuk dengan nama dan PIN.
        </p>
        <Button type="primary" color="primary" size="large" onClick={() => void router.invalidate()}>
          Pilih nama dan masuk
        </Button>
      </Frame>
    )

  if (phase.kind === 'loading')
    return (
      <Frame title="Pasang perangkat">
        <div role="status" aria-label="Memuat" className="flex w-full flex-col items-center gap-3">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-14 w-64" />
          <Skeleton className="h-8 w-40" />
          <p className="text-xs text-default-secondary">Meminta kode pasang…</p>
        </div>
      </Frame>
    )

  if (phase.kind === 'failed')
    return (
      <Frame title="Pasang perangkat">
        <Alert variant="danger" className="w-full text-left">
          Kode pasang belum bisa dibuat. Periksa sambungan, lalu coba lagi.
        </Alert>
        <Button type="primary" color="primary" size="large" isLoading={asking} onClick={() => void ask(true)}>
          Coba lagi
        </Button>
      </Frame>
    )

  if (phase.kind === 'ended')
    return (
      <Frame title="Kode sudah berakhir">
        <p className="text-sm text-default-secondary">
          Kode berlaku 10 menit dan hanya sekali pakai. Minta kode baru, lalu ketik di perangkat pemilik.
        </p>
        <Button type="primary" color="primary" size="large" isLoading={asking} onClick={() => void ask(true)}>
          Kode baru
        </Button>
      </Frame>
    )

  return (
    <Frame title="Pasang perangkat">
      <p className="text-sm text-default-secondary">Perangkat ini belum terhubung ke toko.</p>
      <p className="text-sm text-default-secondary">
        Minta pemilik membuka <b>Pengguna, Perangkat, Hubungkan perangkat</b> di perangkatnya sendiri, lalu ketik kode
        ini.
      </p>
      <p
        className="font-mono text-5xl font-bold tracking-widest text-default-primary tabular-nums"
        aria-label={`Kode pasang ${phase.code.split('').join(' ')}`}
      >
        {groupCode(phase.code)}
      </p>
      <Alert variant={left <= WARN_SECONDS ? 'warning' : 'info'} className="w-full">
        <span role="timer" aria-live="off">
          Berlaku <b>{formatCountdown(left)}</b> lagi · sekali pakai
        </span>
      </Alert>
      <p className="text-xs text-default-secondary">Menunggu pemilik… layar ini berpindah sendiri saat terhubung.</p>
      <ActionRow stacked>
        <Button type="outline" color="primary" size="medium" isLoading={asking} disabled={checking} onClick={() => void ask(true)}>
          Kode baru
        </Button>
        <Button type="primary" color="primary" size="medium" isLoading={checking} disabled={asking} onClick={() => void checkNow()}>
          Cek sekarang
        </Button>
      </ActionRow>
    </Frame>
  )
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className="text-2xl font-bold text-default-primary">{title}</h1>
      {children}
    </>
  )
}
