/* Yuvi, flying the tour.
 *
 * This is the SAME avatar the companion dock holds — the learner's own robot,
 * with whatever they built in the studio — lifted out of its corner and flown
 * around the page. A flat stand-in was the first attempt and it read as a
 * sticker, not as him. The dock stands its own avatar down while this one is up
 * (see `landing` in the step data), so there is never a second WebGL context.
 *
 * He perches on the far side of the spotlight from the card, so the two of them
 * frame the panel between them and can never overlap — the card's placement is
 * already clamped to the viewport, and having both compete for the same edge
 * was the first thing that looked broken.
 *
 * The ARC comes from the nesting rather than from a keyframe: the outer element
 * carries X and the middle element carries Y, on different durations and curves,
 * so a diagonal move bows instead of running along the hypotenuse. Both are
 * plain CSS transitions, which means a learner who clicks Next mid-flight
 * retargets smoothly from wherever Yuvi actually is; a keyframed arc would snap
 * back to a start position that was never on screen.
 *
 * Decorative on purpose: `aria-hidden`, no focus. The step card carries the
 * accessible name, the text and the keyboard.
 */

import { useEffect, useRef, useState } from 'react'
import { YuviAvatar3D } from '../../features/Yuvi-studio/YuviAvatar3DLazy'
import type { YuviAvatarHandle } from '../../features/Yuvi-studio/YuviAvatar3D'
import { useYuviDesign } from '../../features/Yuvi-studio/YuviDesignProvider'
import { CARD_HEIGHT, cardRect } from './placement'
import type { Placement } from './steps/types'
import type { TargetRect } from './useTargetRect'
import './tour.css'

interface Props {
    rect: TargetRect | null
    placement: Placement
    padding: number
    isRtl: boolean
    reducedMotion: boolean
}

/** Rendered size of the avatar; the positions below are its centre. */
const GUIDE_W = 132
const GUIDE_H = 160
/** Clearance between Yuvi and the edge of the cutout. */
const GAP = 16
const EDGE = 10

/** Degrees of bank per px of horizontal travel, and the cap. */
const BANK_PER_PX = 0.05
const BANK_MAX = 8
/** Roughly the slower of the two axis transitions in tour.css. */
const FLIGHT_MS = 500

function perch(
    rect: TargetRect | null, placement: Placement, padding: number, isRtl: boolean,
) {
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    const half = { w: GUIDE_W / 2, h: GUIDE_H / 2 }
    /* Clamped so he is always wholly on screen. Near the bottom of a long page
       this is what keeps him visible at all, rather than half below the fold. */
    const fit = (spot: { x: number; y: number }) => ({
        x: Math.min(Math.max(spot.x, half.w + EDGE), viewportW - half.w - EDGE),
        y: Math.min(Math.max(spot.y, half.h + EDGE), viewportH - half.h - EDGE),
    })

    const card = cardRect(rect, placement, isRtl)

    if (!rect || card.side === 'center') {
        // Above the centred card, not on it.
        return fit({ x: viewportW / 2, y: viewportH / 2 - CARD_HEIGHT / 2 - half.h - GAP })
    }

    const top = rect.top - padding
    const left = rect.left - padding
    const right = rect.left + rect.width + padding
    const bottom = rect.top + rect.height + padding
    const midX = rect.left + rect.width / 2
    const midY = rect.top + rect.height / 2

    const above = { x: midX, y: top - half.h - GAP }
    const below = { x: midX, y: bottom + half.h + GAP }
    const beforeX = left - half.w - GAP
    const afterX = right + half.w + GAP

    /* Opposite the card first, then around the target, then the far corners.
       Candidates rather than one formula because clamping can undo the choice:
       an app-bar target has no room ABOVE it, so "above" collapses onto the top
       edge — exactly where a card centred under a narrow button also sits, and
       Yuvi is a layer below the card, so he simply disappears. */
    const candidates = card.side === 'bottom'
        ? [above, { x: afterX, y: midY }, { x: beforeX, y: midY }, below]
        : card.side === 'top'
            ? [below, { x: afterX, y: midY }, { x: beforeX, y: midY }, above]
            : card.side === 'left'
                ? [{ x: afterX, y: midY }, above, below, { x: beforeX, y: midY }]
                : [{ x: beforeX, y: midY }, above, below, { x: afterX, y: midY }]

    // Corners last: somewhere on screen and out of the way beats invisible.
    candidates.push(
        { x: viewportW - half.w - EDGE, y: viewportH - half.h - EDGE },
        { x: half.w + EDGE, y: viewportH - half.h - EDGE },
        { x: viewportW - half.w - EDGE, y: half.h + EDGE },
        { x: half.w + EDGE, y: half.h + EDGE },
    )

    const clearOfCard = (spot: { x: number; y: number }) => (
        spot.x + half.w < card.left || spot.x - half.w > card.left + card.width
        || spot.y + half.h < card.top || spot.y - half.h > card.top + card.height
    )

    for (const candidate of candidates) {
        const placed = fit(candidate)
        if (clearOfCard(placed)) return placed
    }
    return fit(candidates[0])
}

export function TourGuide({ rect, placement, padding, isRtl, reducedMotion }: Props) {
    const { design, loaded } = useYuviDesign()
    const avatarRef = useRef<YuviAvatarHandle | null>(null)
    const { x, y } = perch(rect, placement, padding, isRtl)
    const previousX = useRef(x)
    const [bank, setBank] = useState(0)
    const [inFlight, setInFlight] = useState(false)
    // Held back one frame so the entrance fades in rather than popping already
    // parked on the first panel.
    const [entered, setEntered] = useState(false)

    useEffect(() => {
        const frame = requestAnimationFrame(() => setEntered(true))
        return () => cancelAnimationFrame(frame)
    }, [])

    useEffect(() => {
        if (loaded) avatarRef.current?.applyDesign(design, false)
    }, [design, loaded])

    useEffect(() => {
        const dx = x - previousX.current
        previousX.current = x
        if (reducedMotion || Math.abs(dx) < 1) return
        // Sign comes from real geometry, so the bank mirrors in RTL for free.
        setBank(Math.max(-BANK_MAX, Math.min(BANK_MAX, dx * BANK_PER_PX)))
        setInFlight(true)
        const timer = window.setTimeout(() => { setBank(0); setInFlight(false) }, FLIGHT_MS)
        return () => window.clearTimeout(timer)
    }, [x, reducedMotion])

    // Which side the panel he is introducing sits on, so he turns toward it.
    const presentingSide = rect && rect.left + rect.width / 2 < x ? 'left' : 'right'

    return (
        <div
            className={`sp-tour__guide${reducedMotion ? ' is-still' : ''}${entered ? ' is-in' : ''}`}
            aria-hidden="true"
            style={{
                transform: `translate3d(${x}px, 0, 0)`,
                '--sp-tour-guide-w': `${GUIDE_W}px`,
                '--sp-tour-guide-h': `${GUIDE_H}px`,
            } as React.CSSProperties}
        >
            <div className="sp-tour__guide-lift" style={{ transform: `translate3d(0, ${y}px, 0)` }}>
                <div
                    className="sp-tour__guide-bob"
                    style={{ '--sp-tour-bank': `${bank}deg` } as React.CSSProperties}
                >
                    <span className="sp-tour__guide-glow" />
                    <div className="sp-tour__guide-robot">
                        {loaded && (
                            <YuviAvatar3D
                                ref={avatarRef}
                                initialDesign={design}
                                label=""
                                muted
                                /* Thrusters and an upright lift-off while he crosses the page;
                                   the moment he parks he turns and points at the panel. */
                                flying={inFlight}
                                presenting={!inFlight && Boolean(rect)}
                                presentingSide={presentingSide}
                                followPointer={!inFlight}
                                /* A small canvas, and the tour is the one moment WebGL and a
                                   full-page scrim are both on screen on a school laptop. */
                                performanceMode="low"
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
