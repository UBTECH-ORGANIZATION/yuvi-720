/* Opening Yuvi Studio closes the chat panel at once: on the press (before the
 * studio-time check and the navigation), again when the URL reaches the studio,
 * and the dock stays hidden while the studio overlay owns the URL.
 *
 *   node --test frontend/tests/
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p: string) => readFileSync(path.join(here, '../src', p), 'utf8')
const provider = read('providers/CompanionProvider.tsx')
const studio = read('features/Yuvi-studio/StudioTransitionProvider.tsx')
const app = read('app/App.tsx')

describe('the studio closes the chat', () => {
  it('the studio door asks the chat to close before anything else', () => {
    const open = studio.slice(studio.indexOf('const openStudio'))
    const ask = open.indexOf("'yuvilab:companion-close-now'")
    assert.ok(ask > 0, 'dispatches the close event')
    assert.ok(ask < open.indexOf('await startStudioTime()'), 'before the studio-time check')
    assert.ok(ask < open.indexOf('navigate(STUDIO_PATH)'), 'before the navigation')
  })

  it('the chat closes without its travelling animation, on the event and on the studio route', () => {
    assert.match(provider, /addEventListener\('yuvilab:companion-close-now', onCloseNow\)/)
    assert.match(provider, /pathname\.startsWith\('\/yuvi-studio'\) && isOpenRef\.current\) closeNow\(\)/)
    const closeNow = provider.slice(provider.indexOf('const closeNow'), provider.indexOf('const closeNow') + 400)
    assert.match(closeNow, /setIsOpen\(false\)/)
    assert.doesNotMatch(closeNow, /COMPANION_CLOSING_MS/)
  })

  it('the dock is hidden while the studio overlay owns the URL', () => {
    assert.match(app, /!routePath\.startsWith\('\/yuvi-studio'\) && !isActiveTaskRoute && <YuviCompanionDock \/>/)
  })
})
