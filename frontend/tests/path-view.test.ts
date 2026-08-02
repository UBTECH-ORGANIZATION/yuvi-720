/* What each kind of learner is shown — the client half of the path contract.
 *
 *   node --test frontend/tests/          (Node 25 strips the types natively)
 *
 * These run against `features/learning/pathView.ts`, the exact module the
 * dashboard card, the lesson page, the roadmap and the 3D track all read, so a
 * regression here is a regression on screen. The server-side counterpart is
 * `backend/tests/test_learning_path.py` — same personas, same expectations.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  currentNode,
  horizon,
  lessonCardView,
  monotoneRatio,
  onPathNodes,
  optionalExtra,
  previousStation,
  stationGlyph,
  whatNowKey,
} from '../src/features/learning/pathView.ts'
import type { LearningComponentDTO, LearningUnitDTO } from '../src/services/learning.ts'

type NodeSpec = {
  id: string
  visit?: number
  onPath?: boolean
  index?: number | null
  state?: LearningComponentDTO['progress_state']
  outcome?: LearningComponentDTO['outcome']
  reason?: string
  minutes?: number | null
}

function node(spec: NodeSpec): LearningComponentDTO {
  const visit = spec.visit ?? 1
  return {
    id: spec.id,
    unit_id: 'u1',
    title: `station ${spec.id}`,
    purpose: 'practice',
    is_assessment: false,
    is_required: true,
    relative_difficulty: 3,
    order: null,
    languages: ['he'],
    estimated_minutes: spec.minutes === undefined ? 5 : spec.minutes,
    recommended_after_fail: [],
    information_to_bot: null,
    question_ids: [],
    path_node_id: `${spec.id}#${visit}`,
    component_id: spec.id,
    visit,
    on_path: spec.onPath ?? true,
    path_index: spec.index === undefined ? null : spec.index,
    stage_index: null,
    outcome: spec.outcome ?? null,
    progress_state: spec.state ?? 'locked',
    progress_reason: { code: (spec.reason ?? 'provider_order') as never },
    progress_evidence: { kind: 'provider_order' },
  } as LearningComponentDTO
}

function unit(components: LearningComponentDTO[], extra: Partial<LearningUnitDTO> = {}): LearningUnitDTO {
  const onPath = components.filter((component) => component.on_path)
  const settled = onPath.filter((component) => component.outcome !== null)
  const next = onPath.find((component) => component.outcome === null)
  return {
    id: 'u1',
    title: 'unit',
    sub_topic: 'MOE.SCI.SUB',
    objective_id: 'MOE.SCI.OBJ',
    subject: 'science',
    languages: ['he'],
    components,
    source: 'kata',
    current_component_id: next?.component_id ?? null,
    next_component_id: next?.component_id ?? null,
    next_path_node_id: next?.path_node_id ?? null,
    steps_completed: settled.length,
    steps_total: onPath.length,
    progress_ratio: onPath.length ? settled.length / onPath.length : 0,
    unit_state: next ? (settled.length ? 'in_progress' : 'not_started') : 'completed',
    tail_certain: false,
    path_strategy: 'adaptive',
    ...extra,
  } as LearningUnitDTO
}

// ── The three personas, exactly as the server plans them ────────────────────
const STRUGGLING = unit([
  node({ id: 'c1', index: 0, state: 'completed', outcome: 'passed', reason: 'xapi_completed' }),
  node({ id: 'c2', index: 1, state: 'available', outcome: 'failed', reason: 'xapi_failed' }),
  node({ id: 'c1', visit: 2, index: 2, state: 'current', reason: 'recovery_after_fail' }),
  node({ id: 'c3', index: 3 }),
  node({ id: 'c4', index: 4 }),
  node({ id: 'c5', index: 5, reason: 'assessment_gated' }),
])

const MIDDLE = unit([
  node({ id: 'c1', index: 0, state: 'completed', outcome: 'passed', reason: 'xapi_completed' }),
  node({ id: 'c2', index: 1, state: 'current', reason: 'optional_kept' }),
  node({ id: 'c3', index: 2 }),
  node({ id: 'c4', index: 3 }),
  node({ id: 'c5', index: 4 }),
])

const EXCELLENT = unit([
  node({ id: 'c1', index: 0, state: 'completed', outcome: 'passed', reason: 'xapi_completed' }),
  node({ id: 'c2', onPath: false, index: null, state: 'skipped', reason: 'optional_skipped' }),
  node({ id: 'c3', index: 1, state: 'current' }),
  node({ id: 'c4', index: 2 }),
  node({ id: 'c5', index: 3 }),
])

describe('the route each learner is shown', () => {
  it('is a different length for each of the three personas', () => {
    assert.deepEqual(
      [STRUGGLING, MIDDLE, EXCELLENT].map((u) => onPathNodes(u).length),
      [6, 5, 4],
    )
  })

  it('keeps the repair round on the route, as a second visit to the same station', () => {
    const route = onPathNodes(STRUGGLING)
    assert.equal(route[2].component_id, 'c1')
    assert.equal(route[2].visit, 2)
    assert.equal(route[2].path_node_id, 'c1#2')
    assert.equal(route[2].progress_reason.code, 'recovery_after_fail')
  })

  it('never puts a skipped optional on the route, and never loses it either', () => {
    assert.ok(!onPathNodes(EXCELLENT).some((n) => n.component_id === 'c2'))
    assert.equal(optionalExtra(EXCELLENT)?.component_id, 'c2')
  })

  it('offers no extra to a learner whose route kept everything', () => {
    assert.equal(optionalExtra(MIDDLE), null)
    assert.equal(optionalExtra(STRUGGLING), null)
  })

  it('walks in path order, not array order', () => {
    const shuffled = unit([
      node({ id: 'c3', index: 2 }),
      node({ id: 'c1', index: 0, state: 'completed', outcome: 'passed' }),
      node({ id: 'c2', index: 1, state: 'current' }),
    ])
    assert.deepEqual(onPathNodes(shuffled).map((n) => n.component_id), ['c1', 'c2', 'c3'])
  })
})

describe('the horizon — how much of the route may be drawn', () => {
  it('shows what is settled, where they are, and exactly one ahead', () => {
    const { nodes, hasHorizon } = horizon(MIDDLE)
    assert.deepEqual(nodes.map((n) => n.component_id), ['c1', 'c2', 'c3'])
    assert.equal(hasHorizon, true)
  })

  it('fogs the tail for the struggling learner too, at their own position', () => {
    const { nodes } = horizon(STRUGGLING)
    assert.deepEqual(nodes.map((n) => n.path_node_id), ['c1#1', 'c2#1', 'c1#2', 'c3#1'])
  })

  it('draws the whole route when the server says the tail is decided', () => {
    const certain = unit(MIDDLE.components, { tail_certain: true })
    const { nodes, hasHorizon } = horizon(certain)
    assert.equal(nodes.length, 5)
    assert.equal(hasHorizon, false, 'a deterministic unit must not be fogged for no reason')
  })

  it('has nothing left to fog once the unit is finished', () => {
    const done = unit([
      node({ id: 'c1', index: 0, state: 'completed', outcome: 'passed' }),
      node({ id: 'c2', index: 1, state: 'completed', outcome: 'passed' }),
    ])
    const { nodes, hasHorizon } = horizon(done)
    assert.equal(nodes.length, 2)
    assert.equal(hasHorizon, false)
  })

  it('never renumbers what is already drawn when the path grows behind the fog', () => {
    const before = horizon(MIDDLE).nodes.map((n) => n.path_node_id)
    const grown = unit([...MIDDLE.components, node({ id: 'c6', index: 5 })])
    const after = horizon(grown).nodes.map((n) => n.path_node_id)
    assert.deepEqual(after.slice(0, before.length), before)
  })
})

describe('the progress trail', () => {
  it('reports a ratio, never a step count', () => {
    assert.equal(lessonCardView(STRUGGLING).progress, 2 / 6)
    assert.equal(lessonCardView(EXCELLENT).progress, 1 / 4)
  })

  it('cannot retract when a repair round grows the path under the learner', () => {
    // 3/5 = 0.6, then the plan grows to 3/6 = 0.5. The honest ratio drops; the
    // bar must not, or the learner watches their own work disappear.
    assert.equal(monotoneRatio(0.6, 0.5), 0.6)
  })

  it('moves forward when real progress lands', () => {
    assert.equal(monotoneRatio(0.6, 0.8), 0.8)
  })

  it('jumps to full when an early assessment pass ends the unit', () => {
    assert.equal(monotoneRatio(0.4, 1), 1)
  })

  it('stays inside 0…1 whatever it is handed', () => {
    assert.equal(monotoneRatio(0, -3), 0)
    assert.equal(monotoneRatio(0, 4), 1)
    assert.equal(monotoneRatio(Number.NaN as number, 0.5), 0.5)
  })
})

describe('the dashboard card', () => {
  it('calls a learner mid-station active, and points at that station', () => {
    const view = lessonCardView(MIDDLE)
    assert.equal(view.status, 'active')
    assert.equal(view.target?.component_id, 'c2')
  })

  it('counts only the minutes still ahead on THEIR route', () => {
    // Excellent has c3+c4+c5 left at 5 minutes each; the skipped c2 is not time
    // they owe, because they will never be routed through it.
    assert.equal(lessonCardView(EXCELLENT).minutesLeft, 15)
  })

  it('is "completed" only when the server says the unit is', () => {
    const finished = unit([
      node({ id: 'c1', index: 0, state: 'completed', outcome: 'passed' }),
      node({ id: 'c2', onPath: false, index: null, state: 'skipped', reason: 'unit_completed_by_assessment' }),
    ])
    assert.equal(finished.unit_state, 'completed')
    assert.equal(lessonCardView(finished).status, 'completed')
  })

  it('is "notStarted" for a learner with no evidence yet', () => {
    const fresh = unit([node({ id: 'c1', index: 0, state: 'current' }), node({ id: 'c2', index: 1 })])
    assert.equal(lessonCardView(fresh).status, 'active')
    const untouched = unit([node({ id: 'c1', index: 0 }), node({ id: 'c2', index: 1 })])
    assert.equal(lessonCardView(untouched).status, 'notStarted')
  })

  it('survives a unit with no minutes declared', () => {
    const noMinutes = unit([node({ id: 'c1', index: 0, minutes: null, state: 'current' })])
    assert.equal(lessonCardView(noMinutes).minutesLeft, null)
  })
})

describe('going back (720 F1 "אפשרות לחזור לתכנים קודמים")', () => {
  it('offers the repair round once it is behind them, not the original visit', () => {
    // The learner walked c1, failed c2, redid c1 as a repair round, and is now
    // on c3. "Previous" has to mean c1#2 — the visit they actually just did —
    // and an `id`-based lookup would hand back c1#1 instead.
    const afterRepair = unit([
      node({ id: 'c1', index: 0, state: 'completed', outcome: 'passed' }),
      node({ id: 'c2', index: 1, state: 'available', outcome: 'failed', reason: 'xapi_failed' }),
      node({ id: 'c1', visit: 2, index: 2, state: 'completed', outcome: 'passed', reason: 'recovery_after_fail' }),
      node({ id: 'c3', index: 3, state: 'current' }),
    ])
    assert.equal(previousStation(afterRepair, 'c3')?.path_node_id, 'c1#2')
  })

  it('will hand back a failed station — §6 lets them redo it', () => {
    // The repair round is still open, so the last SETTLED thing behind them is
    // the component they failed. Refusing it would leave them with no way back.
    assert.equal(previousStation(STRUGGLING, 'c3')?.path_node_id, 'c2#1')
  })

  it('never offers a skipped extra as "previous"', () => {
    assert.equal(previousStation(EXCELLENT, 'c3')?.component_id, 'c1')
  })

  it('offers nothing at the first station', () => {
    assert.equal(previousStation(MIDDLE, 'c1'), null)
  })

  it('offers nothing when everything behind is unsettled', () => {
    const early = unit([
      node({ id: 'c1', index: 0, state: 'current' }),
      node({ id: 'c2', index: 1 }),
    ])
    assert.equal(previousStation(early, 'c2'), null)
  })
})

describe('what the learner is told happens next', () => {
  it('names the repair round for the struggling learner', () => {
    assert.equal(whatNowKey(currentNode(STRUGGLING)), 'learning.path.next.recovery_after_fail')
  })

  it('names the kept practice for the middle learner', () => {
    assert.equal(whatNowKey(currentNode(MIDDLE)), 'learning.path.next.optional_kept')
  })

  it('says the unit is finished when there is no next station', () => {
    const done = unit([node({ id: 'c1', index: 0, state: 'completed', outcome: 'passed' })])
    assert.equal(whatNowKey(currentNode(done)), 'learning.path.next.unit_completed_by_assessment')
  })

  it('falls back to a neutral sentence rather than an empty one', () => {
    assert.equal(whatNowKey(node({ id: 'x', reason: '' })), 'learning.path.next.provider_order')
  })

  it('never keys off a mastery level', () => {
    for (const learner of [STRUGGLING, MIDDLE, EXCELLENT]) {
      const key = whatNowKey(currentNode(learner))
      for (const word of ['basic', 'intermediate', 'advanced']) {
        assert.ok(!key.includes(word), `${word} leaked into a learner-facing key`)
      }
    }
  })
})

describe('station glyphs (no ordinals — position stopped meaning "step")', () => {
  it('marks settled, failed, current and upcoming distinctly', () => {
    const route = onPathNodes(STRUGGLING)
    assert.equal(stationGlyph(route[0]), '✓')
    assert.equal(stationGlyph(route[1]), '↻')
    assert.equal(stationGlyph(route[2]), '★')
    assert.equal(stationGlyph(route[3]), '·')
  })
})

describe('the learner payload never carries a mastery level (720 §2)', () => {
  it('holds for all three personas, serialized', () => {
    for (const learner of [STRUGGLING, MIDDLE, EXCELLENT]) {
      const payload = JSON.stringify(learner)
      for (const word of ['basic', 'intermediate', 'advanced', 'mastery_level']) {
        assert.ok(!payload.includes(word), `${word} reached the client`)
      }
    }
  })
})
