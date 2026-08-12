/* A fill-in question must never render fewer boxes than it has answers.
 *
 * This has now broken twice, on two different audiences, for the same reason:
 * the blank COUNT lives in the answer key, and the key reaches the child and
 * the teacher by different routes. The child's copy has the key stripped and a
 * `blanks` shape re-attached; the teacher's preview has the key and no shape.
 * Whichever one a caller happens to hold, the box count has to come out right.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { blankShape, gapsInPrompt } from '../src/features/tasks/questionShape.ts'

const text = (value: string) => [{ type: 'text' as const, text: value }]

describe('blankShape', () => {
  it("uses the child's stripped shape when it is there", () => {
    const shape = blankShape({ blanks: [{ label: 'x' }, { label: 'y' }] })
    assert.equal(shape.length, 2)
    assert.deepEqual(shape.map((blank) => blank.label), ['x', 'y'])
  })

  it("uses the teacher's key when there is no stripped shape", () => {
    // The bug the review screen showed: two accepted answers, one box drawn.
    const shape = blankShape({
      answer: { blanks: [{ accept: ['מסה'] }, { accept: ['נפח'] }] },
    })
    assert.equal(shape.length, 2)
  })

  it('carries the labels through from the key', () => {
    const shape = blankShape({
      answer: { blanks: [{ accept: ['5'], label: 'x' }, { accept: ['7'], label: 'y' }] },
    })
    assert.deepEqual(shape.map((blank) => blank.label), ['x', 'y'])
  })

  it('counts the gaps in the prompt when it has neither', () => {
    const shape = blankShape({
      prompt: text('אם בודקים כמה חומר יש בגוף — מודדים ___; אם כמה מקום — מודדים ___.'),
    })
    assert.equal(shape.length, 2)
  })

  it('never renders zero boxes', () => {
    // A question with no input cannot be answered AND cannot be seen to be
    // broken, which is the worse of the two failures.
    assert.equal(blankShape({}).length, 1)
    assert.equal(blankShape({ prompt: text('אין כאן שום פער') }).length, 1)
  })

  it('prefers the stripped shape over the key, so the learner lane cannot leak', () => {
    // Both present should not happen, but if it does the answers must not be
    // the thing that decides what is drawn.
    const shape = blankShape({
      blanks: [{ label: 'a' }],
      answer: { blanks: [{ accept: ['1'] }, { accept: ['2'] }] },
    })
    assert.equal(shape.length, 1)
  })
})

describe('gapsInPrompt', () => {
  it('counts runs of underscores, not single ones', () => {
    assert.equal(gapsInPrompt(text('a ___ b ___ c')), 2)
    assert.equal(gapsInPrompt(text('snake_case is not a gap')), 0)
  })

  it('is zero for an empty or missing prompt', () => {
    assert.equal(gapsInPrompt(), 0)
    assert.equal(gapsInPrompt([]), 0)
  })
})
