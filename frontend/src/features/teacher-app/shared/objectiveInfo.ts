/* Objective ids → what they actually are, resolved once per page.
 *
 * Objective ids turn up all over the teacher app — on an alert, in a moment, on
 * a struggle row — and every one of them is a dotted key a teacher cannot read.
 * The obvious fix is a lookup per row, which on the moments feed is twenty-five
 * requests for eight distinct objectives.
 *
 * So: one module-level cache and a batched flush. A component asks for an id,
 * the ask is queued to the end of the microtask, and everything queued in that
 * tick goes out as ONE request. The curriculum does not change while a teacher
 * is looking at it, so entries live for the session.
 *
 * Misses are cached too. An id from a two-year-old event that the catalogue has
 * since dropped would otherwise be re-requested on every render, forever.
 */

import { apiGet } from '../../../services/api'

export interface ObjectiveLesson {
  component_id: string
  title: string | null
  media_format?: string | null
  unit_id?: string | null
}

export interface ObjectiveInfo {
  id: string
  title: string
  subject: string | null
  description: string
  topic_title: string
  curriculum_title: string
  order: number | null
  prerequisites: { id: string; title: string }[]
  lessons: ObjectiveLesson[]
}

/** Keyed by `lang:id`, because a title is language-specific and the teacher can
 *  switch language without the page remounting. `null` is a cached miss. */
const cache = new Map<string, ObjectiveInfo | null>()
const inFlight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

let queued: Map<string, Set<string>> = new Map()
let scheduled = false

function announce() {
  for (const listener of [...listeners]) listener()
}

/** Subscribe to cache growth. Returns the unsubscribe. */
export function onObjectivesResolved(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function cachedObjective(id: string, language: string): ObjectiveInfo | null | undefined {
  return cache.get(`${language}:${id}`)
}

async function flush(language: string, ids: string[]): Promise<void> {
  try {
    const payload = await apiGet<{ objectives: ObjectiveInfo[]; unknown: string[] }>(
      `/api/teacher/objectives?lang=${encodeURIComponent(language)}`
      + `&ids=${encodeURIComponent(ids.join(','))}`
    )
    for (const row of payload.objectives ?? []) cache.set(`${language}:${row.id}`, row)
    for (const id of payload.unknown ?? []) cache.set(`${language}:${id}`, null)
  } catch {
    // A failed lookup is not a cached miss: the id may be perfectly good and
    // the network merely down, and caching `null` here would make a transient
    // failure permanent for the rest of the session.
    for (const id of ids) inFlight.delete(`${language}:${id}`)
    return
  }
  announce()
}

/** Ask for an objective. Safe to call from render — it never sets state itself,
 *  and repeat calls for the same id collapse into one request. */
export function requestObjective(id: string, language: string): void {
  if (!id) return
  const key = `${language}:${id}`
  if (cache.has(key) || inFlight.has(key)) return

  const batch = queued.get(language) ?? new Set<string>()
  batch.add(id)
  queued.set(language, batch)

  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    const pending = queued
    queued = new Map()
    scheduled = false
    for (const [lang, batchIds] of pending) {
      const ids = [...batchIds]
      const promise = flush(lang, ids)
      for (const batchId of ids) inFlight.set(`${lang}:${batchId}`, promise)
      void promise.finally(() => {
        for (const batchId of ids) inFlight.delete(`${lang}:${batchId}`)
      })
    }
  })
}

/** Test seam: the cache is module state and would otherwise leak across cases. */
export function resetObjectiveCache(): void {
  cache.clear()
  inFlight.clear()
  queued = new Map()
  scheduled = false
}
