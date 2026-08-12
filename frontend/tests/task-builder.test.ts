/* The task builder: the draft that survives a mis-click, and the explanations
 * the form promises.
 *
 *   node --test frontend/tests/
 *
 * The draft is the reason the dialog can stop closing on a backdrop click
 * without that becoming a trap: both exits are safe because neither loses the
 * form. So the two are tested together — a draft that silently fails to store
 * would turn the guard into the only thing standing between a teacher and ten
 * minutes of lost work.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

/* A localStorage that behaves like the real one, including throwing — private
   browsing and a full quota both raise, and the module must survive both. */
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
;(globalThis as { window?: unknown }).window = { localStorage: storage }

const { DRAFT_TTL_MS, clearDraft, isEmptyDraft, loadDraft, saveDraft } =
  await import('../src/features/teacher-app/tasks/builderDraft.ts')

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const locales = {
  he: JSON.parse(read('../../locales/he.json')) as Record<string, string>,
  en: JSON.parse(read('../../locales/en.json')) as Record<string, string>,
  ar: JSON.parse(read('../../locales/ar.json')) as Record<string, string>,
}

const FORM = { title: 'שברים', topic: 'מכנה משותף', notes: '', components: ['practice'] }

describe('the draft round-trips', () => {
  beforeEach(() => {
    for (const key of storage.keys()) storage.removeItem(key)
    storage.throwOnWrite = false
  })

  it('comes back exactly as it went in', () => {
    saveDraft('teacher-1', 'group-1', FORM)
    assert.deepEqual(loadDraft('teacher-1', 'group-1'), FORM)
  })

  it('is scoped to the class', () => {
    // "The task I was writing for ז'2" must not appear while looking at ז'3.
    saveDraft('teacher-1', 'group-1', FORM)
    assert.equal(loadDraft('teacher-1', 'group-2'), null)
  })

  it('is scoped to the teacher', () => {
    // A shared machine in a staff room must not hand one teacher another's work.
    saveDraft('teacher-1', 'group-1', FORM)
    assert.equal(loadDraft('teacher-2', 'group-1'), null)
  })

  it('expires, and clears itself on the way out', () => {
    saveDraft('teacher-1', 'group-1', FORM)
    const key = storage.keys()[0]
    const stored = JSON.parse(storage.getItem(key) as string)

    // The control first: the same rewritten envelope, still inside the window,
    // must load. Without it this test passes whenever a rewrite is rejected
    // for ANY reason — including one this rewrite introduced.
    storage.setItem(key, JSON.stringify({ ...stored, at: Date.now() - 1000 }))
    assert.deepEqual(loadDraft('teacher-1', 'group-1'), FORM)

    storage.setItem(key, JSON.stringify({ ...stored, at: Date.now() - DRAFT_TTL_MS - 1 }))
    assert.equal(loadDraft('teacher-1', 'group-1'), null)
    // Not just hidden: a form restored a fortnight later is worse than none,
    // so the stale row goes rather than sitting there being re-checked.
    assert.equal(storage.size, 0)
  })

  it('survives a storage that refuses to write', () => {
    storage.throwOnWrite = true
    assert.doesNotThrow(() => saveDraft('teacher-1', 'group-1', FORM))
    assert.equal(loadDraft('teacher-1', 'group-1'), null)
  })

  it('survives something else having written to the key', () => {
    saveDraft('teacher-1', 'group-1', FORM)
    storage.setItem(storage.keys()[0], 'not json at all')
    assert.equal(loadDraft('teacher-1', 'group-1'), null)
  })

  it('ignores an envelope with no timestamp rather than treating it as fresh', () => {
    saveDraft('teacher-1', 'group-1', FORM)
    storage.setItem(storage.keys()[0], JSON.stringify({ draft: FORM }))
    assert.equal(loadDraft('teacher-1', 'group-1'), null)
  })

  it('does nothing at all without both ids', () => {
    saveDraft('', 'group-1', FORM)
    saveDraft('teacher-1', '', FORM)
    assert.equal(storage.size, 0)
    assert.equal(loadDraft('', 'group-1'), null)
  })

  it('clears on demand', () => {
    saveDraft('teacher-1', 'group-1', FORM)
    clearDraft('teacher-1', 'group-1')
    assert.equal(loadDraft('teacher-1', 'group-1'), null)
  })
})

describe('an untouched form is not announced as recovered work', () => {
  it('counts a form with no text and no lesson as empty', () => {
    assert.equal(isEmptyDraft({ title: '', topic: '  ', notes: '' }), true)
    assert.equal(isEmptyDraft(null), true)
    assert.equal(isEmptyDraft({}), true)
  })

  it('counts any of the three text fields as work', () => {
    for (const field of ['title', 'topic', 'notes']) {
      assert.equal(isEmptyDraft({ [field]: 'משהו' }), false, field)
    }
  })

  it('counts a picked lesson as work even with every field blank', () => {
    // Choosing the material is a decision, and re-finding it in the picker is
    // the slowest thing on the form.
    assert.equal(isEmptyDraft({ source: { component_id: 'CET.MATH.G7' } }), false)
    assert.equal(isEmptyDraft({ source: null }), true)
  })
})

describe('the dialog explains what it is asking for', () => {
  const page = read('../src/features/teacher-app/tasks/TeacherTasksPage.tsx')

  it('explains all four part types, in all three languages', () => {
    for (const [language, table] of Object.entries(locales)) {
      for (const component of ['presentation', 'practice', 'interactive', 'test']) {
        const key = `tch.tasks.parts.explain.${component}`
        assert.ok(table[key], `${language} is missing ${key}`)
        assert.ok(table[key].length > 20, `${language}.${key} explains nothing`)
      }
    }
  })

  it('says what an activity actually is, since the word alone does not', () => {
    // "פעילות" is the one part type whose name tells a teacher nothing about
    // what their class will be doing.
    assert.match(locales.he['tch.tasks.parts.explain.interactive'], /גרירה/)
    assert.match(locales.en['tch.tasks.parts.explain.interactive'], /matching|drag/i)
  })

  it('names each missing field rather than saying "fill in the form"', () => {
    for (const [language, table] of Object.entries(locales)) {
      for (const field of ['title', 'components', 'subject_matter']) {
        assert.ok(table[`tch.tasks.missing.${field}`], `${language}: ${field}`)
      }
      assert.match(table['tch.tasks.suggestMissing'], /\{fields\}/)
    }
  })

  it('keeps the disabled reason reachable — aria-disabled, not disabled', () => {
    // A `disabled` button takes no pointer events and no focus, so it can
    // never say why it is disabled. That is the whole feature here.
    assert.match(page, /aria-disabled=\{blocked \|\| busy\}/)
    assert.equal(/<button[^>]*\sdisabled=\{blocked/.test(page), false)
  })

  it('closes only through cancel, not through the backdrop', () => {
    assert.match(page, /dismissible=\{false\}/)
  })
})

describe('the modal honours the guard it is given', () => {
  const modal = read('../src/components/primitives/Modal.tsx')

  it('drops the backdrop handler entirely rather than branching inside it', () => {
    assert.match(modal, /onClick=\{dismissible \? onClose : undefined\}/)
  })

  it('still closes on Escape', () => {
    // The keyboard's only exit. Pressing it is deliberate in a way that
    // clicking past the edge of a dialog is not. Note this is NOT gated on
    // `dismissible` — a dialog with no keyboard exit is a trap.
    const branch = modal.split("event.key === 'Escape'")[1].split("event.key !== 'Tab'")[0]
    assert.match(branch, /onCloseRef\.current\(\)/)
    assert.equal(/dismissible/.test(branch), false, 'Escape was gated on dismissible')
  })

  it('defaults to dismissible, so no existing dialog changed behaviour', () => {
    assert.match(modal, /dismissible = true/)
  })

  it('lets an open tooltip inside it take Escape first', () => {
    // Both listen on `window`, so both handlers fire. Without this, dismissing
    // the "what is a פעילות?" bubble also threw away the form behind it.
    assert.match(modal, /role="tooltip"\]:not\(\[hidden\]\)/)
  })
})

describe('the review screen', () => {
  const page = read('../src/features/teacher-app/tasks/TaskReviewPage.tsx')
  const app = read('../src/app/App.tsx')

  it('is reachable, and is not the tracking page', () => {
    assert.match(app, /tail === 'review'[\s\S]{0,80}TaskReviewPage/)
    assert.match(app, /TaskTrackingPage taskId=\{taskId\}/)
  })

  it('previews with the same player the child runs', () => {
    // A preview that renders content its own way can disagree with the thing
    // it is previewing — which is the exact case this screen exists to catch.
    const tag = page.split('<TaskPlayer')[1].split('/>')[0]
    assert.match(tag, /readOnly=\{!demo\}/)
    assert.match(tag, /content=\{data\.content\}/)
  })

  it('can be sat as a student, and sitting it writes nothing', () => {
    const player = read('../src/features/tasks/TaskPlayer.tsx')
    // `demo` gates BOTH save paths explicitly rather than relying on the
    // caller happening not to pass `onSave`.
    assert.match(player, /if \(demo \|\| readOnly \|\| !onSave\) return/)
    assert.equal((player.match(/if \(demo \|\| readOnly \|\| !onSave\) return/g) ?? []).length, 2)
    // And it never reaches submit.
    const tag = page.split('<TaskPlayer')[1].split('/>')[0]
    assert.equal(/onSubmit/.test(tag), false)
    assert.equal(/onSave/.test(tag), false)
  })

  it('hides the answer key behind a toggle', () => {
    assert.match(page, /showKey \? <AnswerKeyPanel/)
  })

  it('counts learners with two keys, because t\\(\\) has no plural engine', () => {
    assert.match(page, /launched === 1/)
    for (const table of Object.values(locales)) {
      assert.ok(table['tch.tasks.launched.one'])
      assert.match(table['tch.tasks.launched.many'], /\{n\}/)
      assert.equal(/\{n\}/.test(table['tch.tasks.launched.one']), false)
    }
  })

  it('offers no editing once children hold copies, and says why', () => {
    // The server refuses it either way; a screen that still shows the buttons
    // would just be offering a 400.
    assert.match(page, /status === 'live' \|\| status === 'closed'/)
    for (const [language, table] of Object.entries(locales)) {
      assert.ok(table['tch.tasks.reviewSent'], `${language} cannot explain the refusal`)
    }
  })
})
