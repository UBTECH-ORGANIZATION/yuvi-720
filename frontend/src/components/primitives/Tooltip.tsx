/* A tooltip, and the one affordance that opens it.
 *
 * Three things this is careful about, because all three are how tooltips
 * usually go wrong in a product that ships in Hebrew and Arabic:
 *
 * 1. **Hover is not the only way in.** A `title` attribute is invisible to
 *    touch and to the keyboard, and the two places this is used — "what is a
 *    פעילות?" and "why is this button disabled?" — are exactly the questions a
 *    user cannot proceed without an answer to. So the trigger is a real
 *    `<button>`: hover, focus and click all open it, Escape closes it, and the
 *    content is wired with `aria-describedby` so a screen reader reads it as
 *    part of the control rather than as loose text.
 *
 * 2. **Nothing can crop it.** The bubble is rendered into `document.body` and
 *    positioned `fixed` from the trigger's rectangle. It used to be absolutely
 *    positioned inside its trigger's parent, which is fine until the trigger
 *    sits in something that scrolls — the task builder's step panel is exactly
 *    that, and the explainer for the part types was cut in half by the top edge
 *    of its own scroll box. An explanation you can only read the bottom of is
 *    not an explanation, and it fails precisely where the dialog is tightest.
 *
 * 3. **It flips and clamps in the viewport, not in a mirrored code path.** Above
 *    the trigger when there is room, below when there is not, and clamped
 *    horizontally to the window, so a bubble on a control at the edge of an RTL
 *    screen behaves the same as one on the left of an LTR screen.
 *
 * Deliberately not a floating-ui dependency: one box, two axes, no arrow.
 *
 * Two components come out of it, sharing one placement implementation because
 * the cropping fix above is the part that must not exist twice:
 *
 *   `Tooltip` — a `?` beside a label, for "what is this thing?"
 *   `Hint`    — wraps a control that already exists, for "what will this do?"
 *
 * `Hint` is the one to reach for on a button. A `?` next to each of four
 * buttons is four more things to look at on a row whose job is to be scanned,
 * and the answer being sought is about the control itself, not beside it.
 */

import {
  useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

interface TooltipProps {
  /** The tooltip body. Rich content is allowed — the type explainer is a list. */
  children: ReactNode
  /** Accessible name for the trigger, e.g. "what are the parts of a task?". */
  label: string
  /** Trigger contents. Defaults to a question mark. */
  trigger?: ReactNode
  className?: string
  /** Keep it open while the pointer is inside the bubble — needed when the
   *  content is long enough to want reading rather than glancing at. */
  interactive?: boolean
}

/** Breathing room from the trigger and from the edge of the window. */
const GAP = 8

/** Open state, dismissal and viewport placement. Shared by both components. */
function useTip(interactive: boolean) {
  /* Two states, not one, and the reason is the mouse: a click on the trigger
     is always preceded by a hover, so a single `open` flag that hover sets and
     click toggles means clicking the `?` closes the bubble hovering just
     opened — the control appears to do nothing at all.

     `hover` is transient (pointer or focus is on it); `pinned` is a decision
     (it was clicked, so it stays after the pointer leaves, which is what makes
     the content readable and what makes it work on touch, where there is no
     hover to begin with). */
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hover || pinned
  const id = useId()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = () => { setPinned(false); setHover(false) }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    // A tooltip left open behind a click elsewhere is a tooltip covering the
    // thing that was clicked. The bubble is checked separately from the
    // trigger: it is in a portal, so it is no longer inside the wrapper.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (wrapRef.current?.contains(target)) return
      if (bubbleRef.current?.contains(target)) return
      dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  /* Measured after the bubble exists and before the browser paints, so it is
     never seen in the wrong place. Re-run on scroll (capture: true, so a
     scrolling panel counts and not just the window) and on resize — the panel
     under it moves, and a bubble that stays behind points at nothing. */
  useLayoutEffect(() => {
    if (!open) {
      setAt(null)
      return
    }
    const place = () => {
      const anchor = wrapRef.current?.getBoundingClientRect()
      const bubble = bubbleRef.current?.getBoundingClientRect()
      if (!anchor || !bubble) return
      const above = anchor.top - bubble.height - GAP
      const below = anchor.bottom + GAP
      const top = above >= GAP
        ? above
        : Math.min(below, Math.max(GAP, window.innerHeight - bubble.height - GAP))
      const centred = anchor.left + anchor.width / 2 - bubble.width / 2
      const left = Math.max(
        GAP, Math.min(centred, window.innerWidth - bubble.width - GAP))
      setAt({ top, left })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  /* Into the body: `aria-describedby` resolves document-wide, so moving the
     bubble out of the wrapper costs nothing an assistive technology can tell,
     and buys immunity from every `overflow` between here and there. */
  const portal = (children: ReactNode) => {
    if (!open || typeof document === 'undefined') return null
    return createPortal(
      <span
        ref={bubbleRef}
        id={id}
        role="tooltip"
        className={`sp-tip__bubble${interactive ? ' is-interactive' : ''}`}
        /* Hidden rather than placed at 0,0 for the one frame before it is
           measured — a box that flashes in the corner reads as a glitch. */
        style={at
          ? { top: `${at.top}px`, left: `${at.left}px` }
          : { top: 0, left: 0, visibility: 'hidden' }}
        onMouseEnter={() => interactive && setHover(true)}
        onMouseLeave={() => interactive && setHover(false)}
      >
        {children}
      </span>,
      document.body)
  }

  return { open, id, wrapRef, setHover, setPinned, portal }
}

export function Tooltip({
  children, label, trigger, className = '', interactive = true,
}: TooltipProps) {
  const { open, id, wrapRef, setHover, setPinned, portal } = useTip(interactive)

  return (
    <span
      ref={wrapRef}
      className={`sp-tip ${className}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        className="sp-tip__trigger"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((value) => !value)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        {trigger ?? <Icon name="help" size={14} aria-hidden="true" />}
      </button>
      {portal(children)}
    </span>
  )
}

/** What a control will do, on hover and on focus.
 *
 *  Wraps the control instead of standing beside it, so a row of buttons gains
 *  explanations without gaining four more `?` marks to look past. The bubble is
 *  not interactive: the thing under the pointer is a button the teacher is
 *  about to press, and a bubble that keeps itself open to be hovered would be
 *  sitting on top of it.
 *
 *  Nothing pins — a click here belongs to the button, not to the tooltip.
 */
export function Hint({ children, text, className = '' }: {
  /** The control. One focusable element; the first one found is described. */
  children: ReactNode
  text: ReactNode
  className?: string
}) {
  const { open, id, wrapRef, setHover, portal } = useTip(false)

  /* `aria-describedby` has to live on the control itself — a wrapper span is
     not what a screen reader announces when focus lands on the button. The
     control is the caller's element, so the attribute is set on the node
     rather than cloned into the element. */
  useEffect(() => {
    const control = wrapRef.current?.querySelector('button, a, input, select, textarea')
    if (!control) return
    if (open) control.setAttribute('aria-describedby', id)
    else control.removeAttribute('aria-describedby')
  }, [open, id, wrapRef])

  return (
    <span
      ref={wrapRef}
      className={`sp-hint ${className}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      /* React's onFocus/onBlur are focusin/focusout, so they carry from the
         control inside — keyboard reaches this without a second listener. */
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      {children}
      {portal(text)}
    </span>
  )
}
