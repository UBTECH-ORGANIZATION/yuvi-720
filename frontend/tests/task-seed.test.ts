/* Starting a task from a finding, and remembering who it was found about.
 *
 *   node --test frontend/tests/
 *
 * The class-gaps panel names an objective and the children stuck on it. Both
 * halves of that have to survive a navigation the teacher does not think of as
 * one — the builder is on another screen, and the send dialog is on a third,
 * minutes later, after generation. This is that handoff, and the two rules it
 * has to keep: a seed is spent once, and a suggestion is only ever a
 * suggestion.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

class MemoryStorage {
  private map = new Map<string, string>()
  public throwOnWrite = false

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }

  setItem(key: string, value: string): void {
    if (this.throwOnWrite) throw new DOMException('QuotaExceededError')
    this.map.set(key, value)
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  get size(): number {
    return this.map.size
  }

  keys(): string[] {
    return [...this.map.keys()]
  }
}

const storage = new MemoryStorage()
;(globalThis as { window?: unknown }).window = { sessionStorage: storage }

const { clearAudience, putAudience, putSeed, readAudience, takeSeed } =
  await import('../src/features/teacher-app/tasks/taskSeed.ts')

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const SEED = {
  title: 'תרגול: מסה ונפח של גופים',
  topic: 'מסה ונפח של גופים',
  objectiveId: 'SCI.G7.MATTER-02',
  learnerIds: ['moti', 'dvir'],
}

describe('the seed carries the finding to the builder', () => {
  beforeEach(() => {
    for (const key of storage.keys()) storage.removeItem(key)
    storage.throwOnWrite = false
  })

  it('comes back exactly as it went in', () => {
    putSeed(SEED)
    assert.deepEqual(takeSeed(), SEED)
  })

  it('is spent by being read', () => {
    // Otherwise the next visit to the tasks list opens the builder again, on a
    // gap the teacher has already acted on.
    putSeed(SEED)
    takeSeed()
    assert.equal(takeSeed(), null)
    assert.equal(storage.size, 0)
  })

  it('refuses a seed that says nothing about the task', () => {
    putSeed({ title: '  ', topic: '', learnerIds: ['moti'] })
    assert.equal(takeSeed(), null)
  })

  it('keeps the children even when the objective is unknown', () => {
    putSeed({ title: 'שברים', topic: 'מכנה משותף', learnerIds: ['moti'] })
    assert.deepEqual(takeSeed(), {
      title: 'שברים', topic: 'מכנה משותף', objectiveId: null, learnerIds: ['moti'],
    })
  })

  it('drops anything in the learner list that is not an id', () => {
    storage.setItem('yuvi.teacher.taskSeed',
                    JSON.stringify({ title: 'x', topic: 'y', learnerIds: ['moti', 7, null] }))
    assert.deepEqual(takeSeed()?.learnerIds, ['moti'])
  })

  it('survives junk, and a storage that refuses to write', () => {
    storage.setItem('yuvi.teacher.taskSeed', 'not json at all')
    assert.equal(takeSeed(), null)
    storage.throwOnWrite = true
    assert.doesNotThrow(() => putSeed(SEED))
    assert.equal(takeSeed(), null)
  })
})

describe('the audience is a suggestion, held until the task is sent', () => {
  beforeEach(() => {
    for (const key of storage.keys()) storage.removeItem(key)
    storage.throwOnWrite = false
  })

  it('is keyed by task, because generation happens in between', () => {
    putAudience('tsk-1', ['moti'])
    putAudience('tsk-2', ['dvir'])
    assert.deepEqual(readAudience('tsk-1'), ['moti'])
    assert.deepEqual(readAudience('tsk-2'), ['dvir'])
    assert.deepEqual(readAudience('tsk-3'), [])
  })

  it('survives being read, so the send dialog can be opened twice', () => {
    putAudience('tsk-1', ['moti', 'dvir'])
    readAudience('tsk-1')
    assert.deepEqual(readAudience('tsk-1'), ['moti', 'dvir'])
  })

  it('is gone once the task has been sent', () => {
    // A second opening is its own decision. Pre-ticking the first opening's
    // children would present it as one already taken.
    putAudience('tsk-1', ['moti'])
    clearAudience('tsk-1')
    assert.deepEqual(readAudience('tsk-1'), [])
  })

  it('stores nothing for an empty audience', () => {
    putAudience('tsk-1', [])
    assert.equal(storage.size, 0)
  })
})

describe('a gap is answered with material, not with a goal', () => {
  const home = read('../src/features/teacher-app/home/TeacherHomePage.tsx')
  const builder = read('../src/features/teacher-app/tasks/TeacherTasksPage.tsx')
  const launch = read('../src/features/teacher-app/tasks/LaunchDialog.tsx')
  const locales = {
    he: JSON.parse(read('../../locales/he.json')) as Record<string, string>,
    en: JSON.parse(read('../../locales/en.json')) as Record<string, string>,
    ar: JSON.parse(read('../../locales/ar.json')) as Record<string, string>,
  }

  it('sends the objective AND the children from the gaps panel', () => {
    const call = home.split('putSeed({')[1].split('navigate(')[0]
    assert.match(call, /objectiveId: gap\.objective_id/)
    assert.match(call, /learnerIds: gap\.learner_ids/)
    assert.match(home, /navigate\('\/teacher\/tasks'\)/)
  })

  it('no longer opens the goal dialog there', () => {
    // The goal dialog is still the hero's — this is only about the gaps list.
    assert.equal(/SubGroupAssign/.test(home), false)
  })

  it('opens the builder on arrival, and prefills the lesson from the objective', () => {
    assert.match(builder, /const arrived = takeSeed\(\)/)
    assert.match(builder, /row\.objective_id === seed\.objectiveId/)
  })

  it('restores no draft over a seeded form', () => {
    // The teacher has just said what this task is about; last week's
    // half-written one would overwrite the answer.
    const restore = builder.split('const draft = loadDraft')[0].split('useEffect(() => {').pop() ?? ''
    assert.match(restore, /if \(seed\) return/)
  })

  it('writes no draft over the one the teacher hand-wrote', () => {
    // There is one draft per teacher per class. A task started from a gap must
    // not overwrite the one they were writing themselves on Tuesday — a seeded
    // form can be recreated with the same button; those words cannot.
    assert.match(builder, /if \(!seed\) saveDraft\(teacherId, groupId, draft\)/)
    assert.match(builder, /if \(!seed\) clearDraft\(teacherId, groupId\)/)
  })

  it('hands the children to the send dialog, and to nothing else', () => {
    // Nothing is assigned by building. The suggestion is stored beside the new
    // task id and spent by the launch dialog, which the teacher drives.
    assert.match(builder, /putAudience\(created\.task\._id, seed\.learnerIds\)/)
    assert.equal(/assignGroupGoal/.test(builder), false)
  })

  it('ticks only children still in this class', () => {
    const effect = launch.split('const inClass = suggested.filter')[1].split('}, [')[0]
    assert.match(effect, /members\.includes\(id\)/)
    assert.match(effect, /setPrefilled\(true\)/)
  })

  it('says who ticked them', () => {
    // A picker that opens pre-ticked has to explain who ticked it.
    assert.match(launch, /tch\.tasks\.launchSuggested/)
    for (const [language, table] of Object.entries(locales)) {
      assert.ok(table['tch.tasks.launchSuggested'], `${language} cannot explain the ticks`)
      assert.ok(table['tch.gaps.taskTitle'].includes('{label}'), `${language}: no objective`)
    }
  })
})
