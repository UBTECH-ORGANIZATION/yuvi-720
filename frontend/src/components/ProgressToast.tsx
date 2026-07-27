import { useEffect, useRef, useState } from 'react'
import { Badge } from './Badge'
import type { BadgeDTO } from '../features/badges/types'
import '../styles/toast.css'

/**
 * Task-complete toast: the badge's in-progress ring animates from where it was
 * to where it now is, the "+N%" and current percent count up in sync, and a
 * "go to badges" action opens the shelf. Built on the shared `.app-toast`
 * surface (styles/toast.css, `--progress` variant).
 */

const RING_R = 94
const RING_C = 2 * Math.PI * RING_R
const RING_MS = 1050

export interface ProgressToastProps {
  /** the badge, with `progress` = the NEW fill (0..1). */
  badge: BadgeDTO
  /** the fill BEFORE this task, so the ring animates the delta. */
  fromProgress: number
  title: string
  /** e.g. "לכסף" / "to silver" — the tier being worked toward. */
  towardLabel?: string
  actionLabel?: string
  onAction?: () => void
  onDismiss: () => void
  /** auto-dismiss delay in ms (0 disables). */
  autoDismissMs?: number
}

export function ProgressToast({
  badge,
  fromProgress,
  title,
  towardLabel,
  actionLabel = 'לעמוד ההישגים ←',
  onAction,
  onDismiss,
  autoDismissMs = 7000,
}: ProgressToastProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const to = Math.max(0, Math.min(1, badge.progress))
  const from = Math.max(0, Math.min(to, fromProgress))
  const [nowPct, setNowPct] = useState(Math.round(from * 100))
  const deltaPct = Math.max(0, Math.round((to - from) * 100))

  useEffect(() => {
    if (autoDismissMs <= 0) return
    const handle = window.setTimeout(onDismiss, autoDismissMs)
    return () => window.clearTimeout(handle)
  }, [autoDismissMs, onDismiss])

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || to <= from) {
      setNowPct(Math.round(to * 100))
      return
    }
    const ring = rootRef.current?.querySelector<SVGCircleElement>('.yv-badge__ring')
    if (ring) {
      ring.animate(
        [{ strokeDashoffset: RING_C * (1 - from) }, { strokeDashoffset: RING_C * (1 - to) }],
        { duration: RING_MS, easing: 'cubic-bezier(0.4,0,0.2,1)', fill: 'forwards' },
      )
    }
    let raf = 0
    let start: number | null = null
    const step = (ts: number) => {
      if (start === null) start = ts
      const p = Math.min((ts - start) / RING_MS, 1)
      setNowPct(Math.round((from + (to - from) * p) * 100))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [from, to])

  return (
    <div className="app-toast app-toast--progress" role="status" ref={rootRef}>
      <span className="app-toast__icon" aria-hidden>
        <Badge subject={badge.subject} glyph={badge.glyph} tier={badge.tier} state="inprogress" progress={to} noStars />
      </span>
      <div className="app-toast__text">
        <strong>{title}</strong>
        <span>
          <b>+{deltaPct}%</b> · {nowPct}%{towardLabel ? ` ${towardLabel}` : ''}
        </span>
      </div>
      <div className="app-toast__actions">
        {onAction && (
          <button type="button" className="app-toast__cta" onClick={onAction}>
            {actionLabel}
          </button>
        )}
        <button type="button" className="app-toast__close" onClick={onDismiss} aria-label="סגור">
          ✕
        </button>
      </div>
    </div>
  )
}
