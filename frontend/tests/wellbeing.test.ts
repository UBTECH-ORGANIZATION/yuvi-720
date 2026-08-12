/* The screen a safety notification lands on.
 *
 *   node --test frontend/tests/
 *
 * What is pinned here is mostly what the screen must NOT do: act on its own,
 * offer buttons on a record it cannot write to, close something without a
 * reason, or present a written fallback as if a model had weighed this
 * particular child's words. Those are the ways a safeguarding surface goes
 * quietly wrong, and none of them look like a bug in a screenshot.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  setItem(key: string, value: string): void { this.map.set(key, value) }
  removeItem(key: string): void { this.map.delete(key) }
  get size(): number { return this.map.size }
  keys(): string[] { return [...this.map.keys()] }
}

const storage = new MemoryStorage()
;(globalThis as { window?: unknown }).window = { sessionStorage: storage }

const { putMessageSeed, takeMessageSeed } =
  await import('../src/features/teacher-app/messages/messageSeed.ts')

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const tab = read('../src/features/teacher-app/student/TeacherWellbeing.tsx')
const page = read('../src/features/teacher-app/student/TeacherStudentPage.tsx')
const messages = read('../src/features/teacher-app/messages/TeacherMessagesPage.tsx')
const locales = {
  he: JSON.parse(read('../../locales/he.json')) as Record<string, string>,
  en: JSON.parse(read('../../locales/en.json')) as Record<string, string>,
  ar: JSON.parse(read('../../locales/ar.json')) as Record<string, string>,
}

describe('the bell lands on the disclosure, not on the profile', () => {
  it('opens the tab the route names', () => {
    assert.match(page, /query\.get\('tab'\)/)
    assert.match(page, /setTab\(wantedTab as Tab\)/)
  })

  it('still honours the older link every existing notification carries', () => {
    // A notification's action is written once and never rewritten, so every
    // alert raised before the flag id shipped still says `?focus=flags`.
    assert.match(page, /query\.get\('focus'\) === 'flags'[\s\S]{0,60}setTab\('wellbeing'\)/)
  })

  it('scrolls to the flag the alert was about, and rings it', () => {
    assert.match(tab, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/)
    assert.match(tab, /setRinging\(true\)/)
  })

  it('says so when the flag is older than the store', () => {
    // Rather than scrolling nowhere and leaving the teacher to wonder.
    assert.match(tab, /focusMissing/)
    for (const [language, table] of Object.entries(locales)) {
      assert.ok(table['tch.wellbeing.focusMissing'], `${language}`)
    }
  })

  it('repairs the older routes on the way out, by kind', () => {
    // Two generations of safety notifications are already sitting in real
    // teachers' bells with routes that name no tab. They cannot be rewritten
    // in place, so the bell sends them somewhere useful.
    const bell = read('../src/components/NotificationBell.tsx')
    assert.match(bell, /row\.title_key !== 'tch\.alert\.safety'/)
    assert.match(bell, /tab=wellbeing/)
  })

  it('counts open flags on the tab itself', () => {
    // The one thing on this page a teacher must not have to click to discover.
    assert.match(page, /openFlags > 0/)
    assert.match(page, /has-alert/)
  })

  it('says what the badge counts, for anyone not looking at it', () => {
    // A red disc with a digit in it is a number beside a word without this.
    assert.match(page, /sp-sr-only[\s\S]{0,80}tch\.student\.openFlags/)
    for (const [language, table] of Object.entries(locales)) {
      assert.match(table['tch.student.openFlags'] ?? '', /\{count\}/, `${language}`)
    }
  })
})

describe('the card carries what an adult walking in needs', () => {
  it('shows the words, unedited', () => {
    assert.match(tab, /<blockquote className="tch-flag__words"[\s\S]{0,60}\{flag\.evidence\}/)
  })

  it('names where they were written, in words rather than a source key', () => {
    assert.match(tab, /tch\.wellbeing\.source\.\$\{flag\.source\}/)
    for (const [language, table] of Object.entries(locales)) {
      for (const source of ['coach_chat', 'competency_chat',
                            'direct_message', 'mapping_reflection']) {
        assert.ok(table[`tch.wellbeing.source.${source}`], `${language}: ${source}`)
      }
    }
  })

  it('says when a message never reached anyone', () => {
    // A teacher who assumes it was sent asks the wrong question.
    assert.match(tab, /!flag\.delivered/)
    for (const table of Object.values(locales)) {
      assert.ok(table['tch.wellbeing.notDelivered'])
    }
  })

  it('shows what the child was told back', () => {
    assert.match(tab, /flag\.reply/)
  })

  it('names everyone who was alerted', () => {
    assert.match(tab, /tch\.wellbeing\.notified/)
  })
})

describe('every action says what it does before it is pressed', () => {
  // "Does this tell anyone?" is not a question to answer by pressing a button
  // on a safeguarding record and finding out.
  const HINTED = ['claim', 'message', 'log', 'close', 'reopen']

  it('wraps each action in a hint rather than adding a question mark to each', () => {
    assert.match(tab, /Hint,? /)
    for (const action of HINTED) {
      const key = action === 'log' ? 'logHintTip'
                : action === 'close' ? 'closeHintTip'
                : `${action}Hint`
      assert.match(tab, new RegExp(`Hint text=\\{t\\('tch\\.wellbeing\\.${key}'\\)`), action)
    }
  })

  it('explains all of them in all three languages', () => {
    for (const [language, table] of Object.entries(locales)) {
      for (const key of ['claimHint', 'messageHint', 'logHintTip',
                         'closeHintTip', 'reopenHint']) {
        const value = table[`tch.wellbeing.${key}`] ?? ''
        // A hint shorter than this is a restatement of the button's own label.
        assert.ok(value.length > 40, `${language}: ${key}`)
      }
    }
  })
})

describe('what the screen refuses to do', () => {
  it('offers no actions on a record it cannot write to', () => {
    // A legacy row is a projection out of the old brain array; buttons on it
    // would 404 against a flag that has no document.
    assert.match(tab, /flag\.legacy \?[\s\S]{0,200}tch\.wellbeing\.legacy/)
    assert.match(tab, /if \(busy \|\| flag\.legacy\) return/)
  })

  it('will not close without a reason', () => {
    assert.match(tab, /disabled=\{busy \|\| !reason\}/)
    for (const [language, table] of Object.entries(locales)) {
      for (const reason of ['handled', 'referred', 'not_relevant']) {
        assert.ok(table[`tch.wellbeing.reason.${reason}`], `${language}: ${reason}`)
      }
    }
  })

  it('never asks for a suggestion on its own', () => {
    // The request happens in a click handler and nowhere else — no effect, no
    // mount-time fetch, nothing that spends a model call on a card being read.
    assert.equal(/useEffect\([\s\S]{0,200}suggestWellbeing/.test(tab), false)
    assert.match(tab, /onClick=\{\(\) => void ask\(\)\}/)
  })

  it('says which suggestions are Yuvi\'s and which are the written fallbacks', () => {
    assert.match(tab, /generated \? 'tch\.wellbeing\.suggestNote' : 'tch\.wellbeing\.suggestOffline'/)
    for (const [language, table] of Object.entries(locales)) {
      assert.ok(table['tch.wellbeing.suggestOffline'], `${language}`)
    }
  })

  it('renders the protocol line from the locales, never from the model', () => {
    assert.match(tab, /t\('tch\.wellbeing\.protocol'\)/)
    for (const [language, table] of Object.entries(locales)) {
      assert.ok(table['tch.wellbeing.protocol'].length > 40, `${language}`)
    }
  })

  it('sends nothing by suggesting', () => {
    // Picking an opening fills a box or seeds a composer. There is no send.
    assert.equal(/sendMessage|sendKudos/.test(tab), false)
    assert.match(tab, /putMessageSeed\(\{ learnerId, text \}\)/)
  })
})

describe('an opening carried to the composer', () => {
  beforeEach(() => {
    for (const key of storage.keys()) storage.removeItem(key)
  })

  it('arrives at the right thread, once', () => {
    putMessageSeed({ learnerId: 'kid-1', text: 'ראיתי מה שכתבת, אני כאן.' })
    assert.deepEqual(takeMessageSeed(),
                     { learnerId: 'kid-1', text: 'ראיתי מה שכתבת, אני כאן.' })
    assert.equal(takeMessageSeed(), null)
    assert.equal(storage.size, 0)
  })

  it('is ignored when it names nobody or says nothing', () => {
    putMessageSeed({ learnerId: '', text: 'x' })
    assert.equal(takeMessageSeed(), null)
    putMessageSeed({ learnerId: 'kid-1', text: '   ' })
    assert.equal(takeMessageSeed(), null)
  })

  it('selects that student over the first row of the rail', () => {
    assert.match(messages, /seed && rows\.some\(\(row\) => row\.learner_id === seed\.learnerId\)/)
  })

  it('fills the composer without sending it', () => {
    assert.match(messages, /useState\(opening \?\? ''\)/)
    const thread = messages.split('function Thread(')[1] ?? ''
    assert.equal(/useEffect\([\s\S]{0,120}sendMessage/.test(thread), false)
  })
})
