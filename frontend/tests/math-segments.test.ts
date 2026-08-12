/* The Hebrew+math contract, tested as data.
 *
 *   node --test frontend/tests/
 *
 * This is the highest-risk part of the whole task feature and the one that
 * cannot be checked by eye: a formula whose minus sign has migrated to the
 * other end still *looks* like a formula. Every case below is a specific way
 * bidi breaks Hebrew-plus-math, and each one was expensive to learn once.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  needsSpaceBetween, normalizeMathExpression, partsToText, splitLoose,
  splitTrailingPunctuation, toRenderParts, type MathSegment,
} from '../src/features/tasks/mathSegments.ts'

describe('the isolate wraps only the math', () => {
  it('a segment array keeps prose and formula apart', () => {
    const segments: MathSegment[] = [
      { type: 'text', text: 'האות ' },
      { type: 'math', value: 'b', punctuation: '' },
      { type: 'text', text: ' היא ' },
      { type: 'math', value: 'b = -4', punctuation: '.' },
    ]
    const parts = toRenderParts(segments)
    assert.deepEqual(parts.map((part) => part.kind),
      ['text', 'math', 'text', 'math'])
    assert.equal(partsToText(parts), 'האות b היא b = -4.')
  })

  it('trailing punctuation lands OUTSIDE the formula', () => {
    // Inside the isolate, the full stop of a Hebrew sentence renders at the
    // wrong end of the equation.
    const [part] = toRenderParts([{ type: 'math', value: 'x = 5.' }])
    assert.equal(part.kind, 'math')
    assert.equal(part.kind === 'math' && part.value, 'x = 5')
    assert.equal(part.kind === 'math' && part.punctuation, '.')
  })

  it("the author's own punctuation field wins over a stop left in the value", () => {
    const [part] = toRenderParts([{ type: 'math', value: 'x = 5', punctuation: '?' }])
    assert.equal(part.kind === 'math' && part.punctuation, '?')
  })

  it('splits punctuation only at the end, never mid-expression', () => {
    assert.deepEqual(splitTrailingPunctuation('3.5 + 1'), { body: '3.5 + 1', punctuation: '' })
    assert.deepEqual(splitTrailingPunctuation('3 + 1.'), { body: '3 + 1', punctuation: '.' })
  })
})

describe('finding math inside a plain Hebrew sentence', () => {
  it('a formula in prose becomes its own part', () => {
    const parts = splitLoose('פתרו את התרגיל 3 + 4 = 7 ורשמו את התשובה')
    const math = parts.filter((part) => part.kind === 'math')
    assert.equal(math.length, 1)
    assert.equal(math[0].kind === 'math' && math[0].value, '3 + 4 = 7')
  })

  it('a Hebrew letter touching a digit is NOT swallowed into the formula', () => {
    /* The negative lookbehind. Without it the match starts inside the Hebrew
       word, and a chunk of the sentence disappears into an LTR island. */
    const parts = splitLoose('בכיתה ה3 יש 20 תלמידים')
    for (const part of parts) {
      if (part.kind !== 'math') continue
      assert.ok(!/[֐-׿]/.test(part.value),
        `Hebrew leaked into a formula: ${JSON.stringify(part.value)}`)
    }
  })

  it('parentheses containing Hebrew are prose, not math', () => {
    // Otherwise every parenthetical aside is treated as an expression.
    const parts = splitLoose('הפתרון (ראו בעמוד הקודם) פשוט')
    assert.equal(parts.filter((part) => part.kind === 'math').length, 0)
  })

  it('parentheses containing only math ARE math', () => {
    const parts = splitLoose('חשבו (3 + 4) × 2')
    const math = parts.filter((part) => part.kind === 'math')
    assert.equal(math.length, 1)
    assert.match(math[0].kind === 'math' ? math[0].value : '', /\(3 \+ 4\) × 2/)
  })

  it('a sentence with no math is left entirely alone', () => {
    const parts = splitLoose('כתבו תשובה מלאה במילים שלכם')
    assert.equal(parts.length, 1)
    assert.equal(parts[0].kind, 'text')
  })

  it('never loses or invents a character', () => {
    /* The property that catches every off-by-one in the scanner at once: the
       parts must reconstruct the input, modulo the spacing inserted on
       purpose and the operator spacing normalization. */
    const inputs = [
      'פתרו 2 + 2 = 4 בבקשה',
      'x = 5 וגם y = 7',
      'אין כאן מתמטיקה בכלל',
      'הסבירו למה 10 - 3 = 7.',
    ]
    for (const input of inputs) {
      const rebuilt = partsToText(splitLoose(input))
      assert.equal(rebuilt.replace(/\s+/g, ''), input.replace(/\s+/g, ''),
        `round trip changed: ${input} → ${rebuilt}`)
    }
  })
})

describe('spacing where Hebrew abuts math', () => {
  it('opens a gap, because bidi collapses the visual one', () => {
    assert.equal(needsSpaceBetween('שווה', '5'), true)
  })

  it('leaves an existing space alone', () => {
    assert.equal(needsSpaceBetween('שווה ', '5'), false)
    assert.equal(needsSpaceBetween('שווה', ' 5'), false)
  })

  it('does not push punctuation away from its word', () => {
    assert.equal(needsSpaceBetween('5', '.'), false)
    assert.equal(needsSpaceBetween('5', ')'), false)
  })

  it('does not break a hyphenated join', () => {
    assert.equal(needsSpaceBetween('פי-', '3'), false)
    assert.equal(needsSpaceBetween('(', '3'), false)
  })

  it('inserts the gap when rendering adjacent segments', () => {
    const parts = toRenderParts([
      { type: 'text', text: 'התוצאה היא' },
      { type: 'math', value: '42' },
    ])
    assert.equal(partsToText(parts), 'התוצאה היא 42')
  })
})

describe('expression normalization', () => {
  it('spaces operators evenly however they were written', () => {
    assert.equal(normalizeMathExpression('3+4=7'), '3 + 4 = 7')
    assert.equal(normalizeMathExpression('3   +   4'), '3 + 4')
  })

  it('normalizes the Unicode minus to a hyphen', () => {
    // U+2212 is what a generator often emits; comparisons and fonts both
    // behave better with the ASCII one.
    assert.equal(normalizeMathExpression('5 − 2'), '5 - 2')
  })

  it('tightens brackets', () => {
    assert.equal(normalizeMathExpression('( 3 + 4 )'), '(3 + 4)')
  })

  it('a sign is not a subtraction', () => {
    /* `b = -4` is negative four. Spacing it as `b = - 4` reads as an unfinished
       subtraction, and it is what a naive "put spaces around every minus" rule
       produces — the reference implementation this borrows from does exactly
       that. A minus is binary only between two operands. */
    assert.equal(normalizeMathExpression('b = -4'), 'b = -4')
    assert.equal(normalizeMathExpression('x=-3'), 'x = -3')
    assert.equal(normalizeMathExpression('(-5) + 2'), '(-5) + 2')
    assert.equal(normalizeMathExpression('-7 + 2'), '-7 + 2')
    // Still spaced when it really is a subtraction.
    assert.equal(normalizeMathExpression('10-3'), '10 - 3')
    assert.equal(normalizeMathExpression('x² - 5x + 6 = 0'), 'x² - 5x + 6 = 0')
  })
})

describe('robustness', () => {
  it('empty and missing content render nothing rather than throwing', () => {
    for (const input of [null, undefined, '', []]) {
      assert.deepEqual(toRenderParts(input as never), [])
    }
  })

  it('a malformed segment is skipped, not fatal', () => {
    const parts = toRenderParts([
      { type: 'math', value: '' } as MathSegment,
      { type: 'text', text: 'שלום' },
    ])
    assert.equal(partsToText(parts), 'שלום')
  })

  it('a plain string is accepted where segments were expected', () => {
    // The generator will not always split correctly; this must still render.
    const parts = toRenderParts('כמה זה 2 + 2?')
    assert.ok(parts.some((part) => part.kind === 'math'))
  })
})
