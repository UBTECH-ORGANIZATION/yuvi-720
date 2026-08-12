/* Which way time runs.
 *
 *   node --test frontend/tests/
 *
 * The teacher app is Hebrew and Arabic first, and the charts used to mirror
 * with the interface: `scaleX(-1)` on the plot, or the series reversed before
 * drawing. So the newest day sat on the LEFT, and a month of steady improvement
 * was drawn as a line falling off a cliff.
 *
 * An interface mirrors; an axis does not. Hebrew and Arabic write timelines,
 * dates and graph axes left-to-right, and this is the test that keeps them that
 * way — the failure is silent, it looks like a chart either way, and only the
 * conclusion is upside down.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const charts = read('../src/components/charts/index.tsx')

describe('time runs left to right, in every language', () => {
  it('mirrors no plot', () => {
    assert.equal(/scaleX\(-1\)/.test(charts), false, 'a chart still flips itself')
  })

  it('reverses no series', () => {
    assert.equal(/points\]\.reverse\(\)/.test(charts), false, 'a chart still reverses its data')
  })

  it('takes no rtl flag at all, so no call site can ask for a mirror', () => {
    assert.equal(/\brtl\b/.test(charts), false, 'the kit still accepts an rtl prop')
  })

  it('pins the interactive plot to LTR, so its readout lands on the right day', () => {
    // The readout is positioned with `insetInlineStart`, which resolves against
    // the container's direction — inside an RTL card it would anchor from the
    // right while the point it names is measured from the left.
    const spark = charts.split('export function HoverSparkline')[1]
    assert.match(spark, /className="sp-spark" dir="ltr"/)
  })

  it('still writes its labels in the reader\'s language', () => {
    // dir="ltr" on the box must not turn a Hebrew date into gibberish.
    const readout = charts.split('sp-spark__readout')[1].split('</span>')[0]
    assert.match(readout, /<b dir="auto">/)
    assert.match(readout, /<small dir="auto">/)
  })

  it('is asked for one by nobody', () => {
    for (const path of [
      '../src/features/teacher-app/student/TeacherStudentPage.tsx',
      '../src/features/teacher-app/learnings/LearningDetailPage.tsx',
    ]) {
      assert.equal(/rtl=\{/.test(read(path)), false, `${path} still passes rtl to a chart`)
    }
  })
})
