import { Alert, Button } from '@umkmall/ui'
import { useEffect, useRef, useState } from 'react'
import { rupiah } from '@/components/pos-page'
import { notifySuccess } from '@/lib/feedback'
import { loadPaidSince } from './-online-api'
import { advance, freshNews, newsKey, noticeOf, readSaved, writeSaved, type Cursor, type Notice } from './-since'
import { useLost } from './-use-lost'

const POLL_MS = 15_000
// Every sale this tab ever tracked or finished (kept across visits to the register): its end was seen at the till,
// so `paid-since` telling of it again would be "Lunas saat Anda pergi" for a sale the cashier just finished.
const ownEver = new Set<string>()
const store = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/**
 * "Lunas saat Anda pergi" (UMK-2046): which waiting sales ended while this till was away or closed (paid, refunded,
 * expired, cancelled), from `GET /sales/paid-since`. It asks with the `asOf` of its last answer (kept in this
 * browser, so a closed tab remembers where it stopped), pages while `hasMore`, and shows each sale's end once.
 * `ownIds` are the sales this screen shows or ended itself: the cashier saw those, so they are not news.
 * A failed poll changes nothing: the cursor stays and the next poll asks again.
 */
export function SinceNotices({ ownIds }: { ownIds: string[] }) {
  const lost = useLost()
  const [notices, setNotices] = useState<Notice[]>([])
  const cursor = useRef<Cursor | null>(null)
  const seen = useRef(new Set<string>())
  const saveRef = useRef<() => void>(() => undefined)
  for (const id of ownIds) ownEver.add(id)
  // A sale this till just tracked or finished is remembered at once, so a reload before the next poll keeps it out of the news.
  const ownKey = ownIds.join(',')
  useEffect(() => saveRef.current(), [ownKey])

  useEffect(() => {
    let gone = false
    let running = false
    // After a remount or a reload the keys told in the overlap window come back with the cursor.
    const saved = readSaved(store())
    cursor.current = saved ? { since: saved.since, afterId: saved.afterId } : { since: new Date().toISOString(), afterId: null }
    for (const k of saved?.seen ?? []) seen.current.add(k)
    for (const id of saved?.own ?? []) ownEver.add(id)
    const save = () => {
      if (cursor.current) writeSaved(store(), { ...cursor.current, seen: [...seen.current], own: [...ownEver] })
    }
    saveRef.current = save
    const poll = async () => {
      if (running || gone || document.visibilityState === 'hidden') return
      running = true
      try {
        // at most 20 pages in one round: a till away for weeks catches up over several polls, never in a tight loop
        for (let page = 0; page < 20 && !gone; page++) {
          const r = await loadPaidSince({ data: cursor.current! }).catch(lost)
          if (gone) return
          if (!r) return
          if (!r.ok) {
            // a time the server refuses (422) would be refused forever: start from now instead
            if (r.failure.status === 422) cursor.current = { since: new Date().toISOString(), afterId: null }
            return
          }
          const { cursor: next, again } = advance(r.data)
          const news = freshNews(r.data.items, seen.current, ownEver)
          for (const s of r.data.items) seen.current.add(newsKey(s))
          cursor.current = next
          save()
          if (news.length > 0) {
            setNotices((n) => [...n, ...news.map((s) => noticeOf(s, rupiah))])
            const paid = news.filter((s) => s.status === 'completed').length
            if (paid > 0) notifySuccess(paid === 1 ? '1 penjualan lunas saat Anda pergi' : `${paid} penjualan lunas saat Anda pergi`)
          }
          if (!again) return
        }
      } finally {
        running = false
      }
    }
    void poll()
    const t = setInterval(() => void poll(), POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && void poll()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      gone = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (notices.length === 0) return null
  return (
    <section aria-label="Kabar penjualan menunggu" className="max-h-48 space-y-2 overflow-y-auto">
      {notices.map((n) => (
        <Alert
          key={n.key}
          variant={n.tone === 'success' ? 'success' : n.tone === 'warning' ? 'warning' : 'danger'}
          size="small"
          role="status"
          action={
            <Button type="text" size="small" width="auto" onClick={() => setNotices((x) => x.filter((y) => y.key !== n.key))}>
              Tutup
            </Button>
          }
        >
          <span className="font-semibold">{n.title}.</span> {n.body}
        </Alert>
      ))}
    </section>
  )
}
