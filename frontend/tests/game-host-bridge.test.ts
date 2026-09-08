/* The parent half of the game harness protocol.
 *
 *   node --test frontend/tests/
 *
 * Two things the player must get right or a game breaks in a way no one can
 * see: it must answer ONLY the frame it is showing (the nonce), and it must
 * always answer `learn.answer` — the harness waits 8 s for a verdict, and a
 * network failure that goes unanswered leaves the child staring at a spinner
 * for that long on every question.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { createHostBridge, isNoiseError, parseNonce, type HostReply } from '../src/features/games/hostBridge.ts'
import { checkAnswer } from '../src/services/games.ts'

const NONCE = 'n-4f2a'
const originalFetch = globalThis.fetch

type FetchCall = { url: string; body: unknown }
const calls: FetchCall[] = []

function stubFetch(response: { status: number; body?: unknown; throws?: boolean }) {
  ;(globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (response.throws) throw new TypeError('Failed to fetch')
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
    }
  }
}

afterEach(() => {
  calls.length = 0
  ;(globalThis as { fetch: unknown }).fetch = originalFetch
})

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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
    const seen: number[] = []
    const bridge = createHostBridge({
      nonce: NONCE,
      check: async () => ({ correct: true, correct_answer: null, feedback: null }),
      onReady: (total) => seen.push(total),
    })
    const reply = () => assert.fail('nothing should be answered')
    assert.equal(bridge.handle({ source: 'yuvi-game', type: 'ready', nonce: 'other', total: 3 }, reply), false)
    assert.equal(bridge.handle({ source: 'yuvi-game', type: 'ready', total: 3 }, reply), false)
    assert.equal(bridge.handle({ source: 'someone-else', type: 'ready', nonce: NONCE, total: 3 }, reply), false)
    assert.equal(bridge.handle('not an object', reply), false)
    assert.equal(bridge.handle(null, reply), false)
    assert.deepEqual(seen, [])
  })

  it('trusts nothing when the page had no nonce at all', () => {
    const bridge = createHostBridge({
      nonce: '',
      check: async () => ({ correct: true, correct_answer: null, feedback: null }),
      onReady: () => assert.fail('an empty nonce must not match an empty nonce'),
    })
    assert.equal(bridge.handle({ source: 'yuvi-game', type: 'ready', nonce: '', total: 1 }, () => undefined), false)
  })

  it('handles frames carrying the right nonce', () => {
    const seen: string[] = []
    const bridge = createHostBridge({
      nonce: NONCE,
      check: async () => ({ correct: true, correct_answer: null, feedback: null }),
      onReady: (total) => seen.push(`ready:${total}`),
      onAsked: (id, index) => seen.push(`asked:${id}:${index}`),
      onAnswered: (id, correct) => seen.push(`answered:${id}:${correct}`),
      onDone: (progress) => seen.push(`done:${progress.correct}/${progress.answered}`),
    })
    const reply = () => undefined
    bridge.handle({ source: 'yuvi-game', type: 'ready', nonce: NONCE, mode: 'parent', total: 4 }, reply)
    bridge.handle({ source: 'yuvi-game', type: 'learn.asked', nonce: NONCE, questionId: 'q1', index: 0 }, reply)
    bridge.handle({ source: 'yuvi-game', type: 'learn.answered', nonce: NONCE, questionId: 'q1', correct: true }, reply)
    bridge.handle({ source: 'yuvi-game', type: 'learn.done', nonce: NONCE, progress: { asked: 4, answered: 4, correct: 3 } }, reply)
    assert.deepEqual(seen, ['ready:4', 'asked:q1:0', 'answered:q1:true', 'done:3/4'])
  })
})

describe('runtime errors', () => {
  it('collects real errors and drops browser noise', () => {
    const errors: string[] = []
    const bridge = createHostBridge({
      nonce: NONCE,
      check: async () => ({ correct: true, correct_answer: null, feedback: null }),
      onError: (error) => errors.push(error.message),
    })
    const reply = () => undefined
    bridge.handle({ source: 'yuvi-game', type: 'error', nonce: NONCE, message: 'Script error.' }, reply)
    bridge.handle({ source: 'yuvi-game', type: 'error', nonce: NONCE, message: 'ResizeObserver loop completed with undelivered notifications.' }, reply)
    bridge.handle({ source: 'yuvi-game', type: 'error', nonce: NONCE, message: 'player is not defined', line: 42 }, reply)
    assert.deepEqual(errors, ['player is not defined'])
    assert.equal(isNoiseError('Script error'), true)
    assert.equal(isNoiseError('TypeError: x is null'), false)
  })
})

describe('learn.answer round trip', () => {
  const GAME = 'g-77'

  it('grades through /api/games/{id}/check and answers the game', async () => {
    stubFetch({ status: 200, body: { correct: false, correct_answer: '12', feedback: null } })
    const replies: HostReply[] = []
    const bridge = createHostBridge({
      nonce: NONCE,
      check: (questionId, answer) => checkAnswer(GAME, questionId, answer),
    })
    const handled = bridge.handle({
      source: 'yuvi-game', type: 'learn.answer', nonce: NONCE,
      requestId: 'a1', questionId: 'q2', answer: '7',
    }, (message) => replies.push(message))
    assert.equal(handled, true)
    await tick()

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `/api/games/${GAME}/check`)
    assert.deepEqual(calls[0].body, { question_id: 'q2', answer: '7' })
    assert.deepEqual(replies, [{
      source: 'yuvi-host', type: 'learn.answer.result', requestId: 'a1',
      correct: false, correctAnswer: '12', feedback: undefined,
    }])
  })

  it('never leaves the game hanging when the network fails', async () => {
    stubFetch({ status: 500, throws: true })
    const replies: HostReply[] = []
    const bridge = createHostBridge({
      nonce: NONCE,
      check: (questionId, answer) => checkAnswer(GAME, questionId, answer),
    })
    bridge.handle({
      source: 'yuvi-game', type: 'learn.answer', nonce: NONCE,
      requestId: 'a2', questionId: 'q1', answer: 3,
    }, (message) => replies.push(message))
    await tick()

    assert.deepEqual(replies, [{
      source: 'yuvi-host', type: 'learn.answer.result', requestId: 'a2',
      correct: false, feedback: 'error',
    }])
  })

  it('does not grade an answer from a frame with another nonce', async () => {
    stubFetch({ status: 200, body: { correct: true, correct_answer: null, feedback: null } })
    const bridge = createHostBridge({
      nonce: NONCE,
      check: (questionId, answer) => checkAnswer(GAME, questionId, answer),
    })
    bridge.handle({
      source: 'yuvi-game', type: 'learn.answer', nonce: 'stale',
      requestId: 'a3', questionId: 'q1', answer: 'x',
    }, () => assert.fail('no reply to a stranger'))
    await tick()
    assert.equal(calls.length, 0)
  })
})
