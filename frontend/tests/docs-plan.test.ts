/* The instructor guide's change detector.
 *
 * The value of the docs pipeline is entirely in this decision: a push that
 * touches one wizard must re-shoot one chapter, not thirty. These assert the
 * routing rules — and, just as importantly, that every chapter in the map is
 * actually reachable by some file path, so a chapter can never go stale
 * silently because nobody watches the code that draws it.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// @ts-expect-error — plain ESM sibling scripts have no type declarations.
import { planFrom, globToRegExp } from '../scripts/docs/plan.mjs'
// @ts-expect-error — see above.
import { loadMap } from '../scripts/docs/map.mjs'

const map = loadMap()

describe('globToRegExp', () => {
  it('matches everything under a ** directory, including the directory itself', () => {
    const re = globToRegExp('frontend/src/features/mentoring/**')
    assert.equal(re.test('frontend/src/features/mentoring/MentoringPage.tsx'), true)
    assert.equal(re.test('frontend/src/features/mentoring/parts/Trail.tsx'), true)
    assert.equal(re.test('frontend/src/features/mentoring-old/Page.tsx'), false)
  })

  it('matches an exact file path', () => {
    const re = globToRegExp('backend/app/routes/auth.py')
    assert.equal(re.test('backend/app/routes/auth.py'), true)
    assert.equal(re.test('backend/app/routes/auth_extra.py'), false)
  })
})

describe('planFrom', () => {
  it('captures only the chapter that owns the changed feature', () => {
    const plan = planFrom(map, ['frontend/src/features/teacher-app/goals/steps/GoalsStep.tsx'])
    assert.deepEqual(plan.capture, ['teacher-goals'])
  })

  it('captures every chapter when shared chrome changes', () => {
    const plan = planFrom(map, ['locales/he.json'])
    assert.equal(plan.capture.length, map.chapters.length)
  })

  it('rebuilds the PDF without re-shooting when only prose changes', () => {
    const plan = planFrom(map, ['docs/guide/chapters/05-student-tasks.he.md'])
    assert.deepEqual(plan.capture, [])
    assert.equal(plan.rebuildPdf, true)
  })

  it('does nothing for an unrelated change', () => {
    const plan = planFrom(map, ['admin/backend/leads.py', 'README.md'])
    assert.deepEqual(plan.capture, [])
    assert.equal(plan.rebuildPdf, false)
  })

  it('reports a feature folder no chapter watches', () => {
    const plan = planFrom(map, ['frontend/src/features/brand-new-thing/Page.tsx'])
    assert.deepEqual(plan.capture, [])
    assert.deepEqual(plan.unmapped, ['frontend/src/features/brand-new-thing/Page.tsx'])
  })

  it('keeps chapters in map order, not in the order the files arrived', () => {
    const plan = planFrom(map, [
      'frontend/src/features/teacher-app/tasks/TeacherTasksPage.tsx',
      'frontend/src/features/learner-mapping/LearnerMappingPage.tsx'
    ])
    assert.deepEqual(plan.capture, ['learner-mapping', 'teacher-tasks'])
  })
})

describe('docs-map.json', () => {
  it('gives every chapter a watch path, a scenario and a markdown file', () => {
    for (const chapter of map.chapters) {
      assert.ok(chapter.watchPaths?.length > 0, `${chapter.id} watches nothing`)
      assert.ok(chapter.scenario, `${chapter.id} has no scenario`)
      assert.ok(chapter.markdown, `${chapter.id} has no markdown`)
    }
  })

  it('names an account that exists', () => {
    for (const chapter of map.chapters) {
      if (!chapter.account) continue
      assert.ok(map.accounts[chapter.account], `${chapter.id} → unknown account ${chapter.account}`)
    }
  })
})
