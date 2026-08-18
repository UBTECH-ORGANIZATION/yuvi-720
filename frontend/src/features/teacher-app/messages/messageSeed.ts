/* An opening carried from somewhere else to the composer.
 *
 * A teacher reading a disclosure presses "write to them", picks one of the
 * three suggested openings, and lands on the messages screen with that student
 * selected and the sentence already in the box — to edit, or to delete and
 * write their own. What they must not have to do is retype it, or worse,
 * remember it while navigating.
 *
 * `sessionStorage`, one tab, read once and gone: the same reasoning as the task
 * builder's seed. This is a click in flight, not state that belongs to anyone.
 * It is never sent by arriving — the teacher still presses send.
 */

const KEY = 'yuvi.teacher.messageSeed'

export interface MessageSeed {
  learnerId: string
  text: string
}

export function putMessageSeed(seed: MessageSeed): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(seed))
  } catch {
    // Private browsing or a full quota: the teacher lands on the right thread
    // with an empty box, which is one paste short of the same place.
  }
}

/* StrictMode invokes a `useState(() => takeMessageSeed())` initializer twice
 * in development, and React keeps the SECOND result — so a strict read-and-
 * clear handed the seed to the discarded render and null to the real one.
 * A just-taken seed stays answerable for a moment; the window is short so a
 * later visit can never be refilled by a stale one. */
let justTaken: { seed: MessageSeed; at: number } | null = null
const RETAKE_MS = 2000

/** Read and clear. An opening acted on is spent — left behind it would refill
 *  the composer the next time the teacher opened messages for anyone. */
export function takeMessageSeed(): MessageSeed | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) {
      return justTaken && Date.now() - justTaken.at < RETAKE_MS
        ? justTaken.seed
        : null
    }
    window.sessionStorage.removeItem(KEY)
    const parsed = JSON.parse(raw) as Partial<MessageSeed>
    const learnerId = String(parsed?.learnerId ?? '').trim()
    const text = String(parsed?.text ?? '').trim()
    if (!learnerId || !text) return null
    const seed = { learnerId, text }
    justTaken = { seed, at: Date.now() }
    return seed
  } catch {
    return null
  }
}
