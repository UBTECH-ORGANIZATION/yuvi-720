/* Telling "your words were declined" apart from "the network dropped".
 *
 *   node --test frontend/tests/
 *
 * Three different things arrive as a failed POST on this endpoint and they need
 * three different sentences in front of a person:
 *
 *   422 with a STRING detail   → moderation. The send worked; the words did not.
 *   422 with an ARRAY detail   → FastAPI rejecting the body. Our bug, not theirs.
 *   anything else / a throw    → the request never landed.
 *
 * The reference implementation this was ported from showed the same toast for
 * all three, and cleared the input before the request resolved — so a refused
 * message was simply gone and its author had to retype it from memory.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  MessageRefused, sendMessage, sendMyMessage,
} from '../src/services/directMessages.ts'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const locales = {
  he: JSON.parse(read('../../locales/he.json')) as Record<string, string>,
  en: JSON.parse(read('../../locales/en.json')) as Record<string, string>,
  ar: JSON.parse(read('../../locales/ar.json')) as Record<string, string>,
}

type FetchArgs = { url: string; init: RequestInit }
const calls: FetchArgs[] = []

function stubFetch(response: { status: number; body?: unknown; throws?: boolean }) {
  ;(globalThis as { fetch: unknown }).fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (response.throws) throw new TypeError('Failed to fetch')
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
    }
  }
}

afterEach(() => { calls.length = 0 })

describe('a refused message', () => {
  it('surfaces as its own error type, carrying a locale key', async () => {
    stubFetch({ status: 422, body: { detail: 'moderation.default' } })
    await assert.rejects(
      () => sendMessage('kid-1', 'something rude', 'he'),
      (error: unknown) => {
        assert.ok(error instanceof MessageRefused)
        assert.equal((error as MessageRefused).key, 'moderation.default')
        return true
      })
  })

  it('carries the distress key through unchanged', async () => {
    // The gentler wording is a different key, and flattening the two here
    // would answer a child in crisis with "kind words only".
    stubFetch({ status: 422, body: { detail: 'moderation.distress' } })
    await assert.rejects(
      () => sendMyMessage('t-1', 'i want to die', 'he'),
      (error: unknown) => (error as MessageRefused).key === 'moderation.distress')
  })

  it('is NOT raised for a schema 422, whose detail is an array', async () => {
    // FastAPI's own validation error. Showing "kind words only" for it would
    // tell a person their sentence was offensive when our request was malformed.
    stubFetch({ status: 422, body: { detail: [{ loc: ['body', 'text'], msg: 'field required' }] } })
    await assert.rejects(
      () => sendMessage('kid-1', 'hello', 'he'),
      (error: unknown) => {
        assert.ok(!(error instanceof MessageRefused))
        assert.equal((error as Error & { status: number }).status, 422)
        return true
      })
  })

  it('is NOT raised for a 403', async () => {
    stubFetch({ status: 403, body: { detail: 'not_authorized' } })
    await assert.rejects(
      () => sendMessage('kid-1', 'hello', 'he'),
      (error: unknown) => !(error instanceof MessageRefused))
  })

  it('is NOT raised when the request never landed', async () => {
    stubFetch({ status: 0, throws: true })
    await assert.rejects(
      () => sendMessage('kid-1', 'hello', 'he'),
      (error: unknown) => !(error instanceof MessageRefused))
  })

  it('survives a 422 with no parseable body at all', async () => {
    // A proxy returning an HTML error page still has to produce an error the
    // caller can handle rather than an exception inside the error handler.
    stubFetch({ status: 422, body: undefined })
    await assert.rejects(() => sendMessage('kid-1', 'hello', 'he'))
  })
})

describe('the two lanes', () => {
  it('post to the endpoint their own role owns', async () => {
    stubFetch({ status: 200, body: { id: 'dm_1' } })
    await sendMessage('kid-1', 'hello', 'he')
    assert.equal(calls[0].url, '/api/teacher/students/kid-1/messages')

    calls.length = 0
    await sendMyMessage('t-1', 'hello', 'he')
    // No learner id anywhere in the learner's own path: the child is the
    // session, so one child cannot address a message as another.
    assert.equal(calls[0].url, '/api/me/messages/t-1')
  })

  it('url-encode the id rather than concatenating it', async () => {
    stubFetch({ status: 200, body: { id: 'dm_1' } })
    await sendMessage('kid/../admin', 'hello', 'he')
    assert.equal(calls[0].url.includes('kid%2F..%2Fadmin'), true)
  })

  it('send credentials, or every request is an anonymous one', async () => {
    stubFetch({ status: 200, body: { id: 'dm_1' } })
    await sendMessage('kid-1', 'hello', 'he')
    assert.equal(calls[0].init.credentials, 'include')
  })

  it('carry the language, so the refusal comes back readable', async () => {
    stubFetch({ status: 200, body: { id: 'dm_1' } })
    await sendMyMessage('t-1', 'שלום', 'ar')
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { text: 'שלום', language: 'ar' })
  })
})

describe('the words a refusal renders', () => {
  const KEYS = ['moderation.default', 'moderation.distress']

  it('exist in all three languages', () => {
    for (const [language, table] of Object.entries(locales)) {
      for (const key of KEYS) {
        assert.ok(table[key], `${language} is missing ${key}`)
      }
    }
  })

  it('are the exact keys the backend sends', () => {
    // The one place the two languages meet. A rename on either side renders the
    // raw key at a child who has just been told off, which is the worst possible
    // moment for the UI to look broken.
    const backend = read('../../backend/app/services/direct_messages.py')
    assert.match(backend, /MODERATION_KEY = "moderation\.default"/)
    assert.match(backend, /MODERATION_KEY_DISTRESS = "moderation\.distress"/)
  })

  it('say different things, because they are different situations', () => {
    for (const [language, table] of Object.entries(locales)) {
      assert.notEqual(table['moderation.default'], table['moderation.distress'], language)
    }
  })

  it('never blame the app for a refusal', () => {
    // "Something went wrong" is what the reference showed, and it is a lie: the
    // send worked perfectly. Every language's wording must be about the words.
    for (const [language, table] of Object.entries(locales)) {
      for (const key of KEYS) {
        assert.ok(table[key].length > 10, `${language}.${key} is too terse to be kind`)
      }
    }
  })
})

describe('what the composers do with a rejected draft', () => {
  const teacher = read('../src/features/teacher-app/messages/TeacherMessagesPage.tsx')
  const student = read('../src/features/student-dashboard/StudentConnectionsPane.tsx')

  it('clear the draft only after a send that succeeded', () => {
    /* The ordering IS the guarantee: `setDraft('')` must sit after the awaited
       send inside `try`, never in `finally` and never before it.
       Checked at EVERY send site, not at the first one. The teacher screen has
       two composers now — one to a child, one to a sub-group — and a version of
       this that read `indexOf` was measuring the first `setDraft` in the file
       against the first send in the file, which are in different functions. */
    // The message senders only. A looser pattern also matched `sendKudos`,
    // which is a different dialog with no draft of its own to clear.
    const SENDS = /await send(?:My|Subgroup)?Message\(/g
    for (const [name, source] of [['teacher', teacher], ['student', student]] as const) {
      const sites = [...source.matchAll(SENDS)].map((match) => match.index ?? -1)
      assert.ok(sites.length > 0, `${name}: no send call found`)
      for (const at of sites) {
        const cleared = source.indexOf("setDraft('')", at)
        const caught = source.indexOf('} catch', at)
        assert.ok(cleared > at && (caught < 0 || cleared < caught),
                  `${name}: a send at ${at} does not clear the draft inside its try`)
      }
    }
  })

  it('branch on MessageRefused rather than on the status code', () => {
    for (const [name, source] of [['teacher', teacher], ['student', student]] as const) {
      assert.ok(source.includes('error instanceof MessageRefused'),
                `${name} does not distinguish a refusal from a failure`)
    }
  })

  it('render the key the server chose, not one hard-coded key', () => {
    for (const [name, source] of [['teacher', teacher], ['student', student]] as const) {
      assert.ok(source.includes("t(refusalKey || 'moderation.default')"),
                `${name} ignores the distress wording`)
    }
  })

  it('scroll the thread to the newest message', () => {
    for (const [name, source] of [['teacher', teacher], ['student', student]] as const) {
      assert.ok(source.includes('scrollTop = bodyRef.current.scrollHeight'),
                `${name} opens a conversation at its oldest line`)
    }
  })

  it('gives the child a textarea, not a one-line input', () => {
    // An answer to a teacher runs longer than a chat line; a single-line field
    // that scrolls sideways is where a child abandons the sentence.
    assert.match(student, /<textarea[\s\S]{0,400}id="sd-chat-compose"/)
  })
})
