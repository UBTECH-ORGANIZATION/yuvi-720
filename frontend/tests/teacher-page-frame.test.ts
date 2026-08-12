/* Every teacher page sits in the same frame.
 *
 *   node --test frontend/tests/
 *
 * `.sp-teacher-shell__main` carries no padding of its own — a page has to be
 * able to run a band edge to edge — so the max-width, the centring and the
 * padding are the PAGE's, declared once in `teacher-shared.css`.
 *
 * It was not declared once. The same three lines were copied byte-for-byte
 * into six stylesheets, and the tasks page shipped without its copy: content
 * flush against the chrome on all four sides, full-bleed on a wide monitor.
 * Nothing failed, because nothing was checking.
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../src/features/teacher-app', import.meta.url))
const shared = readFileSync(join(root, 'shared/teacher-shared.css'), 'utf8')

/** The frame, verbatim. Matching on the declarations rather than on a class
 *  name is what lets the duplication test below find a second copy anywhere. */
const FRAME = 'max-inline-size: 1240px'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const files = walk(root)

/** The frame rule's selector list — everything before the opening brace. */
function frameSelectors(css: string): string[] {
  // Comments first: the rule carries a long one, and it would otherwise be
  // swallowed into the first selector of the list.
  const match = css.replace(/\/\*[\s\S]*?\*\//g, '')
    .match(/([^{}]*)\{[^{}]*max-inline-size:\s*1240px/)
  if (!match) return []
  return match[1].split(',').map((selector) => selector.trim()).filter(Boolean)
}

/** A page component's root element class — the first `className="tch-…"` in
 *  the file. True of every page here: the root div is the first JSX element
 *  the component returns, and its class is the page's own name. */
function rootClass(source: string): string | null {
  const match = source.match(/className=["'](tch-[A-Za-z]+)["']/)
  return match ? match[1] : null
}

describe('the teacher page frame', () => {
  const selectors = frameSelectors(shared)

  it('is declared at all', () => {
    assert.ok(selectors.length >= 5, `found: ${selectors.join(', ')}`)
  })

  it('is declared exactly once, not copied into every page stylesheet', () => {
    const copies = files.filter((path) => path.endsWith('.css'))
      .filter((path) => readFileSync(path, 'utf8').includes(FRAME))
      .map((path) => path.slice(root.length + 1))
    assert.deepEqual(copies, ['shared/teacher-shared.css'],
                     `the frame is duplicated in: ${copies.join(', ')}`)
  })

  it('covers every page a teacher can navigate to', () => {
    /* The failure this exists for: `TeacherTasksPage` rendered `.tch-tasks`,
       which no stylesheet framed, so the page had no padding at all.

       Every `*Page.tsx`, not `Teacher*Page.tsx`: the first spelling of this
       glob missed `TaskTrackingPage` — which was unframed for the same reason
       and by the same oversight — because its name does not start with the
       word the guard happened to be written around. */
    const pages = files.filter((path) => /\w+Page\.tsx$/.test(path))
    assert.ok(pages.length >= 5, `found only ${pages.length} pages`)
    for (const path of pages) {
      const name = path.slice(root.length + 1)
      const root_ = rootClass(readFileSync(path, 'utf8'))
      assert.ok(root_, `${name}: could not find a root class`)
      assert.ok(selectors.includes(`.${root_}`),
                `${name} renders .${root_}, which the page frame does not cover`)
    }
  })
})
