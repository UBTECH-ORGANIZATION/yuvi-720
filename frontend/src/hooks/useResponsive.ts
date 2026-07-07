/* Shared responsive hook — the single source of truth for breakpoint logic in
   React. CSS handles fluid sizing/layout (tokens.css + responsive.css); this
   hook is for the cases where the *component tree* must branch (e.g. skip
   mounting a heavy 3D canvas on phones, swap a grid for a carousel).

   Breakpoints are kept in one place and mirror the CSS `--sp-bp-*` tokens:
     phone   : < 600px
     tablet  : 600–899px
     desktop : 900–1199px
     xl      : 1200–1599px
     xxl     : ≥ 1600px
   Keep these in sync with styles/tokens.css. */
import { useSyncExternalStore } from 'react'

export type Breakpoint = 'phone' | 'tablet' | 'desktop' | 'xl' | 'xxl'

export const BREAKPOINTS = {
  /** phone → tablet */
  sm: 600,
  /** tablet → desktop */
  md: 900,
  /** desktop → xl */
  lg: 1200,
  /** xl → xxl */
  xl: 1600
} as const

const ORDER: Breakpoint[] = ['phone', 'tablet', 'desktop', 'xl', 'xxl']

function breakpointForWidth(width: number): Breakpoint {
  if (width < BREAKPOINTS.sm) return 'phone'
  if (width < BREAKPOINTS.md) return 'tablet'
  if (width < BREAKPOINTS.lg) return 'desktop'
  if (width < BREAKPOINTS.xl) return 'xl'
  return 'xxl'
}

/* One shared listener for the whole app, so N components don't each attach a
   resize handler. Components subscribe via useSyncExternalStore. */
let listeners = new Set<() => void>()
let currentWidth = typeof window !== 'undefined' ? window.innerWidth : BREAKPOINTS.md
let bound = false

function onResize() {
  const next = window.innerWidth
  if (next === currentWidth) return
  currentWidth = next
  listeners.forEach((fn) => fn())
}

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') return () => {}
  listeners.add(callback)
  if (!bound) {
    window.addEventListener('resize', onResize, { passive: true })
    window.addEventListener('orientationchange', onResize, { passive: true })
    bound = true
  }
  return () => {
    listeners.delete(callback)
    if (listeners.size === 0 && bound) {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      bound = false
    }
  }
}

function getSnapshot() {
  return currentWidth
}

function getServerSnapshot() {
  // SSR / first paint fallback: assume tablet so layout is never phone-locked.
  return BREAKPOINTS.md
}

export interface Responsive {
  /** Live viewport width in px. */
  width: number
  /** Coarse bucket: 'phone' | 'tablet' | 'desktop' | 'xl' | 'xxl'. */
  breakpoint: Breakpoint
  isPhone: boolean
  isTablet: boolean
  isDesktop: boolean
  /** Large desktop: 1200–1599px. */
  isXl: boolean
  /** Ultrawide / very large: ≥ 1600px. */
  isXxl: boolean
  /** Phone or tablet — anything below desktop. */
  isCompact: boolean
  /** xl or xxl — anything above a standard laptop. */
  isWide: boolean
  /** Coarse pointer (touch) primary input. */
  isTouch: boolean
  /** True when the viewport is at most `bp` wide (inclusive of that bucket). */
  atMost: (bp: Breakpoint) => boolean
  /** True when the viewport is at least `bp` wide (inclusive of that bucket). */
  atLeast: (bp: Breakpoint) => boolean
}

/**
 * Reactive viewport info. Prefer CSS for styling; use this only when the
 * component structure itself must change across breakpoints.
 */
export function useResponsive(): Responsive {
  const width = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const breakpoint = breakpointForWidth(width)
  const index = ORDER.indexOf(breakpoint)
  const isTouch =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches

  return {
    width,
    breakpoint,
    isPhone: breakpoint === 'phone',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop',
    isXl: breakpoint === 'xl',
    isXxl: breakpoint === 'xxl',
    isCompact: breakpoint === 'phone' || breakpoint === 'tablet',
    isWide: breakpoint === 'xl' || breakpoint === 'xxl',
    isTouch,
    atMost: (bp) => index <= ORDER.indexOf(bp),
    atLeast: (bp) => index >= ORDER.indexOf(bp)
  }
}

/**
 * Low-level media-query subscription for one-off queries not covered by the
 * breakpoint buckets (e.g. `(prefers-reduced-motion: reduce)`).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', callback)
      return () => mql.removeEventListener('change', callback)
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false
  )
}
