/* How many inputs a question needs — asked of the question, not of the answer.
 *
 * A `fill_blank` renders one box per blank, and the number of blanks lives in
 * the ANSWER KEY. That key reaches the two audiences of this player by
 * different routes, and the box count broke on each of them in turn:
 *
 *   the child   — the key is stripped server-side, so `attempts._without_answers`
 *                 re-attaches a `blanks` SHAPE (count + labels, no values).
 *                 Before it did, the player sized the list from what the child
 *                 had already typed: one box for a two-blank question, so the
 *                 second value could never be entered and was marked wrong.
 *   the teacher — the preview gets the raw content with `answer` intact and
 *                 NO `blanks` shape, because nothing strips anything. So the
 *                 same question rendered one box again on the review screen,
 *                 which is the screen that exists to catch exactly this.
 *
 * One fix for both, and for whatever a third caller turns out to be: read the
 * shape from whichever source this copy of the question happens to carry, and
 * fall back to counting the gaps the prompt itself was written with. A question
 * cannot then render fewer boxes than it has answers, whoever is looking at it.
 */

import { partsToText, toRenderParts, type MathSegment } from './mathSegments.ts'

export interface BlankShape {
  label?: string | null
}

/** A run of underscores is how every prompt in this vocabulary writes a gap —
 *  it is what the generator is told to emit and what the content ships. */
const GAP = /_{2,}/g

export function gapsInPrompt(prompt?: MathSegment[]): number {
  if (!prompt?.length) return 0
  return (partsToText(toRenderParts(prompt)).match(GAP) ?? []).length
}

interface AnyQuestion {
  prompt?: MathSegment[]
  blanks?: BlankShape[]
  answer?: { blanks?: { label?: string | null }[] } | null
}

/** The boxes to draw, in order. Never empty: a `fill_blank` with no discoverable
 *  shape still gets one box, because a question with no input at all cannot be
 *  answered and cannot be seen to be broken. */
export function blankShape(question: AnyQuestion): BlankShape[] {
  // The learner's copy: the shape, with the accepted values already gone.
  if (question.blanks?.length) return question.blanks

  // The teacher's copy: the key itself, which carries the same labels.
  const key = question.answer?.blanks
  if (key?.length) return key.map((blank) => ({ label: blank.label ?? null }))

  // Neither — count what the prompt was written with. This is the case for a
  // hand-edited question and for any future caller that passes a bare prompt.
  const gaps = gapsInPrompt(question.prompt)
  return gaps > 0 ? Array.from({ length: gaps }, () => ({})) : [{}]
}
