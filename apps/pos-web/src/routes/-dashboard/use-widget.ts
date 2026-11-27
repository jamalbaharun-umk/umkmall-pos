import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import type { FailureLike } from '@/lib/describe-error'
import type { Result } from '../laporan/-api'

export type WidgetState<T> = { status: 'loading' } | { status: 'hidden' } | { status: 'error' } | { status: 'ready'; data: T }

/** What every card shares: the page's reload counter, and how a failure reaches the one error dialog. */
export type WidgetContext = {
  version: number
  fail: (failure: FailureLike, action: string) => void
}

/**
 * One card's data: loading, ready, a failure of its own (the other cards stay), or hidden when pos-api says 403. A
 * failure is also handed to the page, which opens the error dialog once for a reload round. `reload` asks again for
 * this card only; the page's counter asks again for all of them. No old figures stay on screen after a failure.
 */
export function useWidget<T>(
  ctx: WidgetContext,
  action: string,
  fetcher: () => Promise<Result<T>>,
  deps: DependencyList = [],
): [WidgetState<T>, () => void] {
  const [state, setState] = useState<WidgetState<T>>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher
  const failRef = useRef(ctx.fail)
  failRef.current = ctx.fail
  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    fetchRef
      .current()
      .then((r) => {
        if (!live) return
        if (r.ok) return setState({ status: 'ready', data: r.data })
        if (r.status === 403) return setState({ status: 'hidden' })
        setState({ status: 'error' })
        failRef.current(r, action)
      })
      .catch(() => {
        if (!live) return
        setState({ status: 'error' })
        failRef.current({ status: 0, offline: true }, action)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.version, tick, action, ...deps])
  return [state, useCallback(() => setTick((t) => t + 1), [])]
}
