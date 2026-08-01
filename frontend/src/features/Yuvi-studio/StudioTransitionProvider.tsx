// @ts-nocheck
/* eslint-disable */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { StudioContent } from './StudioContent'
import { useStudioDesign } from './useStudioDesign'
import { navigate } from '../../app/router'
import '../../styles/Yuvi-studio.css'

type Phase = 'closed' | 'opening' | 'open' | 'closing'

/** The studio always owns this URL, whether it opened as an overlay or a route. */
export const STUDIO_PATH = '/yuvi-studio'
const STUDIO_FALLBACK_PATH = '/student-dashboard'

interface StudioTransitionValue {
  /** Fly Yuvi from a source robot canvas into the studio (shared-element). */
  openStudio: (sourceEl: HTMLElement | null) => void
  isOpen: boolean
  /**
   * The route the overlay was opened from. While the overlay is up the address
   * bar says `/yuvi-studio` (so a reload reopens the studio instead of dropping
   * the learner on the dashboard), and the app keeps rendering this path behind
   * the overlay so closing it costs no remount.
   */
  backgroundPath: string | null
}

const StudioTransitionCtx = createContext<StudioTransitionValue | null>(null)
export function useStudioTransition() {
  return useContext(StudioTransitionCtx)
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const OPEN_MS = 700
const CLOSE_MS = 540

/** Sparks thrown by the portal burst; the index drives each one's angle in CSS. */
const SPARKS = Array.from({ length: 16 }, (_, i) => i)
const BURST_IN_MS = 1000
const BURST_OUT_MS = 780

/** Transform that maps the stage's natural rect onto a target (source) rect. */
function mapTransform(natural: DOMRect, target: DOMRect): string {
  const dx = (target.left + target.width / 2) - (natural.left + natural.width / 2)
  const dy = (target.top + target.height / 2) - (natural.top + natural.height / 2)
  const scale = natural.width > 0 ? target.width / natural.width : 1
  return `translate(${dx}px, ${dy}px) scale(${scale})`
}

export function StudioTransitionProvider({ children }: { children: ReactNode }) {
  const studio = useStudioDesign(false) // loaded on demand when the studio opens
  const [phase, setPhase] = useState<Phase>('closed')
  const [backgroundPath, setBackgroundPath] = useState<string | null>(null)
  const sourceElRef = useRef<HTMLElement | null>(null)
  const runRef = useRef(0)
  // A portal burst fired at the launcher's spot on the way in and on the way
  // out. It lives OUTSIDE the overlay on purpose: the overlay unmounts the
  // moment the close lands, and the sparks should outlive it.
  const [burst, setBurst] = useState<{ kind: 'in' | 'out'; x: number; y: number; id: number } | null>(null)
  const burstTimerRef = useRef<number | undefined>(undefined)
  // `navigate` dispatches a synchronous popstate, so the guard below would
  // otherwise answer the studio's *own* URL hand-off as if the learner had hit
  // Back — bumping runRef mid-close and stranding the overlay in 'closing'.
  const selfNavRef = useRef(false)

  const currentPath = () => `${window.location.pathname}${window.location.search}`

  const fireBurst = useCallback((kind: 'in' | 'out', rect?: DOMRect | null) => {
    if (prefersReducedMotion() || !rect || rect.width === 0) return
    if (burstTimerRef.current) window.clearTimeout(burstTimerRef.current)
    setBurst({ kind, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, id: Date.now() })
    burstTimerRef.current = window.setTimeout(
      () => setBurst(null),
      kind === 'in' ? BURST_IN_MS : BURST_OUT_MS,
    )
  }, [])

  useEffect(() => () => {
    if (burstTimerRef.current) window.clearTimeout(burstTimerRef.current)
  }, [])

  // Back/forward out of the studio URL closes the overlay instead of leaving a
  // studio hanging over a different route.
  useEffect(() => {
    if (phase === 'closed') return
    const onPopState = () => {
      if (selfNavRef.current) return
      if (window.location.pathname.startsWith(STUDIO_PATH)) return
      runRef.current++
      setBackgroundPath(null)
      setPhase('closed')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [phase])

  const stageEl = () => document.querySelector('.studio-overlay .ys-stage__canvas') as HTMLElement | null

  // The launcher may be route-scoped (the app-bar button lives on the dashboard),
  // so by the time we fly back its original node is detached and measures 0x0.
  // Prefer the live button that the restored route just rendered.
  const liveSourceEl = () => {
    const el = sourceElRef.current
    if (el?.isConnected) return el
    return document.querySelector('.studio-launch') as HTMLElement | null
  }

  // Poll (setTimeout) until the studio stage is laid out; returns its natural rect.
  const awaitStageRect = async (run: number): Promise<DOMRect | null> => {
    for (let i = 0; i < 80; i++) {
      await wait(20)
      if (runRef.current !== run) return null
      const el = stageEl()
      if (el) { const r = el.getBoundingClientRect(); if (r.width > 0) return r }
    }
    return null
  }

  const openStudio = useCallback(async (sourceEl: HTMLElement | null) => {
    if (phase !== 'closed') return
    const run = ++runRef.current
    sourceElRef.current = sourceEl
    // Measure NOW: navigating away unmounts a route-scoped launcher, and a
    // detached node reports an empty rect, which would silently drop both the
    // burst and the flight.
    const fromRect = sourceEl?.getBoundingClientRect()
    // Fire the effect on the press, not after loading — waiting made the studio
    // feel like a page load instead of a door opening.
    fireBurst('in', fromRect)
    const from = currentPath()
    setBackgroundPath(from.startsWith(STUDIO_PATH) ? null : from)
    // Mount the overlay in the SAME commit as the URL change. If the phase were
    // still 'closed' here the router would render the standalone /yuvi-studio
    // page and the learner would get the app's boot spinner mid-transition.
    setPhase('opening')
    navigate(STUDIO_PATH)
    await studio.load()
    if (runRef.current !== run) return

    if (prefersReducedMotion() || !fromRect || fromRect.width === 0) {
      setPhase('open')
      return
    }
    // Studio mounts (one WebGL robot). Once its stage is laid out, run a CSS
    // keyframe that grows it from the source robot's spot to full size (FLIP).
    const natural = await awaitStageRect(run)
    if (runRef.current !== run) return
    const el = stageEl()
    if (natural && el) {
      el.style.setProperty('--ys-from', mapTransform(natural, fromRect))
      el.classList.add('ys-flying')
      await wait(OPEN_MS)
      if (runRef.current !== run) return
      el.classList.remove('ys-flying')
      el.style.removeProperty('--ys-from')
    }
    setPhase('open')
  }, [phase, studio])

  const closeStudio = useCallback(async () => {
    const run = ++runRef.current
    const el = stageEl()
    const natural = el?.getBoundingClientRect()
    // Hand the URL back before the flight so the page behind is already the one
    // Yuvi lands on.
    const back = backgroundPath ?? STUDIO_FALLBACK_PATH
    setBackgroundPath(null)
    selfNavRef.current = true
    navigate(back, { replace: true })
    selfNavRef.current = false
    // Let React paint the restored route before measuring: the landing button
    // is part of it.
    await wait(24)
    // Resolve the target only after the route is back, so a route-scoped
    // launcher is measured as the freshly mounted node, not the detached one.
    const sourceEl = liveSourceEl()
    const toRect = sourceEl?.getBoundingClientRect()
    fireBurst('out', toRect)
    if (prefersReducedMotion() || !el || !natural || !toRect) {
      setPhase('closed'); return
    }
    setPhase('closing')
    if (toRect.width > 0) {
      el.style.setProperty('--ys-to', mapTransform(natural, toRect))
      el.classList.add('ys-flying-out')
      await wait(CLOSE_MS)
    }
    el.classList.remove('ys-flying-out')
    el.style.removeProperty('--ys-to')
    // Land on 'closed' even if a newer run took over: leaving the phase on
    // 'closing' keeps a full-screen overlay mounted over the page and unmounts
    // the companion Yuvi, which reads to the learner as a frozen dashboard.
    if (runRef.current === run) setPhase('closed')
  }, [backgroundPath])

  const overlayMounted = phase !== 'closed'
  const overlayVisible = phase === 'opening' || phase === 'open'

  return (
    <StudioTransitionCtx.Provider value={{ openStudio, isOpen: overlayMounted, backgroundPath }}>
      {children}
      {overlayMounted && (
        <div className={`studio-overlay${overlayVisible ? ' is-visible' : ''}`}>
          <StudioContent studio={studio} onClose={() => void closeStudio()} />
        </div>
      )}
      {burst && (
        <div
          key={burst.id}
          className={`ys-burst ys-burst--${burst.kind}`}
          aria-hidden="true"
          style={{ '--ys-bx': `${burst.x}px`, '--ys-by': `${burst.y}px` } as React.CSSProperties}
        >
          <span className="ys-burst__flash" />
          <span className="ys-burst__ring" />
          <span className="ys-burst__ring" />
          <span className="ys-burst__ring" />
          {SPARKS.map((i) => (
            <i key={i} className="ys-burst__spark" style={{ '--i': i } as React.CSSProperties} />
          ))}
        </div>
      )}
    </StudioTransitionCtx.Provider>
  )
}
