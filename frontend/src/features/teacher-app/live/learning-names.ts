/* Reading catalogue rows as names a teacher can scan. Extracted from
 * LiveClassView when the focus panel moved to its own file (#244) — the live
 * grid and the panel must keep agreeing on what a learning is called. */

import type { LearningRow } from '../../../services/teacher'

/** A raw catalogue id, read as words — the fallback of last resort for rows
 *  the catalogue publishes no name for (the seeded English components today):
 *  "MOE.ENG.G7.PEOPLE.FAMILY.GRAMMAR" → "Family · Grammar". A guess about
 *  presentation only, never about meaning: it reorders nothing and adds no
 *  words the id does not carry. */
export function prettyId(id: string): string {
  const parts = id.split('.')
    .filter((part) => part && !/^(MOE|CET|ENG|MATH|SCI|G\d+)$/i.test(part))
    .slice(-2)
    .map((part) => part
      .replace(/-0*(\d+)$/, ' $1')
      .toLowerCase()
      .replace(/^./, (first) => first.toUpperCase()))
  return parts.join(' · ') || id
}

/** A learning's display name: its own title unless that title IS the raw id
 *  (the catalogue had nothing better), in which case the id reads as words. */
export function learningName(row: LearningRow): string {
  return row.title && row.title !== row.component_id ? row.title : prettyId(row.component_id)
}

/** The part of one learning's name that distinguishes it from its siblings.
 *
 *  Titles inside an objective share a long stem ("כתיבת שיעורי נקודה - …"),
 *  and chips repeating it nine times bury the only words that matter
 *  ("הקניה", "בסיסית 2"). The shared prefix is computed and cut exactly where
 *  the titles diverge — but only honoured when that cut lands on a separator,
 *  so no word is ever split; the full title stays on the chip's tooltip. */
export function variantOf(learning: LearningRow, siblings: LearningRow[]): string {
  const title = learningName(learning)
  if (siblings.length < 2) return title
  const names = siblings.map(learningName)
  let prefix = names[0]
  for (const name of names) {
    let index = 0
    while (index < prefix.length && index < name.length
           && prefix[index] === name[index]) index += 1
    prefix = prefix.slice(0, index)
  }
  if (prefix.length < 8) return title
  const remainder = title.slice(prefix.length)
  const boundary = /[\s\-–:·]$/.test(prefix) || /^[\s\-–:·]/.test(remainder)
  const rest = remainder.replace(/^[\s\-–:·]+/, '').trim()
  return boundary && rest.length >= 2 ? rest : title
}
