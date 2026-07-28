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

  const currentPath = () => `${window.location.pathname}${window.location.search}`

  // Back/forward out of the studio URL closes the overlay instead of leaving a
  // studio hanging over a different route.
  useEffect(() => {
    if (phase === 'closed') return
    const onPopState = () => {
      if (window.location.pathname.startsWith(STUDIO_PATH)) return
      runRef.current++
      setBackgroundPath(null)
      setPhase('closed')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [phase])

  const stageEl = () => document.querySelector('.studio-overlay .ys-stage__canvas') as HTMLElement | null

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
    const from = currentPath()
    setBackgroundPath(from.startsWith(STUDIO_PATH) ? null : from)
    navigate(STUDIO_PATH)
    await studio.load()
    if (runRef.current !== run) return

    const fromRect = sourceEl?.getBoundingClientRect()
    setPhase('opening')
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
    const sourceEl = sourceElRef.current
    // Hand the URL back before the flight so the page behind is already the one
    // Yuvi lands on.
    const back = backgroundPath ?? STUDIO_FALLBACK_PATH
    setBackgroundPath(null)
    navigate(back, { replace: true })
    if (prefersReducedMotion() || !el || !natural || !sourceEl) {
      setPhase('closed'); return
    }
    setPhase('closing')
    const toRect = sourceEl.getBoundingClientRect()
    if (toRect.width > 0) {
      el.style.setProperty('--ys-to', mapTransform(natural, toRect))
      el.classList.add('ys-flying-out')
      await wait(CLOSE_MS)
    }
    if (runRef.current !== run) return
    el.classList.remove('ys-flying-out')
    el.style.removeProperty('--ys-to')
    setPhase('closed')
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
    </StudioTransitionCtx.Provider>
  )
}
