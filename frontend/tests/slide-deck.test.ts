/* The deck: a real stage, and a diagram that actually reaches it.
 *
 *   node --test frontend/tests/
 *
 * The bug this file exists for was invisible from every angle. `render_visual`
 * returns `{type, mime_type, data_url, renderer, scene}`; the deck's `VisualSlot`
 * read `kind`, `url`, `video_url` and `image_url`, found none of them, and
 * returned null. `Slide.visual` was typed `unknown`, so nothing complained. And
 * it was called from ONE branch of the layout switch. Result: no Yuvi
 * presentation has ever shown a picture, and nothing anywhere said so.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const deck = read('../src/features/tasks/SlideDeck.tsx')
const css = read('../src/features/tasks/tasks.css')
const fit = read('../src/features/tasks/useFitToStage.ts')
const player = read('../src/features/tasks/TaskPlayer.tsx')
const review = read('../src/features/teacher-app/tasks/TaskReviewPage.tsx')
const service = read('../src/services/tasks.ts')
const locales = {
  he: JSON.parse(read('../../locales/he.json')) as Record<string, string>,
  en: JSON.parse(read('../../locales/en.json')) as Record<string, string>,
  ar: JSON.parse(read('../../locales/ar.json')) as Record<string, string>,
}

describe('a diagram reaches the slide', () => {
  it('renders through the component that knows the payload', () => {
    assert.match(deck, /<SceneRenderer visual=\{slide\.visual\}/)
    // The one that read four fields the payload does not have is gone —
    // matched on its definition, since the comment above explains it by name.
    assert.equal(/function VisualSlot/.test(deck), false)
  })

  it('is typed, so the next mismatch is a compile error', () => {
    assert.match(service, /visual\?: CoachVisual \| null/)
    assert.equal(/visual\?: unknown/.test(service), false)
  })

  it('is reachable from more than one layout', () => {
    // It used to be rendered from `default` alone: a comparison, a fact or a
    // timeline could not show a diagram even when one had been drawn for it.
    const uses = deck.match(/\{visual\}|visual \?\?/g) ?? []
    assert.ok(uses.length >= 4, `only ${uses.length} layouts can show one`)
  })
})

describe('the stage is fixed, and the type fits it', () => {
  it('lays the slide out at one size and scales it', () => {
    assert.match(fit, /export const STAGE_W = 1280/)
    assert.match(fit, /export const STAGE_H = 720/)
    assert.match(deck, /transform: `scale\(\$\{fit\.scale\}\)`/)
  })

  it('shrinks the type instead of clipping or scrolling', () => {
    assert.match(fit, /scrollHeight > stage\.clientHeight/)
    assert.match(fit, /MIN_TEXT_FIT = 0\.72/)
    assert.match(css, /--yv-text-fit: 1/)
  })

  it('measures the frame and not the thing it scaled', () => {
    // A scaled element reports its scaled size; a fit computed from that
    // converges on zero.
    assert.match(deck, /ref=\{fit\.frameRef\}/)
    assert.match(deck, /ref=\{fit\.stageRef\}/)
  })

  it('re-fits once the fonts have landed', () => {
    // Hebrew metrics change enough on font swap to turn a slide that just
    // fitted into one that just does not.
    assert.match(fit, /fonts\?\.ready/)
  })

  it('stops being a stage on a phone', () => {
    // 1280px scaled into a 380px viewport puts the title at 11px — measured.
    // A phone cannot project or print, which is what the fixed stage buys, so
    // it gets the same slide at its natural size instead of a postcard.
    assert.match(fit, /const FLOW_BELOW = 700/)
    assert.match(fit, /setFlow\(narrow\)/)
    assert.match(css, /\.yv-stage\.is-flow > \.yv-slide/)
    const flow = css.split('.yv-stage.is-flow > .yv-slide {')[1].split('}')[0]
    assert.match(flow, /transform: none/)
  })

  it('writes type in px against that stage, not in clamps', () => {
    // Anchored on the newline: `.yv-stage.is-flow .yv-slide__title` contains
    // the same substring and comes first in the file.
    const title = css.split('\n.yv-slide__title {')[1].split('}')[0]
    assert.match(title, /calc\(\d+px \* var\(--yv-text-fit\)\)/)
  })
})

describe('a composite scene is the server\'s picture, not two of them', () => {
  const renderer = read('../src/features/visuals/SceneRenderer.tsx')

  it('shows the server SVG for a scene it did not draw', () => {
    // `prop` and `drawing` — a balance, a vessel, a freehand object — are
    // composed on the backend and arrive already drawn. Re-implementing them
    // in Mafs would mean two drawings of the same prop that drift apart.
    assert.match(renderer, /visual\.renderer === 'svg-diagram'/)
  })

  it('sizes that image so it cannot take the whole stage', () => {
    // It is 960x540 and would otherwise take whatever height its width implies,
    // which on a half-slide column is most of the slide.
    const rule = css.split('.yv-slide__visual img {')[1].split('}')[0]
    assert.match(rule, /object-fit: contain/)
    assert.match(rule, /max-block-size/)
  })
})

describe('the subject decides the ground', () => {
  it('is chosen by code from the task spec, never by the model', () => {
    assert.match(review, /subject=\{data\.task\.spec\?\.subject\}/)
    assert.match(deck, /function groundFor\(subject\?: string\)/)
  })

  it('draws one for every subject it claims', () => {
    for (const ground of ['math', 'science', 'history', 'nature', 'language']) {
      assert.match(css, new RegExp(`\\[data-ground='${ground}'\\]`), ground)
    }
  })

  it('keeps the layout accent on top of the subject accent', () => {
    // The subject says which deck this is; the layout says which KIND of slide.
    const groundAt = css.indexOf("[data-ground='math']")
    const layoutAt = css.indexOf(".yv-deck .yv-slide[data-layout='summary']")
    assert.ok(layoutAt > groundAt, 'the layout accent must be declared after the grounds')
  })
})

describe('what the teacher gets and the child does not', () => {
  it('gates notes on the teacher flag', () => {
    assert.match(deck, /teacher \? \(/)
    assert.match(deck, /slide\.notes \?/)
    // The learner lane never passes it — matched on the prop, not the word.
    assert.equal(/teacher=/.test(read('../src/features/student-tasks/SolveTaskPage.tsx')), false)
  })

  it('prints every slide, one per landscape page', () => {
    assert.match(deck, /function PrintSheet/)
    assert.match(css, /@page \{ size: landscape/)
    assert.match(css, /break-after: page/)
  })

  it('presents with the arrow keys the language actually uses', () => {
    // In Hebrew the NEXT slide is to the left. A presenter reaches for the key
    // on the side the deck moves towards.
    assert.match(deck, /const rtl = language === 'he' \|\| language === 'ar'/)
    assert.match(deck, /ArrowRight'\) go\(rtl \? -1 : 1\)/)
  })

  it('rewrites one slide instead of the whole deck', () => {
    // The backend has taken `slide_index` since the edit path was built; the
    // only caller passed three arguments.
    assert.match(review, /\{ slide_index: index \}/)
  })
})

describe('what a teacher can ask a deck for', () => {
  const builder = read('../src/features/teacher-app/tasks/TeacherTasksPage.tsx')

  it('shows the panel only when a deck is being built', () => {
    assert.match(builder, /components\.includes\('presentation'\) \? \(/)
  })

  it('sends every option, not just the count', () => {
    assert.match(builder, /presentation: \{ slide_count: counts\.presentation, \.\.\.deck \}/)
  })

  it('keeps them in the draft, like every other field on this form', () => {
    // A teacher who closes the tab mid-form loses nothing else here.
    assert.match(builder, /counts, deck, deadline/)
  })

  it('explains what each toggle actually does', () => {
    for (const [language, table] of Object.entries(locales)) {
      for (const key of ['diagrams', 'examples', 'self_check', 'teacher_notes']) {
        assert.ok(table[`tch.tasks.deck.${key}`], `${language}: ${key}`)
        const explain = table[`tch.tasks.deck.explain.${key}`] ?? ''
        // Shorter than this is a restatement of the label.
        assert.ok(explain.length > 50, `${language}: explain.${key}`)
      }
      for (const theme of ['auto', 'math', 'science', 'history', 'nature',
                           'language', 'plain']) {
        assert.ok(table[`tch.tasks.deck.theme.${theme}`], `${language}: ${theme}`)
      }
    }
  })

  it('lets the teacher override the ground the subject chose', () => {
    assert.match(review, /theme=\{data\.task\.spec\?\.presentation\?\.theme\}/)
    assert.match(deck, /theme && theme !== 'auto' \? theme : groundFor\(subject\)/)
  })

  it('draws the child the same ground as the preview', () => {
    // Without this the child got the default violet while the teacher's
    // preview showed the subject's ground.
    const solve = read('../src/features/student-tasks/SolveTaskPage.tsx')
    assert.match(solve, /subject=\{task\.subject\}/)
    assert.match(solve, /theme=\{task\.theme\}/)
  })
})

describe('the strings exist in every language', () => {
  it('has each new deck key', () => {
    for (const [language, table] of Object.entries(locales)) {
      for (const key of ['tasks.deck.present', 'tasks.deck.print', 'tasks.deck.notes',
                         'tch.tasks.editSlide', 'tch.tasks.editSlideHint']) {
        assert.ok(table[key], `${language}: ${key}`)
      }
      assert.match(table['tch.tasks.editSlide'], /\{n\}/, language)
    }
  })

  it('still renders model text as React and never as markup', () => {
    // The reference implementation builds slides as model-authored HTML in an
    // iframe. This one may not, and the whole feature is checked for it.
    // On the JSX attribute, not the word: the files explain in prose why it
    // is banned, and a check that forbids saying so cannot be kept.
    assert.equal(/dangerouslySetInnerHTML=/.test(deck), false)
    assert.equal(/dangerouslySetInnerHTML=/.test(player), false)
  })
})
