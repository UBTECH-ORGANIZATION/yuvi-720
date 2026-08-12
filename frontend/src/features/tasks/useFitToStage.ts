/* A slide is a fixed 16:9 box that fits whatever is holding it.
 *
 * ## Why fixed
 *
 * A slide that grows with its content cannot be designed: the same layout is a
 * tight card on one deck and half a metre of white space on the next, the
 * teacher's preview never matches the child's screen, and it can never be
 * presented on a projector or printed. So the slide is laid out ONCE at a
 * design size (1280×720) and scaled to its container with a single transform —
 * no per-element clamps, no container queries fighting each other, and the
 * thing on the projector is the thing that was designed.
 *
 * ## Why two numbers and not one
 *
 * `scale` fits the STAGE to the page. `textFit` fits the CONTENT to the stage:
 * after layout, if the slide overflows its own 720px, type steps down until it
 * does not. Six passes, floor 0.72 — below that a slide is not too big, it is
 * too full, and shrinking further only makes it unreadable as well as crowded.
 *
 * This is the reference implementation's best idea, kept and made smaller: it
 * runs twelve passes over `contentScale`, `fitTextBlocks` and `fitActionLists`
 * against a live `iframe`, because its slides are documents. Ours are React
 * subtrees in the same document, so one CSS variable and a `scrollHeight`
 * comparison do the same job.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** The size every slide is written at. 16:9, and big enough that `px` sizes in
 *  the CSS read like the projector rather than like a phone. */
export const STAGE_W = 1280
export const STAGE_H = 720

/* Below this the stage stops being a stage.
 *
 * A 1280px slide scaled into a 380px phone puts its title at 11px — measured,
 * not guessed. The fixed stage exists so a deck can be designed, presented and
 * printed, and a phone does none of those; so under this width the same slide
 * flows at full size instead of being shrunk to a postcard. One design, two
 * presentations of it — not two designs. */
const FLOW_BELOW = 700

const MIN_TEXT_FIT = 0.72
const STEP = 0.05
const PASSES = 6

export interface Fit {
  /** Attach to the element that bounds the stage — usually a Panel or a page. */
  frameRef: React.RefObject<HTMLDivElement | null>
  /** Attach to the fixed-size slide itself. */
  stageRef: React.RefObject<HTMLDivElement | null>
  /** `frame ÷ 1280`. Applied as a transform on the stage. */
  scale: number
  /** 1 → 0.72. Applied as `--yv-text-fit`, which every type size multiplies. */
  textFit: number
  /** True on a phone: the slide is laid out at its natural size and grows with
   *  its content, exactly as it did before the stage existed. */
  flow: boolean
}

export function useFitToStage(dependency: unknown): Fit {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [textFit, setTextFit] = useState(1)
  const [flow, setFlow] = useState(false)

  const measure = useCallback(() => {
    const frame = frameRef.current
    if (!frame) return
    const width = frame.clientWidth
    if (width <= 0) return
    const narrow = width < FLOW_BELOW
    setFlow(narrow)
    setScale(narrow ? 1 : Math.min(1, width / STAGE_W))
  }, [])

  useEffect(() => {
    measure()
    const frame = frameRef.current
    if (!frame || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [measure])

  /* The content pass. Runs after the slide has rendered and again once webfonts
     have landed — Hebrew metrics change enough on font swap to turn a slide
     that just fitted into one that just does not. */
  useEffect(() => {
    let cancelled = false

    const fit = () => {
      const stage = stageRef.current
      if (!stage || cancelled) return
      let value = 1
      for (let pass = 0; pass < PASSES; pass += 1) {
        stage.style.setProperty('--yv-text-fit', String(value))
        // Forced reflow, deliberately: the next comparison must see this pass.
        const overflowing = stage.scrollHeight > stage.clientHeight + 1
        if (!overflowing) break
        if (value <= MIN_TEXT_FIT) break
        value = Math.max(MIN_TEXT_FIT, value - STEP)
      }
      if (!cancelled) setTextFit(value)
    }

    // One frame later: React has committed, but the browser has not painted,
    // so the shrink is never seen happening.
    const raf = requestAnimationFrame(fit)
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    void fonts?.ready?.then(() => { if (!cancelled) fit() })

    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [dependency])

  return { frameRef, stageRef, scale, textFit, flow }
}
