/* The submit celebration crosses a navigation: the solve page records it and
 * the task list shows it as a dialog. Module state, not sessionStorage — it
 * must not survive a reload (yesterday's celebration replaying is a bug, not
 * a treat), and the list page can mount twice on arrival, so the reader PEEKS
 * and only the dialog's close clears it. */

import type { SubmitResult } from '../../services/tasks'

let pending: SubmitResult | null = null

export function putCelebration(result: SubmitResult) {
  pending = result
}

export function peekCelebration(): SubmitResult | null {
  return pending
}

export function clearCelebration() {
  pending = null
}
