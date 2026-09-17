import { useEffect } from 'react'
import { apiBeacon, apiPost } from '../services/api'
import { elapsedSeconds, startClock, visibilityChanged } from './viewedClock'

/* One `dashboard/viewed` per VISIBLE STRETCH of a screen, filed when the
   stretch ends with the time it lasted.

   `path` is the on-leave endpoint (`null` while the screen has nothing to
   report — no group chosen yet); `body` is merged with `duration_seconds`.

   A stretch ends when the tab goes hidden, the page is hidden (closing,
   navigating away) or the screen unmounts. Coming back to the tab starts a
   new stretch — so a teacher who returns to a board after an hour elsewhere
   files two viewings, not one hour-long one. Ordering matters to the
   ministry: nothing may land between the session's `suspend` and `resume`,
   so the viewing is reported on `visibilitychange`/`pagehide` in the CAPTURE
   phase — before the auth shell's own (bubble-phase) suspend listener runs.
   A closing tab gets the beacon, the only request it is guaranteed to
   deliver; a navigation gets a normal POST from the unmount cleanup. Views
   shorter than `minSeconds` are not views. */
export function useViewedDuration(
  path: string | null,
  body: Record<string, unknown> = {},
  minSeconds = 1,
) {
  const bodyKey = JSON.stringify(body)
  useEffect(() => {
    if (!path) return
    let clock = startClock(performance.now(), !document.hidden)
    let reported = document.hidden
    const payload = (seconds: number) => ({ ...JSON.parse(bodyKey), duration_seconds: seconds })
    const report = (viaBeacon: boolean) => {
      if (reported) return
      reported = true
      const seconds = elapsedSeconds(clock, performance.now())
      if (seconds < minSeconds) return
      if (viaBeacon) apiBeacon(path, payload(seconds))
      else void apiPost(path, payload(seconds)).catch(() => undefined)
    }
    const onVisibility = () => {
      if (document.hidden) {
        clock = visibilityChanged(clock, performance.now(), false)
        report(true)
      } else {
        // A new viewing: fresh clock, fresh report.
        clock = startClock(performance.now(), true)
        reported = false
      }
    }
    const onPageHide = () => report(true)
    document.addEventListener('visibilitychange', onVisibility, { capture: true })
    window.addEventListener('pagehide', onPageHide, { capture: true })
    return () => {
      document.removeEventListener('visibilitychange', onVisibility, { capture: true })
      window.removeEventListener('pagehide', onPageHide, { capture: true })
      report(false)
    }
  }, [path, bodyKey, minSeconds])
}
