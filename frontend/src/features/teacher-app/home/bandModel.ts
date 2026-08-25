/* Pure derivations for the students band card (#450) — kept out of the
 * component so `frontend/tests/band-model.test.ts` can pin them without a DOM.
 *
 * Ordering rules, all deliberate:
 *  - ONE flat list (the section-per-band layout was dropped by request),
 *    ordered red → orange → green (the ones who need you first);
 *  - INSIDE a band, students whose band recently CHANGED come first ("new"),
 *    then everyone else — both halves alphabetical, never by any metric, so
 *    the list is a selection order and not a ranking (MoE C5).
 */

import type { Band } from './BandFace'

export interface BandedStudent {
  learner_id: string
  display_name: string | null
  band: {
    band: Band
    reasons: { signal: string; evidence: Record<string, unknown> }[]
    changed_at?: string | null
    previous?: string | null
  }
}

export const BAND_ORDER: Band[] = ['red', 'orange', 'green']

/** Recently moved AND from a real previous band — mirrors the server rule. */
export function isFreshChange(
  band: BandedStudent['band'], now: number = Date.now()
): boolean {
  if (!band.previous || !band.changed_at) return false
  const at = Date.parse(band.changed_at)
  if (Number.isNaN(at)) return false
  return now - at <= 48 * 3600 * 1000
}

/** Which way a fresh mover moved: 'up' toward green, 'down' toward red.
 *  Null for anyone who has not freshly moved — the arrow marks momentum, and
 *  momentum that has settled is just the current band. */
export function moveDirection(
  band: BandedStudent['band'], now: number = Date.now()
): 'up' | 'down' | null {
  if (!isFreshChange(band, now)) return null
  const from = BAND_ORDER.indexOf(band.previous as Band)
  const to = BAND_ORDER.indexOf(band.band)
  if (from < 0 || to === from) return null
  // BAND_ORDER runs red → green, so a larger index is a better place.
  return to > from ? 'up' : 'down'
}

export function applyFilters(
  students: BandedStudent[],
  filters: {
    band?: Band | null
    subgroupLearnerIds?: string[] | null
    /** Only students whose band changed in the freshness window. */
    freshOnly?: boolean
  },
  now: number = Date.now(),
): BandedStudent[] {
  let rows = students
  if (filters.subgroupLearnerIds && filters.subgroupLearnerIds.length) {
    const inSubgroup = new Set(filters.subgroupLearnerIds)
    rows = rows.filter((row) => inSubgroup.has(row.learner_id))
  }
  if (filters.band) rows = rows.filter((row) => row.band.band === filters.band)
  if (filters.freshOnly) rows = rows.filter((row) => isFreshChange(row.band, now))
  return rows
}

export function sortForCard(
  students: BandedStudent[], now: number = Date.now()
): BandedStudent[] {
  const byName = (a: BandedStudent, b: BandedStudent) =>
    (a.display_name || a.learner_id).localeCompare(b.display_name || b.learner_id)
  return BAND_ORDER.flatMap((band) => {
    const rows = students.filter((row) => row.band.band === band)
    const fresh = rows.filter((row) => isFreshChange(row.band, now)).sort(byName)
    const rest = rows.filter((row) => !isFreshChange(row.band, now)).sort(byName)
    return [...fresh, ...rest]
  })
}
