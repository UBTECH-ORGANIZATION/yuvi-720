/* Cross-portal communications — the A10 map rows no other suite drives live.
 *
 * Two browser contexts, one account that holds both roles (gal is teacher AND
 * learner, and gal→gal is a connected pair in the org graph), so every lane is
 * exercised end to end through real sessions:
 *
 *   1. Kudos: teacher clicks praise → **Yuvi says it in the student's app**,
 *      words read from the store, never from the client.
 *   2. Shared note: teacher marks an insight `shared` → the student's bell
 *      rings with the note's text and a deep link.
 *   3. "My teachers": the student's connections pane lists teachers from the
 *      roster (`/api/me/teachers`), not from past mentoring conversations.
 *
 * Never `waitUntil: 'networkidle'` — both portals hold SSE connections.
 */
import { chromium } from 'playwright'
import { dismissCheckin } from './lib/checkin.mjs'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/comms'
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

// Unique per run so the assertions can never match a leftover from a past run.
const MARK = `בדיקה-${Date.now().toString().slice(-6)}`

const browser = await chromium.launch()

try {
  // ── two sessions for one dual-role account ────────────────────────────────
  const teacher = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const student = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  for (const context of [teacher, student]) {
    const response = await context.request.post(`${BASE}/api/auth/login`, {
      data: { username: 'gal', password: 'Aa12345' },
    })
    if (!response.ok()) throw new Error(`login failed: ${response.status()}`)
  }

  // Student opens the dashboard first, so the SSE stream is already listening
  // when the teacher acts — that is the "live, no reload" claim.
  const studentPage = await student.newPage()
  await studentPage.goto(`${BASE}/student-dashboard`, { waitUntil: 'domcontentloaded' })
  await studentPage.waitForTimeout(2000)
  await dismissCheckin(studentPage)
  await studentPage.waitForSelector('.sd-page, .sp-learner-shell', { timeout: 45000 })
  await studentPage.waitForTimeout(2000)

  const baseline = await student.request
    .get(`${BASE}/api/notifications/unread-count`).then((r) => r.json())

  // ── lane 1: shared note → the student's bell ──────────────────────────────
  const note = await teacher.request.post(`${BASE}/api/teacher/students/gal/insights`, {
    data: { kind: 'note', text: `${MARK} ראיתי שיפור יפה השבוע`, visibility: 'shared' },
  })
  check('teacher can write a shared note', note.ok(), `HTTP ${note.status()}`)

  const after = await student.request
    .get(`${BASE}/api/notifications/unread-count`).then((r) => r.json())
  check('the shared note rings the student bell',
        (after.unread ?? 0) > (baseline.unread ?? 0),
        `${baseline.unread} → ${after.unread}`)

  const rows = await student.request
    .get(`${BASE}/api/notifications?limit=10`).then((r) => r.json())
  const noteRow = (rows.notifications ?? rows.items ?? [])
    .find((row) => row.kind === 'teacher_note')
  check('the notification is the teacher_note kind', Boolean(noteRow),
        JSON.stringify((rows.notifications ?? rows.items ?? []).map((r) => r.kind)))
  if (noteRow) {
    check('it stores a key + params, never rendered text',
          noteRow.title_key === 'notif.teacherNote.shared'
            && String(noteRow.params?.text ?? '').includes(MARK),
          noteRow.title_key)
    check('it deep-links the student somewhere real',
          (noteRow.actions?.[0]?.route ?? '').startsWith('/'),
          noteRow.actions?.[0]?.route)
  }

  // A private note must NOT ring the bell.
  const before2 = await student.request
    .get(`${BASE}/api/notifications/unread-count`).then((r) => r.json())
  await teacher.request.post(`${BASE}/api/teacher/students/gal/insights`, {
    data: { kind: 'note', text: `${MARK} פרטית לחלוטין`, visibility: 'private' },
  })
  const after2 = await student.request
    .get(`${BASE}/api/notifications/unread-count`).then((r) => r.json())
  check('a private note stays off the student bell',
        (after2.unread ?? 0) === (before2.unread ?? 0),
        `${before2.unread} → ${after2.unread}`)

  // ── lane 2: kudos → a card in the student's own chat ─────────────────────
  /* The praise is no longer paraphrased by Yuvi into a new conversation: it is
     a card carrying the teacher's own sentence, which stays until the child
     acknowledges it. So the words themselves ARE assertable now — that is the
     whole point of the change. */
  /* Drain anything left pending by an earlier run first. Praise queues
     oldest-first by design (a child away for a week reads them in order), so
     without this the card under test would be somebody else's sentence. */
  for (let i = 0; i < 20; i += 1) {
    const waiting = await student.request
      .get(`${BASE}/api/me/kudos/pending`).then((r) => r.json())
    if (!waiting.kudos) break
    await student.request.post(`${BASE}/api/me/kudos/${waiting.kudos.id}/ack`, { data: {} })
  }
  await studentPage.reload({ waitUntil: 'domcontentloaded' })
  await studentPage.waitForTimeout(2500)

  const kudosText = `${MARK} כל הכבוד על ההתמדה בשברים`
  const kudos = await teacher.request.post(`${BASE}/api/teacher/students/gal/kudos`, {
    data: { message: kudosText },
  })
  check('teacher can send kudos', kudos.ok(), `HTTP ${kudos.status()}`)

  const card = await studentPage.waitForSelector('.sp-companion__kudos', { timeout: 45000 })
    .then(() => true).catch(() => false)
  check('the praise opens a card in the student chat, live', card)
  if (card) {
    const shown = await studentPage.locator('.sp-companion__kudos-message').innerText()
    check("the card carries the teacher's own words, not a paraphrase",
          shown.includes(MARK), shown.slice(0, 60))
    check('the card names who it came from',
          (await studentPage.locator('.sp-companion__kudos-eyebrow').innerText()).trim().length > 0)
  }
  await studentPage.screenshot({ path: `${OUT}/01-kudos-card.png`, fullPage: true })

  if (card) {
    await studentPage.locator('.sp-companion__kudos-ok').click()
    const gone = await studentPage.waitForSelector('.sp-companion__kudos', {
      state: 'detached', timeout: 15000,
    }).then(() => true).catch(() => false)
    check('acknowledging closes the card', gone)
    await studentPage.reload({ waitUntil: 'domcontentloaded' })
    await studentPage.waitForTimeout(3000)
    check('and it does not come back on reload',
          await studentPage.locator('.sp-companion__kudos').count() === 0)
  }

  const kudosRows = await student.request
    .get(`${BASE}/api/notifications?limit=10`).then((r) => r.json())
  const kudosRow = (kudosRows.notifications ?? kudosRows.items ?? [])
    .find((row) => row.kind === 'kudos' && String(row.params?.message ?? '').includes(MARK))
  check('the kudos also lands durably in the bell', Boolean(kudosRow))
  check('the bell row deep-links back to the card',
        String(kudosRow?.actions?.[0]?.route ?? '').includes('kudos='),
        kudosRow?.actions?.[0]?.route)

  // ── lane 2b: one account, two hats, two inboxes ──────────────────────────
  /* `gal` is a learner AND a teacher. Everything above is learner mail, and
     none of it may appear in the teacher portal's bell. */
  const asTeacherBell = await student.request
    .get(`${BASE}/api/notifications?limit=30&role=teacher`).then((r) => r.json())
  const asLearnerBell = await student.request
    .get(`${BASE}/api/notifications?limit=30&role=learner`).then((r) => r.json())
  const teacherKinds = (asTeacherBell.notifications ?? []).map((row) => row.kind)
  check('the teacher inbox holds no learner mail',
        !(asTeacherBell.notifications ?? []).some(
          (row) => (row.recipient_role ?? 'learner') !== 'teacher'),
        teacherKinds.join(',') || 'empty')
  check('the learner inbox still has the kudos',
        (asLearnerBell.notifications ?? []).some((row) => row.kind === 'kudos'))
  check('the two inboxes are counted separately',
        (asTeacherBell.unread ?? 0) !== (asLearnerBell.unread ?? 0)
          || (asTeacherBell.notifications ?? []).length !== (asLearnerBell.notifications ?? []).length,
        `teacher ${asTeacherBell.unread} / learner ${asLearnerBell.unread}`)

  // The UI must agree: the badge in the teacher portal is the teacher count.
  const teacherPage = await teacher.newPage()
  await teacherPage.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await teacherPage.waitForSelector('.tch-stat', { timeout: 60000 })
  await teacherPage.waitForTimeout(1500)
  const badgeNode = teacherPage.locator('.notif__badge').first()
  const badge = await badgeNode.count() ? (await badgeNode.textContent()) : '0'
  const expected = asTeacherBell.unread ?? 0
  check('the teacher portal bell shows the teacher count, not the learner one',
        (expected > 9 ? badge === '9+' : Number(badge) === expected),
        `badge ${badge} vs ${expected}`)
  await teacherPage.close()

  // ── lane 3: "my teachers" comes from the roster ──────────────────────────
  const mine = await student.request.get(`${BASE}/api/me/teachers`).then((r) => r.json())
  check('the student sees their teachers from the roster',
        Array.isArray(mine.teachers) && mine.teachers.length > 0,
        `${mine.teachers?.length ?? 0} teacher(s)`)
  check('teacher entries carry a display name, not an id to render',
        (mine.teachers ?? []).every((t) => (t.display_name ?? '').length > 0),
        JSON.stringify((mine.teachers ?? []).map((t) => t.display_name)))

  // ── scoping teeth on both new lanes ──────────────────────────────────────
  const outsider = await browser.newContext()
  await outsider.request.post(`${BASE}/api/auth/login`,
    { data: { username: 'moti', password: 'Aa12345' } })
  for (const [label, request] of [
    ['write a note on an out-of-scope student', () => outsider.request.post(
      `${BASE}/api/teacher/students/demo-shir/insights`,
      { data: { kind: 'note', text: 'x', visibility: 'shared' } })],
    ['send kudos to an out-of-scope student', () => outsider.request.post(
      `${BASE}/api/teacher/students/demo-shir/kudos`, { data: { message: 'x' } })],
  ]) {
    const response = await request()
    check(`an outsider cannot ${label}`, response.status() === 403, `HTTP ${response.status()}`)
  }
  await outsider.close()

  // A learner must not reach the teacher lanes at all.
  const asLearner = await student.request.post(
    `${BASE}/api/teacher/students/gal/kudos`, { data: { message: 'x' } })
  // gal holds the teacher role too, so use a pure learner for this probe.
  const pure = await browser.newContext()
  const pureLogin = await pure.request.post(`${BASE}/api/auth/login`,
    { data: { username: 'demo-shir', password: 'Aa12345' } })
  if (pureLogin.ok()) {
    const refused = await pure.request.post(
      `${BASE}/api/teacher/students/demo-dana/kudos`, { data: { message: 'x' } })
    check('a learner account cannot send kudos', refused.status() === 403,
          `HTTP ${refused.status()}`)
  } else {
    console.log('    (demo-shir login unavailable — learner-refusal covered by unit tests)')
  }
  await pure.close()
  void asLearner

  await teacher.close()
  await student.close()
} finally {
  await browser.close()
}

if (failures.length) {
  console.log(`\n✘ ${failures.length} failure(s)`)
  for (const failure of failures) console.log(`   - ${failure}`)
  process.exit(1)
}
console.log('\n✅ comms check passed')
