import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { formatTestTime, remainingTestSeconds } from '../src/features/tasks/taskTime.ts'

const startedAt = '2026-09-23T12:00:00+00:00'
const start = Date.parse(startedAt)

test('assessment time follows the saved start, including reloads and background gaps', () => {
  assert.equal(remainingTestSeconds(startedAt, 20, start), 1200)
  assert.equal(remainingTestSeconds(startedAt, 20, start + 1000), 1199)
  assert.equal(remainingTestSeconds(startedAt, 20, start + 65_000), 1135)
  assert.equal(remainingTestSeconds(startedAt, 20, start + 900_000), 300)
})

test('assessment clock clamps at zero and never adds time for a future timestamp', () => {
  assert.equal(remainingTestSeconds(startedAt, 20, start + 1_199_001), 1)
  assert.equal(remainingTestSeconds(startedAt, 20, start + 1_200_000), 0)
  assert.equal(remainingTestSeconds(startedAt, 20, start + 2_000_000), 0)
  assert.equal(remainingTestSeconds(startedAt, 20, start - 60_000), 1200)
})

test('missing or invalid timing never fabricates a countdown', () => {
  for (const value of [null, undefined, '', 'invalid']) {
    assert.equal(remainingTestSeconds(value, 20, start), null)
  }
  for (const minutes of [0, -1, NaN, Infinity]) {
    assert.equal(remainingTestSeconds(startedAt, minutes, start), null)
  }
})

test('minutes and seconds stay padded across minute boundaries', () => {
  for (const [seconds, expected] of [[1200, '20:00'], [1199, '19:59'], [60, '01:00'], [9, '00:09'], [0, '00:00']] as const) {
    assert.equal(formatTestTime(seconds), expected)
  }
})

test('all timer states are localized in the supported languages', () => {
  for (const language of ['he', 'ar', 'en']) {
    const locale = JSON.parse(readFileSync(new URL(`../../locales/${language}.json`, import.meta.url), 'utf8'))
    for (const key of ['remaining', 'timerStarting', 'timerFailed', 'timerRetry', 'expired']) {
      assert.ok(locale[`tasks.test.${key}`], `${language}: ${key}`)
    }
  }
})