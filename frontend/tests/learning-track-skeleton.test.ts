/* The learning track screen loads in place.
 *
 *   node --test frontend/tests/
 *
 * A spinner in the middle of an empty page says "wait"; a skeleton says "here
 * is the screen, it is filling in". The frame — subtitle, "continue here"
 * eyebrow, goals heading — is real text from the first paint, and only what
 * the catalog decides is sketched, in the same markup the data will use, so
 * nothing moves when it lands.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const portal = read('../src/features/learning-portal/LearningPortalPage.tsx')
const skeleton = read('../src/features/learning-portal/TrackSkeleton.tsx')
const view = read('../src/features/learning-portal/SimpleTrackView.tsx')

describe('the track screen shows its frame before its data', () => {
  it('no longer tears the page down around a spinner', () => {
    assert.equal(/LoadingState/.test(portal), false)
    assert.match(portal, /loading \? \(\s*<TrackSkeleton subject=\{selectedSubject\} \/>/)
  })

  it('sketches the subject tabs on a first visit, and keeps real ones on a re-fetch', () => {
    assert.match(portal, /availableSubjects\.length > 0 \|\| loading/)
    assert.match(portal, /learning-subject-filters--loading/)
  })

  it('keeps the fixed copy real and sketches only what the catalog decides', () => {
    for (const key of ['learning.track.resume.eyebrow', 'learning.track.topics.title', 'learning.track.topics.body']) {
      assert.match(skeleton, new RegExp(`t\\('${key.replace(/\./g, '\\.')}'\\)`), `${key} is sketched instead of shown`)
    }
    // The subject name is known on a re-fetch and sketched on the first visit.
    assert.match(skeleton, /subject \? t\(`learning\.subject\.\$\{subject\}`\) : <Skeleton/)
  })

  it('uses the same layout classes as the real view, so the swap moves nothing', () => {
    for (const cls of ['lt-track', 'lt-head', 'lt-resume', 'lt-resume__copy', 'lt-resume__eyebrow', 'lt-goals', 'lt-goals__head', 'lt-goals__grid', 'lt-goal', 'lt-goal__meta', 'lt-meter']) {
      assert.ok(view.includes(`"${cls}`) || view.includes(`${cls} `) || view.includes(`\`${cls}`), `${cls} missing from the view`)
      assert.ok(skeleton.includes(cls), `${cls} missing from the skeleton`)
    }
  })

  it('tells assistive tech the region is busy, in every language', () => {
    assert.match(skeleton, /aria-busy="true"/)
    assert.match(skeleton, /aria-label=\{t\('learning\.loading\.title'\)\}/)
    for (const lang of ['he', 'en', 'ar']) {
      const table = JSON.parse(read(`../../locales/${lang}.json`)) as Record<string, string>
      assert.ok(table['learning.loading.title'], `${lang} has no loading label`)
    }
  })
})
