import { useEffect } from 'react'
import { apiBeacon, apiPost } from '../services/api'
import { elapsedSeconds, startClock, visibilityChanged } from './viewedClock'

/* One `dashboard/viewed` per visit, filed when the visit ends with the time
   the screen was actually visible.
   
   `path` is the on-leave endpoint (`null` while the screen has nothing to
   report — no group chosen yet); `body` is merged with `duration_seconds`.
   Leaving by navigation reports through a normal POST from the unmount
   cleanup; a closing tab gets the beacon, the only request it is guaranteed
   to deliver. Whichever fires first wins, so a `pagehide` followed by the
   unmount never files twice. Views shorter than `minSeconds` are not views. */
export function useViewedDuration(
  path: string | null,
  body: Record<string, unknown> = {},
  minSeconds = 1,
) {
  const bodyKey = JSON.stringify(body)
  useEffect(() => {
    if (!path) return
    let clock = startClock(performance.now(), !document.hidden)
    let reported = false
    const payload = (seconds: number) => ({ ...JSON.parse(bodyKey), duration_seconds: seconds })
    const onVisibility = () => {
      clock = visibilityChanged(clock, performance.now(), !document.hidden)
    }
    const report = (viaBeacon: boolean) => {
      if (reported) return
      const seconds = elapsedSeconds(clock, performance.now())
      if (seconds < minSeconds) return
      reported = true
      if (viaBeacon) apiBeacon(path, payload(seconds))
      else void apiPost(path, payload(seconds)).catch(() => undefined)
    }
    const onPageHide = () => report(true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      report(false)
    }
  }, [path, bodyKey, minSeconds])
}
