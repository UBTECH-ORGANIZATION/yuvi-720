/* Coming back to a component you left mid-way asks "continue or start over";
 * coming back to a finished one asks "view or redo". Both fresh-start choices
 * take the same restart path — the one that asks Kata to forget saved progress.
 *
 *   node --test frontend/tests/
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const page = readFileSync(path.join(here, '../src/features/learning-lesson/LessonPage.tsx'), 'utf8')
const dto = readFileSync(path.join(here, '../src/services/learning.ts'), 'utf8')
const he = JSON.parse(readFileSync(path.join(here, '../../locales/he.json'), 'utf8'))

describe('lesson re-entry', () => {
  it('the roadmap node carries in_progress from the server', () => {
    assert.match(dto, /in_progress: boolean/)
  })

  it('a started, unfinished component opens the resume choice; a settled one (passed OR failed) the redo choice', () => {
    assert.match(page, /persisted\?\.outcome \? 'completed'/)
    assert.match(page, /persisted\?\.in_progress \? 'in-progress'/)
    assert.doesNotMatch(page, /progress_state === 'completed'/)
    assert.match(page, /reentryMode === 'in-progress'/)
    assert.match(page, /reentryMode === 'completed'/)
  })

  it('"start over" and "redo" both launch a fresh attempt through restart', () => {
    assert.match(page, /onClick=\{redoCompletedComponent\}>\s*\{t\('learning\.lesson\.resume\.restart'\)\}/)
    assert.match(page, /onClick=\{redoCompletedComponent\}>\s*\{t\('learning\.lesson\.reentry\.redo'\)\}/)
    assert.match(page, /restartPendingRef\.current = true/)
  })

  it('a redo never re-opens the choice on its own launch', () => {
    assert.match(page, /isRedo \? null/)
  })

  it('the copy tells the learner that starting over clears their answers', () => {
    for (const key of ['title', 'body', 'continue', 'restart']) assert.ok(he[`learning.lesson.resume.${key}`], key)
    assert.match(he['learning.lesson.resume.body'], /יימחקו/)
  })

  it('a failed visit still finalizes the lesson: the dialog keys on a visit settled since launch, not on `completed`', () => {
    assert.match(page, /freshOutcome\(nextRoadmap\.components, session\.component\.id, outcomesAtLaunchRef\.current\)/)
    assert.match(page, /freshOutcome\(unit\.components, session\.component\.id, outcomesAtLaunchRef\.current\)/)
    assert.match(page, /setCompletionOutcome\(settled\.outcome\)/)
  })

  it('a failed visit gets its own copy in both dialogs, in every locale', () => {
    for (const lang of ['he', 'en', 'ar']) {
      const strings = JSON.parse(readFileSync(path.join(here, `../../locales/${lang}.json`), 'utf8'))
      for (const key of ['completed.failed', 'completed.failed.body', 'reentry.failedTitle', 'reentry.failedBody']) {
        assert.ok(strings[`learning.lesson.${key}`], `${lang} ${key}`)
      }
    }
    assert.match(page, /completionOutcome === 'failed' \? 'learning\.lesson\.completed\.failed'/)
    assert.match(page, /reentryOutcome === 'failed' \? 'learning\.lesson\.reentry\.failedTitle'/)
  })

  it('a failed completion offers another attempt first, through the same restart path', () => {
    assert.match(page, /completionOutcome === 'failed' \? \(/)
    assert.match(page, /onClick=\{restartAfterFailure\}/)
    assert.match(page, /const restartAfterFailure = \(\) => \{[\s\S]*?redoCompletedComponent\(\)/)
  })

  it('a failed completion is not celebrated: no cheer, no green, its own eyebrow', () => {
    assert.match(page, /const failed = completionOutcome === 'failed'/)
    assert.match(page, /reducedMotion \|\| failed \? \(\) => undefined : playCelebrationCheer/)
    assert.match(page, /completionOutcome === 'failed' \? ' is-failed' : ''/)
    assert.match(page, /'learning\.lesson\.completionDialog\.eyebrowFailed'/)
    for (const lang of ['he', 'en', 'ar']) {
      const strings = JSON.parse(readFileSync(path.join(here, `../../locales/${lang}.json`), 'utf8'))
      assert.ok(strings['learning.lesson.completionDialog.eyebrowFailed'], lang)
    }
  })
})

