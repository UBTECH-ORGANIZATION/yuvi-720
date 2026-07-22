// @ts-nocheck
/* eslint-disable */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { StudioContent } from './StudioContent'
import { useStudioDesign } from './useStudioDesign'
import '../../styles/yubi-studio.css'

type Phase = 'closed' | 'opening' | 'open' | 'closing'

interface StudioTransitionValue {
  /** Fly Yuvi from a source robot canvas into the studio (shared-element). */
  openStudio: (sourceEl: HTMLElement | null) => void
  isOpen: boolean
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
  const sourceElRef = useRef<HTMLElement | null>(null)
  const runRef = useRef(0)

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
  }, [])

  const overlayMounted = phase !== 'closed'
  const overlayVisible = phase === 'opening' || phase === 'open'

  return (
    <StudioTransitionCtx.Provider value={{ openStudio, isOpen: overlayMounted }}>
      {children}
      {overlayMounted && (
        <div className={`studio-overlay${overlayVisible ? ' is-visible' : ''}`}>
          <StudioContent studio={studio} onClose={() => void closeStudio()} />
        </div>
      )}
    </StudioTransitionCtx.Provider>
  )
}
