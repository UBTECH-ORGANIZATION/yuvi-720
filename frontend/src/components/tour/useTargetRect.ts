/* Measure the DOM node a tour step points at.
 *
 * Three things make this harder than one `getBoundingClientRect()`:
 *
 *   1. **The target may not exist yet.** Teacher panels fetch before they
 *      render, so the element for "the attention inbox" appears a second or two
 *      after the route does. We retry on animation frames for a bounded window
 *      and then give up — a step whose target never arrives is *skipped*, never
 *      fatal (a tour that dead-ends on a slow network is worse than a short one).
 *   2. **The page moves under it.** Scrolling into view, a resize, an SSE patch
 *      that grows a panel — all change the rect while the spotlight is open, so
 *      we re-measure on scroll, on resize, and via a ResizeObserver on the node.
 *      The FIRST measurement is deliberately withheld until the scroll settles:
 *      the spotlight should appear on the section, not chase it there.
 *   3. **Rects are viewport-relative**, which is exactly what the overlay wants
 *      since it is `position: fixed`. No scroll offset maths anywhere.
 */

import { useEffect, useState } from 'react'

export interface TargetRect {
  top: number
  left: number
  width: number
  height: number
}

/* How long to keep looking for a late-mounting panel before skipping the step.
   Generous on purpose: the teacher panels fetch group insights across a whole
   roster, and a first visit on a cold connection routinely takes several
   seconds. At 1.5s the tour skipped half its own steps on a normal load — the
   card shows (centred, un-spotlit) for the whole of this window, so waiting
   costs a moment of "reading the card", not a blank screen. */
const LOOKUP_TIMEOUT_MS = 8000

/* How long the page must hold still before the spotlight is allowed to appear,
   and the longest we will wait for that. */
const SCROLL_QUIET_MS = 140
const SCROLL_SETTLE_CAP_MS = 1400

export function findTarget(selector: string | null): HTMLElement | null {
  if (!selector) return null
  try {
    return document.querySelector<HTMLElement>(`[data-tour="${selector}"]`)
  } catch {
    return null
  }
}

/** `null` while still looking; `'missing'` once we have given up. */
export type TargetState = TargetRect | null | 'missing'

export function useTargetRect(selector: string | null, reducedMotion = false): TargetState {
  /* The state is tagged with the selector that produced it.
     Without the tag, the verdict from a *previous* selector is still on screen
     for the render in which a new one arrives — and the caller, seeing
     `'missing'`, skips a step it has not actually looked for yet. That is
     exactly what happened when the tour crossed routes: the step was disabled
     (selector `null` → "missing"), the route landed, and the step was skipped
     in the same commit, before the search ever ran. */
  const [state, setState] = useState<{ for: string | null; value: TargetState }>(
    { for: selector, value: null })
  const setFor = (key: string | null, value: TargetState) => setState({ for: key, value })

  useEffect(() => {
    if (!selector) {
      // A step with no target is a centred card (the welcome step) — not missing.
      setFor(null, 'missing')
      return
    }

    let active = true
    let frame = 0
    let observer: ResizeObserver | null = null
    let startedAt = performance.now()

    const measure = (node: HTMLElement) => {
      if (!active) return
      const box = node.getBoundingClientRect()
      // A node that is present but collapsed (a closed <details>, a panel mid
      // mount) measures 0×0 — treat it as not-ready rather than spotlighting a
      // point, or the cutout lands in the corner of the screen.
      if (box.width < 1 || box.height < 1) return
      setFor(selector, { top: box.top, left: box.left, width: box.width, height: box.height })
    }

    const attach = (node: HTMLElement) => {
      // The CSS honours reduced motion for the cutout and the halo; the scroll
      // is JavaScript and would otherwise keep animating right past it — which
      // is the largest movement the tour makes, not the smallest.
      node.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' })

      /* Nothing is published until the page stops moving. Measuring immediately
         put the spotlight on the panel's PRE-scroll position and then dragged
         the cutout across the screen to catch up — the focus arrived before the
         section did. Holding it back means the card shows centred and un-spotlit
         for the length of the scroll, and the spotlight simply appears on the
         section once we are there. */
      let settled = false
      const publish = () => { settled = true; measure(node) }
      /* Self-adjusting: a smooth scroll fires events continuously, so the timer
         is pushed out until it stops. If no scroll was needed, no events fire
         and this lands after one quiet interval. */
      let quiet = window.setTimeout(publish, SCROLL_QUIET_MS)
      // A page that never stops moving must not hold the tour hostage.
      const giveUp = window.setTimeout(publish, SCROLL_SETTLE_CAP_MS)

      const onChange = () => {
        if (settled) { measure(node); return }
        window.clearTimeout(quiet)
        quiet = window.setTimeout(publish, SCROLL_QUIET_MS)
      }
      window.addEventListener('scroll', onChange, true)
      window.addEventListener('resize', onChange)
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(onChange)
        observer.observe(node)
      }
      /* The node can leave the DOM entirely — a language change remounts the
         whole keyed route subtree — and a ResizeObserver on a detached node
         never fires again, so the spotlight would freeze on where the panel
         USED to be. Watch for disconnection and go back to looking; the
         replacement node mounts under the same data-tour a moment later. */
      const alive = window.setInterval(() => {
        if (!active || node.isConnected) return
        detach?.()
        detach = null
        startedAt = performance.now()
        look()
      }, 400)
      return () => {
        window.clearInterval(alive)
        window.clearTimeout(quiet)
        window.clearTimeout(giveUp)
        window.removeEventListener('scroll', onChange, true)
        window.removeEventListener('resize', onChange)
        observer?.disconnect()
      }
    }

    let detach: (() => void) | null = null

    const look = () => {
      if (!active) return
      const node = findTarget(selector)
      if (node) {
        detach = attach(node)
        return
      }
      if (performance.now() - startedAt > LOOKUP_TIMEOUT_MS) {
        setFor(selector, 'missing')
        return
      }
      frame = requestAnimationFrame(look)
    }

    setFor(selector, null)
    look()

    return () => {
      active = false
      cancelAnimationFrame(frame)
      detach?.()
    }
  }, [selector, reducedMotion])

  // A verdict about a different selector is not a verdict about this one.
  return state.for === selector ? state.value : null
}
