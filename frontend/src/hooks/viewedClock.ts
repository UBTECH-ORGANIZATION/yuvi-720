/* How long a screen was actually looked at.
 *
 * The MoE 720 `dashboard/viewed` statement carries `result.duration` — the
 * time the viewing took, filed when it ends. Wall-clock since mount is the
 * wrong number: a teacher who opens a board, switches to another tab for an
 * hour and comes back did not look at it for an hour. The clock counts only
 * the stretches the document was visible. Pure so it can be tested without a
 * browser; the hook feeds it `visibilitychange`.
 */

export interface ViewedClock {
  /** Sum of the finished visible stretches, in milliseconds. */
  accrued: number
  /** When the current visible stretch began, or null while hidden. */
  visibleSince: number | null
}

export function startClock(now: number, visible: boolean): ViewedClock {
  return { accrued: 0, visibleSince: visible ? now : null }
}

/** The document went hidden or came back. Idempotent for repeated events. */
export function visibilityChanged(clock: ViewedClock, now: number, visible: boolean): ViewedClock {
  if (visible) {
    return clock.visibleSince === null ? { ...clock, visibleSince: now } : clock
  }
  if (clock.visibleSince === null) return clock
  return { accrued: clock.accrued + Math.max(0, now - clock.visibleSince), visibleSince: null }
}

/** Visible time so far, in whole seconds, capped at the server's window. */
export function elapsedSeconds(clock: ViewedClock, now: number, cap = 28_800): number {
  const open = clock.visibleSince === null ? 0 : Math.max(0, now - clock.visibleSince)
  return Math.min(cap, Math.round((clock.accrued + open) / 1_000))
}
