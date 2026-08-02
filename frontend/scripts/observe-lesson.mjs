#!/usr/bin/env node
/**
 * Live observer: a REAL browser on the REAL Kata content, with the xAPI stream
 * and the chat side by side.
 *
 * Unlike `test-lesson-navigation.mjs` (which IS the content — synthetic
 * statements, deterministic), this one blocks nothing: the Kata iframe loads for
 * real, reports to Kata, Kata relays to our tunnel, and we watch what arrives.
 * Every second it prints a line whenever ANY of these changes:
 *
 *   xAPI   — new statements, straight from `backend/.runtime/xapi_raw.jsonl`
 *            (the raw capture, before any filtering)
 *   WHERE  — the server's idea of the learner's position (`support/state`)
 *   CHAT   — the thread list: caption, which one is marked, which are open
 *
 * The browser is headed by default — click through the lesson yourself and read
 * the log, or pass `--drive` to have it click the first screens for you.
 *
 * Prereqs: backend on :8720 with a PUBLIC tunnel in PUBLIC_APP_URL (otherwise
 * Kata's relay cannot reach us and NOTHING will arrive), frontend on :5173.
 *
 *   node scripts/observe-lesson.mjs [--learner=e2e-bot] [--component=…] [--seconds=600]
 */

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const argv = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const BASE_URL = String(process.env.YUVI_BASE_URL || 'http://localhost:5173')
const API = String(process.env.YUVI_API || 'http://127.0.0.1:8720')
const LEARNER = String(argv.get('learner') || process.env.YUVI_NAV_LEARNER || 'e2e-bot')
const UNIT = String(argv.get('unit') || 'methodica-science-mass-measure-01')
const COMPONENT = String(argv.get('component') || 'methodica-science-mass-measure-01-01')
const SECONDS = Number(argv.get('seconds') || 600)
const BACKEND = path.resolve(process.cwd(), '..', 'backend')
const AUDIT = path.join(BACKEND, '.runtime', 'xapi_raw.jsonl')
const ARTIFACTS = path.resolve(process.cwd(), '..', 'artifacts', 'observe-lesson')

const lines = []
const log = (tag, message) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${tag.padEnd(5)} ${message}`
  console.log(line)
  lines.push(line)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tail = (id) => String(id || '').replace(/\/+$/, '').split('/').slice(-2).join('/')

function mintToken() {
  const py = path.join(BACKEND, '.venv', 'bin', 'python3')
  const code =
    'import sys; sys.path.insert(0, ".");' +
    'from dotenv import load_dotenv; load_dotenv();' +
    'from app.auth.tokens import create_session_token;' +
    `print(create_session_token(user_id="${LEARNER}", username="${LEARNER}", roles=["learner"], session_id="observe"))`
  return execFileSync(py, ['-c', code], { cwd: BACKEND }).toString().trim().split('\n').pop().trim()
}

async function auditSize() {
  try {
    return (await readFile(AUDIT, 'utf8')).length
  } catch {
    return 0
  }
}

async function newStatements(from) {
  let text = ''
  try {
    text = await readFile(AUDIT, 'utf8')
  } catch {
    return { at: from, rows: [] }
  }
  if (text.length <= from) return { at: text.length, rows: [] }
  const rows = text
    .slice(from)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
  return { at: text.length, rows }
}

async function position(cookie) {
  try {
    const res = await fetch(
      `${API}/api/agent/coach/support/state?component_id=${COMPONENT}`,
      { headers: { Cookie: `spark_session=${cookie}` } },
    )
    const body = await res.json()
    const parts = String(body.question_key || '').split('|')
    const kinds = Object.fromEntries((body.items || []).map((i) => [i.id, i.kind]))
    return {
      item: parts[1] || '',
      question: parts[2] || '',
      kind: kinds[parts[1]] || '',
      text: `${(parts[1] || '(none)').slice(-4)}${parts[2] ? `/${parts[2]}` : ''} [${kinds[parts[1]] || '?'}]`,
    }
  } catch {
    return { item: '', question: '', kind: '', text: '(unreachable)' }
  }
}

async function chatState(page) {
  try {
    return await page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll('.sp-companion__qsection'))
      return {
        threads: sections.map((s) => ({
          item: (s.getAttribute('data-item') || '').slice(-4),
          caption: (s.querySelector('.sp-companion__qdivider-chip span:not(.sp-companion__qcount)')?.textContent || '').trim(),
          current: s.classList.contains('is-current'),
          open: !s.classList.contains('is-collapsed'),
        })),
        bubbles: document.querySelectorAll('.sp-companion__message-row--assistant').length,
        streaming: document.querySelectorAll('[data-message-complete="false"]').length > 0,
        chips: document.querySelectorAll('.sp-companion__helped').length,
      }
    })
  } catch {
    return { threads: [], bubbles: 0, streaming: false, chips: 0 }
  }
}

const describeChat = (c) =>
  `${c.threads.map((t) => `${t.caption || t.item}${t.current ? '*' : ''}${t.open ? '' : ':closed'}`).join(' | ') || '(no threads)'}`
  + ` · ${c.bubbles} bubbles${c.streaming ? ' · writing…' : ''}${c.chips ? ` · ${c.chips} helped-chips` : ''}`

async function main() {
  await mkdir(ARTIFACTS, { recursive: true })
  const cookie = mintToken()
  log('start', `learner=${LEARNER} component=${COMPONENT}`)
  log('start', `audit=${AUDIT}`)

  const browser = await chromium.launch({ headless: false, args: ['--window-size=1600,1000'] })
  const context = await browser.newContext({ viewport: { width: 1560, height: 940 } })
  await context.addCookies([{ name: 'spark_session', value: cookie, url: BASE_URL }])
  const page = await context.newPage()
  page.on('console', (m) => {
    const text = m.text()
    if (text.includes('[companion]') || text.includes('XAPI')) log('page ', text.slice(0, 160))
  })

  await page.goto(`${BASE_URL}/learning/lesson?unit=${UNIT}&component=${COMPONENT}`, {
    waitUntil: 'domcontentloaded', timeout: 60_000,
  })
  await page.locator('#Yuvi-companion-panel').waitFor({ state: 'visible', timeout: 60_000 })
  log('start', 'lesson open — click through it; every change is logged below')

  // `--drive` walks the first screens by itself (answer, continue, open the
  // video playlist), for an unattended run. Best-effort: the real content owns
  // its own DOM, so a missing button is logged and skipped, never fatal.
  if (argv.get('drive')) {
    void (async () => {
      const frame = page.frameLocator('iframe')
      const click = async (label, selector, timeout = 15_000) => {
        try {
          await frame.locator(selector).first().click({ timeout })
          log('drive', `clicked ${label}`)
          return true
        } catch {
          log('drive', `no ${label}`)
          return false
        }
      }
      // The content's own flow: pick something, then press the button that
      // commits it (בחרתי / בדיקה / המשך). Labels first — H5P class names differ
      // per screen type, the Hebrew captions do not.
      const COMMIT = 'button:has-text("בחרתי"), button:has-text("בדקו"), button:has-text("צדקתי"),'
        + ' button:has-text("להמשיך"), button:has-text("המשך"), button:has-text("בדיקה"),'
        + ' .h5p-joubelui-button, .h5p-question-check-answer, .h5p-question-next-question'
      await sleep(6000)
      for (let step = 0; step < 20; step += 1) {
        await click('an option', '.h5p-answer, .h5p-alternative, [role="radio"], .h5p-image-hotspot', 4000)
        const committed = await click('commit', COMMIT, 5000)
        if (!committed) {
          // A video screen commits nothing — start the clip instead.
          await click('play', 'button[aria-label*="Play"], .h5p-video-play, .vjs-big-play-button, video', 4000)
        }
        await sleep(4500)
      }
    })()
  }

  let cursor = await auditSize()          // only statements from NOW on
  let lastWhere = ''
  let lastChat = ''
  let shot = 0
  const until = Date.now() + SECONDS * 1000

  while (Date.now() < until) {
    const { at, rows } = await newStatements(cursor)
    cursor = at
    for (const row of rows) {
      // The audit is shared by everyone on this backend — a real learner using
      // the app right now writes into the same file. Only ours is our flow.
      if (row.learner_id && row.learner_id !== LEARNER) continue
      const s = row.statement || row
      const verb = tail(s?.verb?.id)
      const object = tail(s?.object?.id)
      const category = (((s?.context || {}).category) || [])[0]?.id
      const result = s?.result
        ? ` success=${s.result.success ?? '—'}${s.result.response ? ` "${String(s.result.response).slice(0, 40)}"` : ''}`
        : ''
      log('xAPI', `${verb.padEnd(14)} ${object}${result}${category ? ` (${tail(category)})` : ''}`)
    }

    const where = await position(cookie)
    if (where.text !== lastWhere) {
      lastWhere = where.text
      log('WHERE', where.text)
    }

    const chat = await chatState(page)
    const described = describeChat(chat)
    if (described !== lastChat) {
      lastChat = described
      log('CHAT ', described)
      shot += 1
      await page.screenshot({ path: path.join(ARTIFACTS, `${String(shot).padStart(3, '0')}.png`) }).catch(() => {})
    }

    if (page.isClosed()) break
    await sleep(900)
  }

  await writeFile(path.join(ARTIFACTS, 'timeline.log'), lines.join('\n'))
  log('end  ', `timeline → ${path.join(ARTIFACTS, 'timeline.log')}`)
  await browser.close()
}

main().catch((err) => {
  console.error(`OBSERVER ERROR: ${err.message}`)
  process.exit(1)
})
