/* The learnings screen's two judgements: what a row is called, and what jumps
 * the queue.
 *
 *   node --test frontend/tests/
 *
 * Both were reported as the same complaint — `tch.subject.english` and
 * `ENG.G7.FAMILY.SPEAK-01` rendered as if they were words a teacher could read.
 * They are not the same bug: one is a locale table that fell behind the content
 * vendor, the other is a catalogue row with no title at all. The fix for the
 * first can be a translation; the fix for the second cannot, because there is
 * no name to translate.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { subjectLabel } from '../src/features/teacher-app/shared/subjectLabel.ts'
import {
  ATTENTION_MAX_SUCCESS, byAttention, learningName, needsAttention,
} from '../src/features/teacher-app/learnings/learningRows.ts'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const locales = {
  he: JSON.parse(read('../../locales/he.json')) as Record<string, string>,
  en: JSON.parse(read('../../locales/en.json')) as Record<string, string>,
  ar: JSON.parse(read('../../locales/ar.json')) as Record<string, string>,
}

/** `I18nProvider.t` exactly: a hit interpolates, a MISS returns the key. That
 *  miss is the whole reason `subjectLabel` exists, so the stub has to reproduce
 *  it rather than throw or return empty. */
const translator = (table: Record<string, string>) =>
  (key: string) => table[key] ?? key

const he = translator(locales.he)

describe('a subject a teacher can read', () => {
  it('uses the translation when there is one', () => {
    assert.equal(subjectLabel('math', he), locales.he['tch.subject.math'])
    assert.equal(subjectLabel('science', he), locales.he['tch.subject.science'])
  })

  it('translates the two subjects the live catalogue added', () => {
    // `english` is what the events carry and what the screenshot showed raw.
    for (const [language, table] of Object.entries(locales)) {
      for (const subject of ['math', 'science', 'english', 'other']) {
        const label = subjectLabel(subject, translator(table))
        assert.notEqual(label, `tch.subject.${subject}`,
                        `${language} renders ${subject} as its own key`)
        assert.ok(label.length, `${language} renders ${subject} as nothing`)
      }
    }
  })

  it('never renders a dotted key, whatever the vendor sends', () => {
    // The failure the helper exists to prevent. A subject nobody has translated
    // must still come out as a word.
    const label = subjectLabel('civics', he)
    assert.equal(label.includes('tch.subject'), false)
    assert.equal(label, 'Civics')
  })

  it('humanises separators rather than printing them', () => {
    assert.equal(subjectLabel('language_arts', he), 'Language Arts')
    assert.equal(subjectLabel('social-studies', he), 'Social Studies')
  })

  it('matches a translation regardless of the case the vendor used', () => {
    assert.equal(subjectLabel('Math', he), locales.he['tch.subject.math'])
    assert.equal(subjectLabel('SCIENCE', he), locales.he['tch.subject.science'])
  })

  it('is empty for no subject, so a meta list can just filter it out', () => {
    for (const value of [null, undefined, '', '   ']) {
      assert.equal(subjectLabel(value, he), '')
    }
  })
})

describe('what a learning is called', () => {
  it('uses the real title when the catalogue has one', () => {
    const name = learningName({
      component_id: 'c-1', title: 'מסה ונפח של גופים', objective_title: 'יעד',
    })
    assert.deepEqual(name, { title: 'מסה ונפח של גופים', named: true, rawId: null })
  })

  it('falls back to the objective when the title IS the id', () => {
    // `_catalog_spine` writes `title: component.title or component_id`, so an
    // untitled component arrives with its id in the title field.
    const name = learningName({
      component_id: 'ENG.G7.FAMILY.SPEAK-01',
      title: 'ENG.G7.FAMILY.SPEAK-01',
      objective_title: 'דיבור על המשפחה',
    })
    assert.equal(name.title, 'דיבור על המשפחה')
    assert.equal(name.named, true)
    // The id is still worth showing — as meta, once.
    assert.equal(name.rawId, 'ENG.G7.FAMILY.SPEAK-01')
  })

  it('shows the id as an id when nothing can name the row', () => {
    const name = learningName({
      component_id: 'ENG.G7.FAMILY.SPEAK-01',
      title: 'ENG.G7.FAMILY.SPEAK-01',
      objective_title: null,
    })
    assert.equal(name.title, 'ENG.G7.FAMILY.SPEAK-01')
    // The flag the card reads to style it as an identifier instead of a name.
    assert.equal(name.named, false)
    // Never twice: the title already IS the id.
    assert.equal(name.rawId, null)
  })

  it('does not invent a name', () => {
    // The alternative that was considered and rejected: five untitled rows all
    // called "untitled learning" is worse than five ids, because the id is the
    // only thing that tells them apart.
    const a = learningName({ component_id: 'X-1', title: 'X-1' })
    const b = learningName({ component_id: 'X-2', title: 'X-2' })
    assert.notEqual(a.title, b.title)
  })

  it('treats a blank title like a missing one', () => {
    const name = learningName({ component_id: 'c-1', title: '   ', objective_title: 'יעד' })
    assert.equal(name.title, 'יעד')
  })

  it('never puts an empty string in the title slot', () => {
    const name = learningName({ component_id: 'c-1', title: '', objective_title: '  ' })
    assert.equal(name.title, 'c-1')
    assert.ok(name.title.length)
  })
})

describe('what jumps the queue', () => {
  const row = (over: Partial<Parameters<typeof needsAttention>[0]> = {}) => ({
    started: true, struggling_count: 0, success_rate: 0.9, last_activity_at: null, ...over,
  })

  it('pins a learning somebody is struggling in', () => {
    assert.equal(needsAttention(row({ struggling_count: 1, success_rate: 0.95 })), true)
  })

  it('pins a learning the class is failing', () => {
    assert.equal(needsAttention(row({ success_rate: 0.22 })), true)
  })

  it('leaves a healthy learning where the curriculum put it', () => {
    assert.equal(needsAttention(row({ success_rate: 0.9 })), false)
  })

  it('never pins untouched material', () => {
    // The catalogue is the spine, so most rows have no activity at all. A
    // `success_rate` of null must not read as a rate of zero.
    assert.equal(needsAttention(row({ started: false, success_rate: null })), false)
    assert.equal(needsAttention(
      row({ started: false, success_rate: null, struggling_count: 3 })), false)
  })

  it('does not pin a started learning nobody has answered in', () => {
    assert.equal(needsAttention(row({ success_rate: null })), false)
  })

  it('is exclusive at the threshold, so the boundary is not both', () => {
    assert.equal(needsAttention(row({ success_rate: ATTENTION_MAX_SUCCESS })), false)
    assert.equal(needsAttention(row({ success_rate: ATTENTION_MAX_SUCCESS - 0.001 })), true)
  })

  it('orders the worst first', () => {
    const rows = [
      { id: 'ok', ...row({ success_rate: 0.4 }) },
      { id: 'worst', ...row({ struggling_count: 3, success_rate: 0.4 }) },
      { id: 'mid', ...row({ struggling_count: 1, success_rate: 0.1 }) },
    ]
    assert.deepEqual(byAttention(rows).map((r) => r.id), ['worst', 'mid', 'ok'])
  })

  it('breaks a tie on success rate, then on recency', () => {
    const rows = [
      { id: 'older', ...row({ struggling_count: 1, success_rate: 0.3, last_activity_at: '2026-08-01' }) },
      { id: 'newer', ...row({ struggling_count: 1, success_rate: 0.3, last_activity_at: '2026-08-09' }) },
      { id: 'lower', ...row({ struggling_count: 1, success_rate: 0.1, last_activity_at: '2026-01-01' }) },
    ]
    assert.deepEqual(byAttention(rows).map((r) => r.id), ['lower', 'newer', 'older'])
  })

  it('does not mutate the array it was given', () => {
    const rows = [row({ success_rate: 0.1 }), row({ struggling_count: 2 })]
    const before = [...rows]
    byAttention(rows)
    assert.deepEqual(rows, before)
  })
})

describe('the section labels the pinned group needs', () => {
  it('has every new heading in all three languages', () => {
    for (const [language, table] of Object.entries(locales)) {
      for (const key of [
        'tch.learnings.attention',
        'tch.learnings.attentionSub',
        'tch.learnings.noUnit',
        'tch.learnings.unnamed',
      ]) {
        assert.ok(table[key], `${language} is missing ${key}`)
      }
    }
  })
})

describe('the backend stops handing ids to the screen', () => {
  const analytics = read('../../backend/app/services/learning_analytics.py')
  const catalogue = read('../../backend/app/services/kata_catalog.py')

  it('offers an accessor that returns null instead of the dotted key', () => {
    // Two accessors on purpose. `localized_objective_title` still falls back to
    // the key, which is right for a log line, a prompt and a sort key.
    // `objective_title` returns null, which is the only safe one for a screen —
    // `MOE.ENG.G7.PEOPLE.FAMILY.WRITE` reached a teacher's moments feed as the
    // name of what a child had just achieved.
    //
    // Asserted as a property of the body rather than as one literal line: this
    // used to read `return title or None` and now goes through the translation
    // ladder, which is the same guarantee reached a different way. Pinning the
    // line meant the guard failed on a refactor that kept the promise.
    assert.match(catalogue, /def objective_title\(/)
    const body = catalogue.split('def objective_title(')[1].split('\ndef ')[0]
    assert.match(body, /Optional\[str\]/)
    assert.equal(/or objective_id/.test(body), false,
                 'objective_title can fall back to the id again')
  })

  it('resolves a title through the ladder that can end in null', () => {
    // The other half: the ladder `objective_title` now delegates to must be
    // able to return nothing, or the guard above passes over a function that
    // always has an answer.
    const i18n = read('../../backend/app/services/catalog_i18n.py')
    assert.match(i18n, /def title\([\s\S]*?\)\s*->\s*Optional\[str\]/)
  })

  it('uses the safe one everywhere a teacher reads the result', () => {
    for (const [name, source] of [
      ['learning_analytics', analytics],
      ['moments', read('../../backend/app/services/moments.py')],
    ] as const) {
      assert.equal(/kata_catalog\.localized_objective_title\(/.test(source), false,
                   `${name} can still print a dotted key`)
      assert.match(source, /objective_title\(/)
    }
  })

  it('no longer falls a unit heading back to the unit id', () => {
    assert.equal(/get\("title"\) or unit_id/.test(analytics), false)
  })

  it('has an unnamed variant of every moment sentence that names an objective', () => {
    // With the id gone, `"הצלחה ראשונה ב{label} אחרי 6 ניסיונות"` renders with a
    // dangling preposition. Each of those sentences needs a variant that simply
    // does not name the objective.
    const withLabel = Object.keys(locales.he)
      .filter((key) => key.startsWith('tch.moment.')
        && !key.endsWith('.unnamed')
        && locales.he[key].includes('{label}'))
    assert.ok(withLabel.length >= 3, `found only ${withLabel}`)
    for (const [language, table] of Object.entries(locales)) {
      for (const key of withLabel) {
        assert.ok(table[`${key}.unnamed`], `${language} is missing ${key}.unnamed`)
        assert.equal(table[`${key}.unnamed`].includes('{label}'), false,
                     `${language}: ${key}.unnamed still names the objective`)
      }
    }
  })
})
