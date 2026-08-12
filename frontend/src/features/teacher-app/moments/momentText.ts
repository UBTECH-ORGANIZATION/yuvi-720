/* One moment → one sentence, with nothing missing from the middle of it.
 *
 * A moment arrives as a locale key plus params, never as rendered text, because
 * the teacher can switch language at any time. The catch is that some of those
 * params are optional in practice: the catalogue may not be able to name an
 * objective, and a goal a child set themselves may have been saved with no
 * title. Interpolating a blank leaves the punctuation behind it —
 *
 *     "סיימו את היעד:"
 *
 * — a sentence that stops mid-thought, which reads as a bug in the feed rather
 * than as missing metadata.
 *
 * So every template that can lose a word has an `.unnamed` twin that simply
 * omits the clause, and this picks between them. Generalized from the older
 * check, which tested `{label}` alone: `goalDone` interpolates `{title}` and
 * was the one row that could actually go blank.
 */

type Translate = (key: string, params?: Record<string, string | number>) => string

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g

/** The named holes in a template — `t()` with no params hands back the raw
 *  string, so the sentence itself says what it needs. */
export function placeholdersIn(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1])
}

/** True when this param would interpolate to nothing a reader can see. */
function blank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  return typeof value === 'string' && value.trim().length === 0
}

/** The sentence for one moment, with the unnamed variant used when a word the
 *  template needs is missing — and the named one kept when there is no variant
 *  to fall back to, because a rendered key is worse than a gap. */
export function momentSentence(
  textKey: string,
  params: Record<string, string | number> | null | undefined,
  t: Translate,
): string {
  const template = t(textKey)
  const values = params ?? {}
  const missing = placeholdersIn(template).some((name) => blank(values[name]))
  if (!missing) return t(textKey, values)

  const fallbackKey = `${textKey}.unnamed`
  const fallback = t(fallbackKey)
  // `t()`'s miss behaviour is to render the key, so an absent variant is
  // detectable — and when it is absent the named template is still the better
  // of the two things we can show.
  if (fallback === fallbackKey) return t(textKey, values)
  return t(fallbackKey, values)
}
