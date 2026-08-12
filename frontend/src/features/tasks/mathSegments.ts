/* Hebrew and math in one sentence — the contract, as pure functions.
 *
 * The rule learned the hard way, and not worth re-deriving: **you cannot put
 * Hebrew and math in the same string.** A formula dropped into a Hebrew
 * paragraph joins that paragraph's bidi run, and `x² - 5x + 6 = 0` comes out
 * with its minus and its equals in the wrong places. Everything below follows
 * from that.
 *
 * So a field that can contain math is a *segment array*, authored that way by
 * the generator and normalized server-side (`app/services/tasks/spec.py`):
 *
 *     [{type:'text', text:'האות '},
 *      {type:'math', value:'b = -4', punctuation:'.'}]
 *
 * A model will still hand back a plain sentence sometimes, so `splitLoose`
 * finds the formulas in one heuristically. That path is a fallback, not the
 * design — it exists so an imperfect payload still renders.
 *
 * ── the four details that are only obvious after they bite ──────────────────
 *
 * 1. **Trailing punctuation goes OUTSIDE the isolate.** Inside it, the full
 *    stop of a Hebrew sentence lands at the wrong end of the formula.
 * 2. **Math detection needs a negative lookbehind on Hebrew.** Without it a
 *    Hebrew letter touching a digit is swallowed into the "formula".
 * 3. **Parentheses are only math if they contain no Hebrew.** Otherwise every
 *    parenthetical aside in the prose is treated as an expression.
 * 4. **A space is inserted where Hebrew abuts a math token**, because bidi
 *    collapses the visual gap and the words run into the numbers.
 *
 * This module returns data. The rendering half (`MathText.tsx`) turns it into
 * React elements — never an HTML string, because every one of these fields is
 * model-generated and `dangerouslySetInnerHTML` over model output is one
 * missed escape away from being an injection.
 */

export type MathSegment =
  | { type: 'text'; text: string }
  | { type: 'math'; value: string; punctuation?: string }

/** A piece of a rendered line: prose, or an isolated formula. */
export type RenderPart =
  | { kind: 'text'; text: string }
  | { kind: 'math'; value: string; punctuation: string }

const HEBREW_ARABIC = '\\u0590-\\u05FF\\u0600-\\u06FF'
const RTL_LETTER = new RegExp(`[${HEBREW_ARABIC}]`)

/* A math "atom": a number, a variable term, a root, a fraction, a blank, or a
   parenthesised group with NO Hebrew in it (detail 3). */
const NUMBER = '\\d+(?:[.,]\\d+)?(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?'
const VAR_TERM = `(?:\\d+(?:[.,]\\d+)?\\s*)?[A-Za-z][A-Za-z0-9]*(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?`
const ROOT = `(?:${NUMBER}\\s*)?√\\s*(?:${NUMBER}|${VAR_TERM}|\\([^()]+\\))`
const FRACTION = `(?:(?:${NUMBER}|${VAR_TERM})\\s*/\\s*(?:${NUMBER}|${VAR_TERM}))`
const PARENS = `\\([^()${HEBREW_ARABIC}]+\\)`
const ATOM = `(?:[+\\-−–—]?\\s*)?(?:${ROOT}|${FRACTION}|${PARENS}|${VAR_TERM}|${NUMBER}|_{2,}|\\?)`
const OPERATOR = '[+\\-−–—×÷=·*<>≤≥≠]'

/* Two or more atoms joined by operators — `3 + 4 = 7`, `x² - 5x + 6 = 0`.
   The lookbehind is detail 2: without it, the "ה" in "מה3" starts a match. */
const CHAIN = new RegExp(
  `(?<![${HEBREW_ARABIC}])${ATOM}(?:\\s*${OPERATOR}\\s*${ATOM})+`, 'g'
)

/** Trailing sentence punctuation, which must never enter the isolate. */
export function splitTrailingPunctuation(value: string): {
  body: string; punctuation: string
} {
  const match = value.match(/^([\s\S]*?)([.,!?;:]+)$/)
  if (!match) return { body: value, punctuation: '' }
  return { body: match[1] ?? '', punctuation: match[2] ?? '' }
}

/** Even spacing around operators, so `3+4=7` and `3 + 4 = 7` render alike. */
export function normalizeMathExpression(value: string): string {
  return String(value ?? '')
    .replace(/−/g, '-')
    .replace(/\s*([=±×÷<>≤≥≠])\s*/g, ' $1 ')
    .replace(/\s*\+\s*/g, ' + ')
    /* A minus is binary only BETWEEN two operands. Everywhere else it is a
       sign: `b = -4` is negative four, and spacing it as `b = - 4` reads as an
       unfinished subtraction. A blanket "space every minus" rule — which is
       what the reference implementation does — gets this wrong every time a
       negative number appears, which in algebra is constantly. */
    .replace(/\s*-\s*/g, (_match, offset: number, whole: string) => {
      const before = whole.slice(0, offset).trimEnd()
      return /[\dA-Za-z)⁰¹²³⁴⁵⁶⁷⁸⁹]$/.test(before) ? ' - ' : ' -'
    })
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when a gap has to be opened between prose and an adjacent formula. */
export function needsSpaceBetween(before: string, after: string): boolean {
  if (!before || !after) return false
  if (/\s$/.test(before) || /^\s/.test(after)) return false
  // An opening bracket or a hyphen is already a join; punctuation closes one.
  if (/[([{־\-]$/.test(before)) return false
  if (/^[.,!?;:)\]}]/.test(after)) return false
  return true
}

/**
 * Find the formulas inside a plain sentence.
 *
 * The fallback path, for a payload that arrived as one string instead of
 * segments. Prose comes back as `text` parts and each formula as a `math`
 * part with its trailing punctuation split off.
 */
export function splitLoose(input: string): RenderPart[] {
  const source = String(input ?? '')
  if (!source) return []

  const parts: RenderPart[] = []
  let cursor = 0

  for (const match of source.matchAll(CHAIN)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (start > cursor) parts.push({ kind: 'text', text: source.slice(cursor, start) })

    // Punctuation immediately after the formula belongs to the sentence.
    const trailing = source.slice(end).match(/^[.,!?;:]+/)
    const punctuation = trailing ? trailing[0] : ''
    parts.push({
      kind: 'math',
      value: normalizeMathExpression(match[0]),
      punctuation,
    })
    cursor = end + punctuation.length
  }

  if (cursor < source.length) parts.push({ kind: 'text', text: source.slice(cursor) })
  return parts
}

/**
 * A segment array, flattened into render parts.
 *
 * Text segments are still passed through `splitLoose`: a generator that mostly
 * splits correctly will occasionally leave `2 + 2` inside a text segment, and
 * catching it here costs nothing.
 */
export function toRenderParts(input: string | MathSegment[] | null | undefined): RenderPart[] {
  if (!input) return []
  if (typeof input === 'string') return withSpacing(splitLoose(input))

  const parts: RenderPart[] = []
  for (const segment of input) {
    if (!segment) continue
    if (segment.type === 'math') {
      const { body, punctuation } = splitTrailingPunctuation(String(segment.value ?? ''))
      const value = normalizeMathExpression(body)
      if (!value) continue
      parts.push({
        kind: 'math',
        value,
        // The author's own punctuation field wins; a stop left inside `value`
        // is the fallback.
        punctuation: segment.punctuation ?? punctuation,
      })
    } else {
      parts.push(...splitLoose(String(segment.text ?? '')))
    }
  }
  return withSpacing(parts)
}

/** Detail 4: open a gap wherever prose and a formula would touch. */
function withSpacing(parts: RenderPart[]): RenderPart[] {
  const out: RenderPart[] = []
  for (const part of parts) {
    const previous = out[out.length - 1]
    if (previous) {
      const before = previous.kind === 'math'
        ? previous.value + previous.punctuation : previous.text
      const after = part.kind === 'math' ? part.value : part.text
      if (needsSpaceBetween(before, after)) {
        if (previous.kind === 'text') previous.text += ' '
        else out.push({ kind: 'text', text: ' ' })
      }
    }
    out.push(part)
  }
  return out.filter((part) => part.kind === 'math' || part.text !== '')
}

/** Plain text, for aria-labels, search and anywhere HTML is not wanted. */
export function partsToText(parts: RenderPart[]): string {
  return parts
    .map((part) => (part.kind === 'math' ? part.value + part.punctuation : part.text))
    .join('')
}

/** True when a string contains Hebrew or Arabic — the direction decision. */
export function hasRtl(value: string): boolean {
  return RTL_LETTER.test(value)
}
