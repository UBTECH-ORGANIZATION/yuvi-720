/* What the teacher can see right now, as numbers — published by the page,
 * read by the assistant dock.
 *
 * The dock already tells the assistant WHICH screen the teacher is on. It did
 * not tell it what the screen SAYS, so a teacher reading "69% · 583 מתוך 845"
 * off a KPI card and asking what it meant was told the assistant could not see
 * it (#535). Pages that render headline figures publish them here; the dock
 * folds them into the screen block as `visible`, and the server counts them as
 * grounded — they are the teacher's own screen, not a new claim.
 *
 * Numbers and short labels only, never names: the block travels to the model.
 * One publisher at a time — the page on screen — and it clears on unmount so a
 * stale card never describes a screen the teacher has left.
 */

import { useEffect, useSyncExternalStore } from 'react'

export type VisibleValue = number | string | null | undefined
/** Nested as deep as a page needs (per-subject rows under a key), leaves only
 *  numbers or short labels. */
export interface VisibleData { [key: string]: VisibleValue | VisibleData }

let current: VisibleData | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function snapshot() {
  return current
}

/** Drop empty slots so the block stays small; keep zeros — a zero is a fact. */
function compact(data: VisibleData): VisibleData {
  const out: VisibleData = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'object') {
      const inner = compact(value)
      if (Object.keys(inner).length) out[key] = inner
    } else {
      out[key] = value
    }
  }
  return out
}

/** Publish the figures this page shows. Pass `null` while they are loading. */
export function useVisibleScreenData(data: VisibleData | null) {
  // Serialised so a page re-rendering with the same numbers does not re-emit.
  const key = data ? JSON.stringify(data) : ''
  useEffect(() => {
    current = data ? compact(data) : null
    emit()
    return () => { current = null; emit() }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- key IS the data
}

/** The dock's side: whatever the page on screen has published. */
export function useScreenData(): VisibleData | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
