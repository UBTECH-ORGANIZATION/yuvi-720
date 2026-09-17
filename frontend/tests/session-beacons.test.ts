/* The MoE session beacons the signed-in shell sends.
 *
 *   node --test frontend/tests/
 *
 * Source-level: the provider is React and a browser; what these pin is the
 * contract the server's session registry relies on — one suspend per pause,
 * one resume per return, a ping while visible, all through the beacon helper
 * that survives a closing tab.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const provider = readFileSync(path.join(here, '../src/providers/AuthProvider.tsx'), 'utf8')
const api = readFileSync(path.join(here, '../src/services/api.ts'), 'utf8')

describe('session beacons', () => {
  it('reports suspend, resume and ping through the beacon helper', () => {
    assert.match(provider, /apiBeacon\('\/api\/auth\/session\/suspend'\)/)
    assert.match(provider, /apiBeacon\('\/api\/auth\/session\/resume'\)/)
    assert.match(provider, /apiBeacon\('\/api\/auth\/session\/ping'\)/)
    assert.doesNotMatch(provider, /navigator\.sendBeacon/, 'the raw API lives in apiBeacon only')
  })

  it('never files two suspends for one pause (visibilitychange + pagehide both fire on close)', () => {
    assert.match(provider, /if \(suspended\) return/)
    assert.match(provider, /if \(!suspended\) return/)
    assert.match(provider, /window\.addEventListener\('pagehide', suspend\)/)
    assert.match(provider, /pageshow/)
  })

  it('pings every five minutes while the tab is visible', () => {
    assert.match(provider, /SESSION_PING_MS = 5 \* 60 \* 1000/)
    assert.match(provider, /if \(!document\.hidden\) apiBeacon\('\/api\/auth\/session\/ping'\)/)
    assert.match(provider, /window\.clearInterval\(timer\)/)
  })

  it('the beacon helper sends JSON and falls back to a POST', () => {
    assert.match(api, /export function apiBeacon\(path: string, body: unknown = \{\}\)/)
    assert.match(api, /new Blob\(\[JSON\.stringify\(body\)\], \{ type: 'application\/json' \}\)/)
    assert.match(api, /void apiPost\(path, body\)\.catch/)
  })
})
