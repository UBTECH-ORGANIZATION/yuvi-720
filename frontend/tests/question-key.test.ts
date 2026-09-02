/* A poll that names no screen has LOST the learner's position; it has not sent
 * them back to the lesson cover. Adopting it re-filed the next chat message
 * under the Introduction (2026-09-02, COMPL-00001). */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseQuestionKey, pollLosesScreen } from '../src/providers/questionKey.ts'

const COMP = 'CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.COMPL-00001'
const Q1 = `${COMP}|${COMP}-item-00001|q1`
const SCREEN_ONLY = `${COMP}|${COMP}-item-00001|`
const COVER = `${COMP}||`

describe('parseQuestionKey', () => {
  it('splits component, screen and question', () => {
    assert.deepEqual(parseQuestionKey(Q1), { component: COMP, item: `${COMP}-item-00001`, question: 'q1' })
  })
  it('treats null and empty as no position at all', () => {
    assert.deepEqual(parseQuestionKey(null), { component: '', item: '', question: '' })
    assert.deepEqual(parseQuestionKey(''), { component: '', item: '', question: '' })
  })
})

describe('pollLosesScreen', () => {
  it('holds question 1 when the poll comes back with the bare lesson key', () => {
    assert.equal(pollLosesScreen(COVER, Q1), true)
  })
  it('holds the screen when the poll comes back with nothing', () => {
    assert.equal(pollLosesScreen(null, Q1), true)
    assert.equal(pollLosesScreen('', SCREEN_ONLY), true)
  })
  it('lets a poll that names a screen move the learner', () => {
    assert.equal(pollLosesScreen(`${COMP}|${COMP}-item-00002|q1`, Q1), false)
    assert.equal(pollLosesScreen(SCREEN_ONLY, Q1), false)
  })
  it('lets a different lesson through even without a screen', () => {
    assert.equal(pollLosesScreen('other-component||', Q1), false)
  })
  it('never holds anything when the client has no screen yet', () => {
    assert.equal(pollLosesScreen(COVER, null), false)
    assert.equal(pollLosesScreen(COVER, COVER), false)
    assert.equal(pollLosesScreen(Q1, COVER), false)
  })
})
