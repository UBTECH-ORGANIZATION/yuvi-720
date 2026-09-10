/* The parent half of the game harness protocol.
 *
 *   node --test frontend/tests/
 *
 * The game grades itself; the host only listens. What the player must get
 * right is to listen ONLY to the frame it is showing (the nonce) and to pass
 * every event through untouched — a `learn.done` that loses its progress
 * would end a game without a score, and a stray `learn.progress` from another
 * tab would move this one's.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createHostBridge, isNoiseError, parseNonce } from '../src/features/games/hostBridge.ts'

const NONCE = 'n-4f2a'

describe('parseNonce', () => {
  it('reads the nonce the server wrote into the page', () => {
    assert.equal(parseNonce('<script>window.__YUVI_NONCE = "abc123";</script>'), 'abc123')
    assert.equal(parseNonce("<script>window.__YUVI_NONCE='q';</script>"), 'q')
  })

  it('returns null for a page without one', () => {
    assert.equal(parseNonce('<html><body>hi</body></html>'), null)
  })
})

describe('nonce filtering', () => {
  it('ignores frames from the wrong game, a wrong source, or no nonce', () => {
    let ready = 0
    const bridge = createHostBridge({
      nonce: NONCE,
      onReady: () => { ready += 1 },
    })
    assert.equal(bridge.handle({ source: 'yuvi-game', type: 'ready', nonce: 'other' }), false)
    assert.equal(bridge.handle({ source: 'yuvi-game', type: 'ready' }), false)
    assert.equal(bridge.handle({ source: 'someone-else', type: 'ready', nonce: NONCE }), false)
    assert.equal(bridge.handle('not an object'), false)
    assert.equal(bridge.handle(null), false)
    assert.equal(ready, 0)
  })

  it('trusts nothing when the page had no nonce at all', () => {
    const bridge = createHostBridge({
      nonce: '',
      onReady: () => assert.fail('an empty nonce must not match an empty nonce'),
    })
    assert.equal(bridge.handle({ source: 'yuvi-game', type: 'ready', nonce: '' }), false)
  })

  it('handles frames carrying the right nonce', () => {
    const seen: string[] = []
    const bridge = createHostBridge({
      nonce: NONCE,
      onReady: () => seen.push('ready'),
      onAsked: (id, index) => seen.push(`asked:${id}:${index}`),
      onAnswered: (id, correct) => seen.push(`answered:${id}:${correct}`),
      onDone: (progress) => seen.push(`done:${progress.correct}/${progress.answered}`),
    })
    bridge.handle({ source: 'yuvi-game', type: 'ready', nonce: NONCE, mode: 'free' })
    bridge.handle({ source: 'yuvi-game', type: 'learn.asked', nonce: NONCE, questionId: 'q1', index: 0 })
    bridge.handle({ source: 'yuvi-game', type: 'learn.answered', nonce: NONCE, questionId: 'q1', correct: true })
    bridge.handle({ source: 'yuvi-game', type: 'learn.done', nonce: NONCE, progress: { asked: 4, answered: 4, correct: 3 } })
    assert.deepEqual(seen, ['ready', 'asked:q1:0', 'answered:q1:true', 'done:3/4'])
  })

  it('does not know the frames the old graded protocol used', () => {
    const bridge = createHostBridge({ nonce: NONCE })
    assert.equal(bridge.handle({ source: 'yuvi-game', type: 'learn.answer', nonce: NONCE, requestId: 'a1', answer: '7' }), false)
    assert.equal(bridge.handle({ source: 'yuvi-game', type: 'learn.next', nonce: NONCE, requestId: 'n1', index: 0 }), false)
  })
})

describe('the game reports, the host listens', () => {
  it('ready needs no total — the game decides how long it is', () => {
    let ready = 0
    const bridge = createHostBridge({ nonce: NONCE, onReady: () => { ready += 1 } })
    assert.equal(bridge.handle({ source: 'yuvi-game', type: 'ready', nonce: NONCE }), true)
    assert.equal(ready, 1)
  })

  it('learn.done carries the progress and the summary', () => {
    const done: unknown[] = []
    const bridge = createHostBridge({
      nonce: NONCE,
      onDone: (progress, summary) => done.push({ progress, summary }),
    })
    bridge.handle({
      source: 'yuvi-game', type: 'learn.done', nonce: NONCE,
      progress: { asked: 5, answered: 5, correct: 4, score: 120 }, summary: { stars: 3 },
    })
    assert.deepEqual(done, [{ progress: { asked: 5, answered: 5, correct: 4 }, summary: { stars: 3 } }])
    // A game that ended without telling us anything still ends.
    bridge.handle({ source: 'yuvi-game', type: 'learn.done', nonce: NONCE })
    assert.deepEqual(done[1], { progress: { asked: 0, answered: 0, correct: 0 }, summary: null })
  })

  it('learn.progress reaches onProgress with the counters and the game state', () => {
    const moves: unknown[] = []
    const bridge = createHostBridge({
      nonce: NONCE,
      onProgress: (progress, state) => moves.push({ progress, score: state.score, level: state.level }),
    })
    assert.equal(bridge.handle({
      source: 'yuvi-game', type: 'learn.progress', nonce: NONCE,
      state: { asked: 2, answered: 2, correct: 1, score: 40, level: 2 },
    }), true)
    // Counters at the top level, as an older harness posts them.
    assert.equal(bridge.handle({
      source: 'yuvi-game', type: 'learn.progress', nonce: NONCE,
      asked: 3, answered: 3, correct: 2, score: 70,
    }), true)
    assert.deepEqual(moves, [
      { progress: { asked: 2, answered: 2, correct: 1 }, score: 40, level: 2 },
      { progress: { asked: 3, answered: 3, correct: 2 }, score: 70, level: undefined },
    ])
  })
})

describe('runtime errors', () => {
  it('collects real errors and drops browser noise', () => {
    const errors: string[] = []
    const bridge = createHostBridge({
      nonce: NONCE,
      onError: (error) => errors.push(error.message),
    })
    bridge.handle({ source: 'yuvi-game', type: 'error', nonce: NONCE, message: 'Script error.' })
    bridge.handle({ source: 'yuvi-game', type: 'error', nonce: NONCE, message: 'ResizeObserver loop completed with undelivered notifications.' })
    bridge.handle({ source: 'yuvi-game', type: 'error', nonce: NONCE, message: 'player is not defined', line: 42 })
    assert.deepEqual(errors, ['player is not defined'])
    assert.equal(isNoiseError('Script error'), true)
    assert.equal(isNoiseError('TypeError: x is null'), false)
  })
})
