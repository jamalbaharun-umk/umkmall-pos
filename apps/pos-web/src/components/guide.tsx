import { Button, CoachMark } from '@umkmall/ui/primitives'
import { useLocation } from '@tanstack/react-router'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { notifySuccess, showError } from '@/lib/feedback'
import type { ErrorDescription } from '@/lib/describe-error'
import { getGuideProgress, markGuide, resetGuides, type GuideStatus } from '@/lib/guides-api'
import { GUIDES, HELPER_GUIDE, NO_AUTO_START, guideForSession, type Guide } from '@/guides'
import { blocksGuide, LARGE_TEXT_KEY, readDeviceProgress, readLargeText, writeDeviceProgress } from './guide-rules'

// UMK-2134 coach marks (design 46). One provider for the whole signed-in app (bare routes such as the till too): it
// loads the person's progress once, starts a screen's guide on the first visit, and keeps it hidden while a dialog,
// a payment or a PIN entry is open. It never advances on its own.

type Active = { guide: Guide; step: number }
type GuideState = {
  /** Signed in: guides exist only for a signed-in person. */
  enabled: boolean
  /** UMK-2124: a helper session (the sales-only till): its one guide, kept on this device. */
  helper: boolean
  /** null while loading or after a failed load (no guide starts on its own then). */
  progress: Map<string, GuideStatus> | null
  start: (key: string) => void
  reset: (key: string | null) => Promise<boolean>
  largeText: boolean
  setLargeText: (on: boolean) => void
}

const GuideContext = createContext<GuideState | null>(null)
export const useGuides = () => useContext(GuideContext)

/** localStorage, or nothing where the browser refuses it (private mode, blocked site data). */
function storageOrUndefined(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

const describeLoadFailure = (): ErrorDescription => ({
  what: 'Sambungan ke server terputus, jadi kami belum tahu panduan mana yang sudah Anda lihat.',
  todo: 'Cek sinyal. Layar tetap bisa dipakai; panduan tampil lagi setelah tersambung.',
  code: 'GUIDE_PROGRESS_FAILED',
  primary: 'retry',
})

export function GuideProvider({ children, enabled, helper = false }: { children: ReactNode; enabled: boolean; helper?: boolean }) {
  const { pathname } = useLocation()
  const [progress, setProgress] = useState<Map<string, GuideStatus> | null>(null)
  const [active, setActive] = useState<Active | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [target, setTarget] = useState<Element | null>(null)
  const [largeText, setLargeTextState] = useState(false)
  const loading = useRef(false)
  // Guides already started in this visit (a skipped save that failed must not restart on every navigation).
  const startedHere = useRef(new Set<string>())

  useEffect(() => setLargeTextState(readLargeText()), [])
  const setLargeText = useCallback((on: boolean) => {
    setLargeTextState(on)
    try {
      localStorage.setItem(LARGE_TEXT_KEY, on ? '1' : '0')
    } catch {
      // A browser without storage keeps the choice for this visit only.
    }
  }, [])

  const load = useCallback(async () => {
    if (loading.current) return
    // UMK-2124: a helper session reaches no guide progress in pos-api; its marks are kept on this device.
    if (helper) return setProgress(readDeviceProgress(storageOrUndefined()))
    loading.current = true
    const r = await getGuideProgress().catch(() => ({ ok: false as const }))
    loading.current = false
    if (r.ok) setProgress(new Map(r.data.map((p) => [p.key, p.status])))
    else
      showError(
        { code: 'GUIDE_PROGRESS_FAILED' },
        { action: 'memuat panduan', retry: () => void load() },
        describeLoadFailure,
      )
  }, [helper])
  useEffect(() => {
    if (enabled) void load()
  }, [enabled, load])

  // Hidden while any dialog is open (payment, PIN, an error, a form): watch the document for one.
  useEffect(() => {
    if (!enabled) return
    const check = () => setBlocked(blocksGuide(document))
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'data-state'] })
    return () => observer.disconnect()
  }, [enabled])

  // First visit of a screen: its guide starts by itself (after the page has drawn).
  useEffect(() => {
    if (!enabled || !progress || active) return
    if (NO_AUTO_START.some((r) => r.test(pathname))) return
    const guide = guideForSession(pathname, helper)
    if (!guide || progress.has(guide.key) || startedHere.current.has(guide.key)) return
    const timer = setTimeout(() => {
      startedHere.current.add(guide.key)
      setActive({ guide, step: 0 })
    }, 700)
    return () => clearTimeout(timer)
  }, [enabled, progress, active, pathname, helper])

  // Leaving the screen ends its guide without saving anything (it starts again next visit).
  useEffect(() => {
    if (active && guideForSession(pathname, helper)?.key !== active.guide.key) setActive(null)
  }, [pathname, active, helper])

  // The element the current step points at; re-read while the page settles.
  useEffect(() => {
    if (!active) return setTarget(null)
    const name = active.guide.steps[active.step].target
    const find = () => setTarget(document.querySelector(`[data-guide="${name}"]`))
    find()
    const timer = setInterval(find, 500)
    return () => clearInterval(timer)
  }, [active])

  const finish = useCallback(
    async (guide: Guide, status: GuideStatus) => {
      setActive(null)
      setProgress((p) => new Map(p ?? []).set(guide.key, status))
      if (helper) {
        writeDeviceProgress(storageOrUndefined(), guide.key, status)
        if (status === 'done') notifySuccess('Panduan ditandai selesai')
        return
      }
      const r = await markGuide({ data: { key: guide.key, status } }).catch(() => ({ ok: false }))
      if (r.ok && status === 'done') notifySuccess('Panduan ditandai selesai')
    },
    [helper],
  )

  const start = useCallback((key: string) => {
    const guide = [...GUIDES, HELPER_GUIDE].find((g) => g.key === key)
    if (guide) setActive({ guide, step: 0 })
  }, [])

  const reset = useCallback(async (key: string | null) => {
    const r = await resetGuides({ data: key }).catch(() => ({ ok: false }))
    if (r.ok) {
      setProgress((p) => {
        if (!key) return new Map()
        const next = new Map(p ?? [])
        next.delete(key)
        return next
      })
      if (key) startedHere.current.delete(key)
      else startedHere.current.clear()
    }
    return r.ok
  }, [])

  const value = useMemo(
    () => ({ enabled, helper, progress, start, reset, largeText, setLargeText }),
    [enabled, helper, progress, start, reset, largeText, setLargeText],
  )
  const step = active?.guide.steps[active.step]

  return (
    <GuideContext.Provider value={value}>
      {children}
      {active && step && !blocked && (
        <CoachMark
          target={target}
          step={active.step + 1}
          total={active.guide.steps.length}
          title={step.title}
          text={step.text}
          largeText={largeText}
          onNext={() =>
            active.step + 1 < active.guide.steps.length
              ? setActive({ guide: active.guide, step: active.step + 1 })
              : void finish(active.guide, 'done')
          }
          onBack={() => setActive({ guide: active.guide, step: Math.max(0, active.step - 1) })}
          onSkip={() => void finish(active.guide, 'skipped')}
        />
      )}
    </GuideContext.Provider>
  )
}

/** "? Panduan" in a page title: replays the screen's guide. Absent on a screen without one. */
export function GuideButton() {
  const guides = useGuides()
  const { pathname } = useLocation()
  const guide = guideForSession(pathname, guides?.helper ?? false)
  if (!guides?.enabled || !guide) return null
  return (
    <Button
      type="text"
      size="small"
      width="auto"
      color="primary"
      data-guide="guide-button"
      aria-label={`Putar panduan ${guide.title}`}
      onClick={() => guides.start(guide.key)}
    >
      ? Panduan
    </Button>
  )
}
