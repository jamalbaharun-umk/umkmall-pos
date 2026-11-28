import { Alert, Button, Dialog, Icon, Spinner, Switch, TextField } from '@umkmall/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { notifySuccess, showError } from '@/lib/feedback'
import {
  cameraSupport,
  classifyCameraError,
  createDedupe,
  normalizeCode,
  pickFormats,
  readBeep,
  showScanButton,
  writeBeep,
  type CameraSupport,
  type ScanResult,
} from '@/lib/barcode-scan'

// UMK-1986 (design 47): the camera sheet. A bottom sheet on a phone, a dialog on a desktop (the Dialog's own rule). It
// keeps scanning until "Selesai", so a cashier rings up many items without reopening it. The image is read on the
// device by the browser's BarcodeDetector: nothing is recorded or uploaded. The stream stops when the sheet closes.
// Where the browser has no BarcodeDetector (Safari on iOS today) the Scan button is not shown; a library fallback
// would be added in `startDetector` only (docs/plans/2026-11-28-012-feat-umk-1986-camera-barcode-scan-plan.md).

type DetectorLike = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
type DetectorCtor = {
  new (opts?: { formats?: string[] }): DetectorLike
  getSupportedFormats?: () => Promise<string[]>
}
const detectorCtor = (): DetectorCtor | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector

async function startDetector(): Promise<DetectorLike> {
  const Ctor = detectorCtor()
  if (!Ctor) throw Object.assign(new Error('no detector'), { name: 'NotSupportedError' })
  const formats = pickFormats((await Ctor.getSupportedFormats?.().catch(() => [])) ?? [])
  return new Ctor(formats.length ? { formats } : undefined)
}

/** Whether this device can scan, known after the first render in the browser (the server cannot know). */
export function useScanSupport(): CameraSupport | 'unknown' {
  const [support, setSupport] = useState<CameraSupport | 'unknown'>('unknown')
  useEffect(() => {
    let live = true
    const env = {
      isSecureContext: window.isSecureContext,
      hasMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
      hasDetector: Boolean(detectorCtor()),
    }
    setSupport(cameraSupport(env))
    if (env.isSecureContext && env.hasMediaDevices)
      navigator.mediaDevices
        .enumerateDevices()
        .then((d) => live && setSupport(cameraSupport({ ...env, videoInputs: d.filter((x) => x.kind === 'videoinput').length })))
        .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return support
}
export const canShowScan = (s: CameraSupport | 'unknown') => s !== 'unknown' && showScanButton(s)

let audio: AudioContext | undefined
/** A short beep; never throws (no audio device, autoplay rules). */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    audio ??= new Ctx()
    void audio.resume()
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.frequency.value = 1000
    gain.gain.value = 0.15
    osc.connect(gain).connect(audio.destination)
    osc.start()
    osc.stop(audio.currentTime + 0.12)
  } catch {
    // No sound is not a failure.
  }
}

type Phase = 'starting' | 'scanning' | 'denied' | 'insecure' | 'unavailable' | 'unknown-code'

export function BarcodeScanSheet({
  open,
  onClose,
  onCode,
  title = 'Scan produk',
  status,
  onAddUnknown,
}: {
  open: boolean
  onClose: () => void
  /** Looks the code up and does the screen's work (cart, field); answers what to show. Rejects when it could not ask. */
  onCode: (code: string, source: 'camera' | 'manual') => Promise<ScanResult>
  title?: string
  /** One line under the frame, for example "Di keranjang 3 barang". */
  status?: string
  /** Offers "Produk cepat" for an unknown code; absent when the actor may not add products. */
  onAddUnknown?: (code: string) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode
  const dedupe = useRef(createDedupe())
  const paused = useRef(false)
  const [phase, setPhase] = useState<Phase>('starting')
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [flash, setFlash] = useState(false)
  const [beepOn, setBeepOn] = useState(true)
  const [manual, setManual] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const beepRef = useRef(true)
  beepRef.current = beepOn

  useEffect(() => setBeepOn(readBeep()), [])

  const handle = useCallback(async (raw: string, source: 'camera' | 'manual') => {
    const code = normalizeCode(raw)
    if (!code) return
    if (source === 'camera' && !dedupe.current.accept(code, Date.now())) return
    try {
      const r = await onCodeRef.current(code, source)
      setResult(r)
      if (r.kind === 'unknown') {
        paused.current = true
        setPhase('unknown-code')
        return
      }
      if (r.kind === 'ok') {
        setFlash(true)
        setTimeout(() => setFlash(false), 450)
        if (beepRef.current) beep()
        notifySuccess(r.detail)
      }
    } catch (e) {
      dedupe.current.forget(code)
      showError(e, { action: 'mencari barcode', retry: () => void handle(code, source) })
    }
  }, [])

  // The camera lives exactly as long as the sheet is open: every exit path ends in `stop()`.
  useEffect(() => {
    if (!open) return
    let stopped = false
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    paused.current = false
    dedupe.current.reset()
    setResult(null)
    setPhase('starting')
    const stop = () => {
      stopped = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
      if (video.current) video.current.srcObject = null
    }
    void (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return setPhase('insecure')
      let detector: DetectorLike
      try {
        detector = await startDetector()
      } catch {
        return setPhase('unavailable')
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (stopped) return s.getTracks().forEach((t) => t.stop()) // closed while the permission prompt was open
        stream = s
        const el = video.current
        if (!el) return stop()
        el.srcObject = s
        await el.play().catch(() => undefined)
      } catch (e) {
        if (stopped) return
        const why = classifyCameraError(e)
        if (why === 'denied') return setPhase('denied')
        setPhase('unavailable')
        return showError(
          { status: 0 },
          { action: 'membuka kamera', retry: () => setAttempt((n) => n + 1) },
          () => ({
            what:
              why === 'no-camera'
                ? 'Perangkat ini tidak punya kamera yang bisa dipakai.'
                : 'Kamera sedang dipakai aplikasi lain, atau belum diizinkan untuk alamat ini.',
            todo: 'Tutup aplikasi lain yang memakai kamera, lalu coba lagi. Anda tetap bisa mengetik kode barcode.',
            code: 'CAMERA_UNAVAILABLE',
            primary: 'retry',
          }),
        )
      }
      setPhase('scanning')
      const tick = async () => {
        if (stopped) return
        const el = video.current
        if (el && el.readyState >= 2 && !paused.current) {
          try {
            for (const b of await detector.detect(el)) {
              if (stopped || paused.current) break
              void handle(b.rawValue, 'camera')
            }
          } catch {
            // One frame the detector could not read: the next one is tried.
          }
        }
        if (!stopped) timer = setTimeout(() => void tick(), 150)
      }
      void tick()
    })()
    return stop
  }, [open, attempt, handle])

  const close = () => {
    setManual(false)
    setTyped('')
    onClose()
  }
  const again = () => {
    paused.current = false
    dedupe.current.reset()
    setResult(null)
    setPhase('scanning')
  }
  async function submitTyped() {
    const code = normalizeCode(typed)
    if (!code || busy) return
    setBusy(true)
    await handle(code, 'manual')
    setBusy(false)
    setTyped('')
  }

  const cameraUp = phase === 'starting' || phase === 'scanning'
  const unknown = result?.kind === 'unknown' ? result.code : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} size="small" title={title}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6">
        {phase === 'denied' && (
          <div className="space-y-3">
            <Alert variant="warning" size="small">
              Kamera belum diizinkan. POS butuh kamera untuk membaca barcode. Gambar tidak disimpan dan tidak dikirim ke mana pun.
            </Alert>
            <div className="text-sm text-default-primary">
              <p className="font-medium">Cara mengizinkan</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-default-secondary">
                <li>Ketuk ikon gembok di samping alamat.</li>
                <li>Pilih Izin, lalu Kamera.</li>
                <li>Pilih Izinkan, kembali ke sini.</li>
              </ol>
            </div>
          </div>
        )}
        {phase === 'insecure' && (
          <Alert variant="warning" size="small">
            Kamera hanya bisa lewat alamat aman. Buka POS lewat alamat yang diawali https. Sementara itu, ketik kode barcode.
          </Alert>
        )}
        {phase === 'unavailable' && (
          <Alert variant="warning" size="small">
            Kamera belum bisa dipakai di perangkat ini. Anda tetap bisa mengetik kode barcode.
          </Alert>
        )}

        {/* The video stays mounted while the sheet is open so the effect can attach the stream to it. */}
        <div className={cameraUp ? 'space-y-2' : 'hidden'}>
          <div
            className={`relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black ring-4 transition-shadow ${flash ? 'ring-green-500' : 'ring-transparent'}`}
          >
            <video ref={video} muted playsInline className="size-full object-cover" aria-label="Pratinjau kamera" />
            {phase === 'starting' && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white" role="status">
                <Spinner /> Membuka kamera…
              </div>
            )}
            {phase === 'scanning' && (
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/80" />
            )}
          </div>
          <p className="text-center text-sm text-default-secondary">Arahkan kamera ke barcode. Pakai senter bila gelap.</p>
          {status && <p className="text-center text-sm font-medium text-default-primary">{status}</p>}
        </div>

        {unknown ? (
          <div className="space-y-3">
            <Alert variant="warning" size="small">
              Barcode {unknown} belum ada. Belum ada produk dengan kode ini di toko Anda. Tidak ada yang dimasukkan ke keranjang.
            </Alert>
            {!onAddUnknown && (
              <p className="text-sm text-default-secondary">Anda tidak boleh menambah produk. Minta pemilik menambahkannya.</p>
            )}
          </div>
        ) : (
          result &&
          result.kind !== 'unknown' && (
            <Alert variant={result.kind === 'ok' ? 'success' : 'warning'} size="small" role="status">
              {result.kind === 'ok' && result.badge ? `${result.badge} ` : ''}
              {result.detail}
            </Alert>
          )
        )}

        {manual && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void submitTyped()
            }}
          >
            <TextField label="Kode barcode" autoFocus maxLength={64} value={typed} onChange={(e) => setTyped(e.target.value)} />
            <ActionRow>
              <Button width="auto" htmlType="submit" disabled={busy || !normalizeCode(typed)}>
                Cari kode
              </Button>
            </ActionRow>
          </form>
        )}

        {cameraUp && (
          <Switch
            label="Bunyi saat berhasil"
            checked={beepOn}
            onCheckedChange={(on) => {
              setBeepOn(on)
              writeBeep(on)
            }}
          />
        )}

        <ActionRow>
          {unknown ? (
            <>
              <Button width="auto" type="outline" color="light" onClick={close}>
                Tutup
              </Button>
              <Button width="auto" type="outline" color="light" onClick={again}>
                Scan lagi
              </Button>
              {onAddUnknown && (
                <Button width="auto" onClick={() => onAddUnknown(unknown)}>
                  Produk cepat
                </Button>
              )}
            </>
          ) : (
            <>
              {!manual && (
                <Button width="auto" type="outline" color="light" onClick={() => setManual(true)}>
                  <Icon name="pen" size="sm" /> Ketik kode manual
                </Button>
              )}
              {(phase === 'denied' || phase === 'unavailable') && (
                <Button width="auto" type="outline" color="light" onClick={() => setAttempt((n) => n + 1)}>
                  Coba lagi
                </Button>
              )}
              <Button width="auto" onClick={close}>
                {cameraUp ? 'Selesai' : 'Tutup'}
              </Button>
            </>
          )}
        </ActionRow>
      </div>
    </Dialog>
  )
}
