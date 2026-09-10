/* The Game Lab panel's pure half.
 *
 *   node --test frontend/tests/
 *
 * The panel is a list that keeps updating while the child is not looking at
 * it — a poll here, a realtime frame there, a game created on the other tab.
 * These pin the merge rules: nothing reorders on its own, a frame never
 * clobbers a fresher snapshot, and the wizard's deep link is read strictly.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  applyFrame, createErrorKey, mergeUpdates, orderComponents, orderObjectives, readPreselect, upsertGame,
} from '../src/features/Yuvi-studio/panel/gameLabModel.ts'
import type { GameFrame, LearnerGame, PickerObjective } from '../src/services/games.ts'

const objective = (id: string, visited: boolean): PickerObjective => ({
  id, title: id, topic_title: '', visited, components: [],
})

const game = (id: string, status: LearnerGame['status'], extra: Partial<LearnerGame> = {}): LearnerGame => ({
  game_id: id, learner_id: 'l', objective_id: 'o', unit_id: 'u', component_id: 'c',
  objective_title: '', component_title: '', title: id, genre: 'puzzle', prompt: '', language: 'he', device: 'keyboard',
  status, current_version: status === 'ready' ? 1 : 0, versions: [], has_thumb: false, errors_last: [],
  sparks_spent: 0, created_at: null, updated_at: 't1', last_job: null, ...extra,
})

describe('the objective picker', () => {
  it('leads with visited objectives and keeps the catalog order inside each half', () => {
    const rows = [objective('a', false), objective('b', true), objective('c', false), objective('d', true)]
    assert.deepEqual(orderObjectives(rows).map((row) => row.id), ['b', 'd', 'a', 'c'])
  })

  it('applies the same rule to components', () => {
    const rows = [
      { id: 'x', visited: false }, { id: 'y', visited: true },
    ].map((row) => ({ ...row, unit_id: 'u', unit_title: '', title: row.id, purpose: null, difficulty: null, is_assessment: false }))
    assert.deepEqual(orderComponents(rows).map((row) => row.id), ['y', 'x'])
  })
})

describe('the deep link', () => {
  it('only preselects when the station is the game lab', () => {
    assert.deepEqual(readPreselect('?station=gamelab&objective=o1&component=c1'), { open: true, objective: 'o1', component: 'c1' })
    assert.deepEqual(readPreselect('?station=room&objective=o1'), { open: false, objective: null, component: null })
    assert.deepEqual(readPreselect(''), { open: false, objective: null, component: null })
  })
})

describe('the games list', () => {
  it('puts a new game on top and replaces a known one in place', () => {
    const list = [game('b', 'ready'), game('a', 'ready')]
    assert.deepEqual(upsertGame(list, game('c', 'queued')).map((row) => row.game_id), ['c', 'b', 'a'])
    const replaced = upsertGame(list, game('a', 'building'))
    assert.deepEqual(replaced.map((row) => row.game_id), ['b', 'a'])
    assert.equal(replaced[1].status, 'building')
  })

  it('lets a frame move status and version forward, never back', () => {
    const row = game('a', 'building', { current_version: 2 })
    const forward: GameFrame = { type: 'game', game_id: 'a', status: 'ready', v: 3 }
    assert.deepEqual(applyFrame(row, forward), { ...row, status: 'ready', current_version: 3 })
    const stale: GameFrame = { type: 'game', game_id: 'a', status: '', v: 1 }
    assert.equal(applyFrame(row, stale), row)
    const other: GameFrame = { type: 'game', game_id: 'zzz', status: 'failed', v: 1 }
    assert.equal(applyFrame(row, other), row)
  })

  it('applies only what arrived after the row was fetched', () => {
    const list = [game('a', 'ready'), game('b', 'ready')]
    const freshAt = { a: 100, b: 100 }
    // A frame from before the fetch is history; one from after is news.
    const stale = { a: { value: { type: 'game', game_id: 'a', status: 'building', v: 0 } as GameFrame, at: 50 } }
    assert.equal(mergeUpdates(list, {}, stale, freshAt).list, list)
    const fresh = { a: { value: { type: 'game', game_id: 'a', status: 'queued', v: 1 } as GameFrame, at: 150 } }
    const merged = mergeUpdates(list, {}, fresh, freshAt)
    assert.equal(merged.list[0].status, 'queued')
    assert.equal(merged.list[1], list[1])
    assert.equal(merged.freshAt, freshAt)
  })

  it('lets a fresher snapshot replace the row and become its fetch time', () => {
    const list = [game('a', 'building')]
    const snapshots = { a: { value: game('a', 'ready', { sparks_spent: 9 }), at: 200 } }
    // The frame is older than the snapshot, so it must not undo it.
    const frames = { a: { value: { type: 'game', game_id: 'a', status: 'building', v: 0 } as GameFrame, at: 150 } }
    const merged = mergeUpdates(list, snapshots, frames, { a: 100 })
    assert.equal(merged.list[0].status, 'ready')
    assert.equal(merged.list[0].sparks_spent, 9)
    assert.deepEqual(merged.freshAt, { a: 200 })
    // Nothing newer: same list back, no churn for React.
    assert.equal(mergeUpdates(merged.list, snapshots, frames, merged.freshAt).list, merged.list)
  })

  it('leaves games the list has not loaded alone', () => {
    const list = [game('a', 'ready')]
    assert.equal(mergeUpdates(list, { zzz: { value: game('zzz', 'queued'), at: 900 } }, {}, {}).list, list)
  })
})

describe('create failures', () => {
  it('turns the daily cap into its own friendly line', () => {
    assert.equal(createErrorKey({ status: 429 }), 'studio.gamelab.error.cap')
    assert.equal(createErrorKey({ status: 422 }), 'studio.gamelab.error.blocked')
    assert.equal(createErrorKey(new Error('boom')), 'studio.gamelab.error.create')
  })
})
