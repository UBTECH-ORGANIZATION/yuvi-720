/* One avatar, and it stays one.
 *
 * There is no assertion a renderer can make here that a grep cannot: the failure
 * mode is not "the component is wrong", it is "somebody added a ninth avatar".
 * Eight near-identical implementations is exactly what happens when each screen
 * writes its own `slice(0, 1)` in a circle, and nothing ever notices.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const SRC = new URL('../src/', import.meta.url).pathname

function sources(): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { walk(path, `${prefix}${entry.name}/`); continue }
      if (!/\.tsx?$/.test(entry.name)) continue
      found.push({ path: prefix + entry.name, text: readFileSync(path, 'utf8') })
    }
  }
  walk(SRC, '')
  return found
}

test('no teacher screen renders its own learner avatar', () => {
  // The eight that existed, by the class each one invented.
  const retired = [
    'tch-studentCard__avatar', 'tch-roster__avatar', 'tch-tile__avatar',
    'tch-messages__avatar', 'tch-goalsPage__avatar', 'tch-student__avatar',
  ]
  for (const { path, text } of sources()) {
    if (path.endsWith('shared/StudentAvatar.tsx')) continue      // it names them in its docstring
    for (const className of retired) {
      assert.ok(
        !text.includes(`"${className}"`),
        `${path} still renders .${className} — use <StudentAvatar> instead`
      )
    }
  }
})

test('the avatar falls back to an initial, never to an empty coin', () => {
  const component = readFileSync(join(SRC, 'features/teacher-app/shared/StudentAvatar.tsx'), 'utf8')
  // A learner who has earned nothing yet must render a letter. If this branch
  // ever collapses into "always render a Badge", every such child becomes a
  // blank disc and the roster stops being readable.
  assert.match(component, /label\.slice\(0, 1\)/)
  assert.match(component, /active\.kind === 'badge'/)
})

test('the roster ships the avatar, or the coin can never appear', () => {
  const service = readFileSync(join(SRC, 'services/teacher.ts'), 'utf8')
  assert.match(service, /avatar\?: AvatarChoice \| null/)

  const provider = readFileSync(join(SRC, 'providers/TeacherRosterProvider.tsx'), 'utf8')
  assert.match(provider, /avatarOf/)
})
