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

  it('a started, unfinished component opens the resume choice; a finished one the redo choice', () => {
    assert.match(page, /persisted\?\.progress_state === 'completed' \? 'completed'/)
    assert.match(page, /persisted\?\.in_progress \? 'in-progress'/)
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
})
