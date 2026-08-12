/* The catalogue of hero scenes — the keys, and the contract around them.
 *
 * Kept apart from the drawing so `node --test` can read the key list without a
 * DOM, and so the contract test between this and `daily_brief.SCENES` has one
 * unambiguous thing to compare.
 *
 * Nothing here is generated at runtime. The model picks a MOOD from the closed
 * set below and code draws the matching hand-authored composition; a model
 * asked for SVG returns off-palette, broken geometry into the most-looked-at
 * rectangle in the portal, with no review step before a teacher sees it.
 */

/** The moods, in the order they were designed. Must match `daily_brief.SCENES`. */
export const SCENE_KEYS = [
  'celebrating',   // real ground gained
  'cheering_on',   // a few moved, others lagged
  'pointing',      // one gap is the thing to teach next
  'waiting',       // a quiet week, or a class that has not started
  'thinking',      // too little to say yet
] as const

export type SceneKey = (typeof SCENE_KEYS)[number]

/** What renders when the mood is unknown, missing, or new to this build. */
export const DEFAULT_SCENE: SceneKey = 'thinking'

export function isSceneKey(value: unknown): value is SceneKey {
  return typeof value === 'string' && (SCENE_KEYS as readonly string[]).includes(value)
}

/** The subject a prop is drawn for. `generic` is a real choice, not a fallback
 *  hole: most weeks span subjects and a beaker would be a lie about those. */
export const PROP_KEYS = ['math', 'science', 'english', 'generic'] as const
export type PropKey = (typeof PROP_KEYS)[number]

/** Backend subjects are freeform strings; this maps them onto the four props. */
export function propFor(subject: string | null | undefined): PropKey {
  const key = (subject ?? '').trim().toLowerCase()
  if (key === 'math' || key === 'mathematics') return 'math'
  if (key === 'science' || key === 'biology' || key === 'physics'
      || key === 'chemistry' || key === 'astronomy') return 'science'
  if (key === 'english') return 'english'
  return 'generic'
}
