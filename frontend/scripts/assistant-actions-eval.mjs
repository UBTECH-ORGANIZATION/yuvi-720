/* Teaching-assistant ACTION eval — live model, hard assertions on the offers.
 *
 * `assistant-eval.mjs` asks whether the answer is grounded. This asks whether
 * the *buttons* are right, which is a different failure surface and the one a
 * teacher photographed:
 *
 *   1. `[navigate_button: תלמידים לא פעילים]` typed into the prose. No such
 *      syntax exists in this repo. Every case below asserts the answer carries
 *      no pseudo-widget — this is the assertion that must keep failing if the
 *      prompt regresses, which is why the client-side strip is NOT applied here.
 *
 *   2. Asked about "the inactive students", the assistant drafted a goal for
 *      one arbitrary child. A described set must be resolved with a tool and
 *      then drafted for whole, or clarified with one question — never guessed.
 *
 * Nothing here writes. Action tools produce offers; a write needs a human to
 * press the button in the browser. Safe to run against any class.
 *
 * Run:  node scripts/assistant-actions-eval.mjs   (backend on :8720, LLM live)
 */

import { request } from 'playwright'

const BASE = process.env.BASE_URL?.replace(':5199', ':8720') || 'http://localhost:8720'

let passed = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { failures.push(name); console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const api = await request.newContext({ baseURL: BASE })
const login = await api.post('/api/auth/login', { data: { username: 'gal', password: 'Aa12345' } })
if (!login.ok()) throw new Error(`login failed: ${login.status()}`)

const groups = (await (await api.get('/api/groups')).json()).groups
const group = groups.find((row) => row.id === 'demo-group-a') ?? groups[0]
const snapshot = await (await api.get(
  `/api/teacher/groups/${group.id}/snapshot?language=he`)).json()

const students = snapshot.students ?? []
const someStudent = (snapshot.attention?.[0]?.learner_id) ?? students[0]?.learner_id

/* Ground truth for the described sets, computed the way the TOOL computes it.
 *
 * Across every group this teacher owns, not just the one on screen: asked
 * "which students have not started", `list_students` resolves over the whole
 * roster unless a group is named. Measuring one class here made a correct
 * cross-class draft look like an invented one. */
const INACTIVE_DAYS = 7
const everyStudent = []
for (const row of groups) {
  const snap = await (await api.get(
    `/api/teacher/groups/${row.id}/snapshot?language=he`)).json()
  everyStudent.push(...(snap.students ?? []))
}
const byId = new Map(everyStudent.map((row) => [row.learner_id, row]))
const trulyInactive = [...byId.values()]
  .filter((row) => (row.activity?.days_inactive ?? -1) >= INACTIVE_DAYS)
  .map((row) => row.learner_id)
const trulyNotStarted = [...byId.values()]
  .filter((row) => row.status === 'not_started').map((row) => row.learner_id)

console.log(`eval group: ${group.id} · ${students.length} students · ` +
  `${trulyInactive.length} inactive ${INACTIVE_DAYS}d+ · ${trulyNotStarted.length} not started`)

const screen = { route: '/teacher', screen: 'home', group_id: group.id, subject: null }

async function ask(message) {
  const response = await api.post('/api/teacher/assistant', {
    data: { message, language: 'he', screen, history: [] },
    timeout: 120000,
  })
  if (!response.ok()) return { text: `http_${response.status()}`, actions: [], tools: [] }
  return response.json()
}

const toolNames = (answer) => (answer.tools ?? []).map((tool) => tool.name)
const kinds = (answer) => (answer.actions ?? []).map((action) => action.kind)
const offerOf = (answer, kind) => (answer.actions ?? []).find((a) => a.kind === kind)

/** The syntax the model invented. Matched here deliberately unstripped. */
const PSEUDO = /\[\[?\s*(?:\w*_?(?:button|action)|כפתור|פעולה)\s*[:：]/i
/** A question, in any of the three languages the teacher may be reading. */
const ASKS = (text) => /\?|؟/.test(text ?? '')

const transcript = []
async function scenario(name, message, assertions) {
  const answer = await ask(message)
  transcript.push({ name, message, text: answer.text, kinds: kinds(answer) })
  // Universal, every case: the model never draws its own button.
  check(`${name}: no pseudo-widget in prose`, !PSEUDO.test(answer.text ?? ''),
        (answer.text ?? '').slice(0, 160))
  await assertions(answer)
}

// ── 1 · a described set: resolve it, or ask — never draft for one of them ────
await scenario('described-set', 'תכין יעד לתלמידים שלא נכנסו לאחרונה', (answer) => {
  const goal = offerOf(answer, 'draft_goal')
  if (!goal) {
    // Clarifying instead of drafting is a correct outcome, not a failure.
    check('described-set: asked instead of guessing', ASKS(answer.text),
          (answer.text ?? '').slice(0, 160))
    return
  }
  const drafted = [...(goal.learner_ids ?? [])].sort()
  check('described-set: resolved the set with a tool',
        toolNames(answer).includes('list_students')
        || toolNames(answer).includes('get_group_snapshot'),
        JSON.stringify(toolNames(answer)))
  // The bug: one arbitrary child out of several. Whatever set it chose, it
  // must not be a proper subset of the real one.
  check('described-set: did not draft for a subset of the described set',
        drafted.length !== 1 || trulyInactive.length <= 1,
        `drafted ${drafted.length} of ${trulyInactive.length} inactive`)
})

// ── 2 · the same question, phrased as a request for a list ──────────────────
await scenario('who-is-inactive', 'מי לא נכנס בשבוע האחרון?', (answer) => {
  check('who-is-inactive: did not claim it cannot find them',
        !/אין לי (דרך|אפשרות)|לא יכול לדעת|אין באפשרותי/.test(answer.text ?? ''),
        (answer.text ?? '').slice(0, 160))
  check('who-is-inactive: consulted a roster tool',
        toolNames(answer).some((name) =>
          ['list_students', 'get_group_snapshot'].includes(name)),
        JSON.stringify(toolNames(answer)))
})

// ── 3 · a named child: exactly that child ───────────────────────────────────
await scenario('named-child',
  `תכין יעד ל{{student:${someStudent}}} בנושא שברים`, (answer) => {
    const goal = offerOf(answer, 'draft_goal')
    check('named-child: offered a goal', Boolean(goal), JSON.stringify(kinds(answer)))
    if (goal) {
      check('named-child: aimed at exactly that child',
            JSON.stringify(goal.learner_ids) === JSON.stringify([someStudent]),
            JSON.stringify(goal.learner_ids))
      check('named-child: the offer carries a title or reports it missing',
            Boolean(goal.title) || (goal.missing ?? []).includes('title'),
            JSON.stringify({ title: goal.title, missing: goal.missing }))
    }
  })

// ── 4 · navigate, with a filter that has to survive to the route ────────────
await scenario('navigate-filtered', 'תפתח לי את רשימת התלמידים שדורשים תשומת לב', (answer) => {
  const nav = offerOf(answer, 'navigate')
  check('navigate-filtered: offered a navigate button', Boolean(nav),
        JSON.stringify(kinds(answer)))
  if (nav) {
    check('navigate-filtered: route is in the teacher lane',
          /^\/teacher\//.test(nav.route ?? ''), nav.route)
  }
  check('navigate-filtered: did not also spell the route out in prose',
        !/\/teacher\//.test(answer.text ?? ''), (answer.text ?? '').slice(0, 160))
})

// ── 5 · a good word ─────────────────────────────────────────────────────────
await scenario('kudos',
  `תשלח מילה טובה ל{{student:${someStudent}}} על ההתמדה שלו`, (answer) => {
    const kudos = offerOf(answer, 'draft_kudos')
    check('kudos: offered', Boolean(kudos), JSON.stringify(kinds(answer)))
    if (kudos) {
      check('kudos: aimed at that child', kudos.learner_id === someStudent, kudos.learner_id)
      check('kudos: has a message or reports it missing',
            Boolean(kudos.message) || (kudos.missing ?? []).includes('message'),
            JSON.stringify(kudos.missing))
    }
  })

// ── 6 · approvals ───────────────────────────────────────────────────────────
await scenario('approvals', 'יש יעדים שמחכים לאישור שלי?', (answer) => {
  const offer = offerOf(answer, 'approve_goals')
  // Either a real offer, or an honest "nothing waiting" — never a claim with
  // no card behind it.
  check('approvals: an offer or an honest empty',
        Boolean(offer) || /אין|לא ממתינ|כלום|ריק/.test(answer.text ?? ''),
        (answer.text ?? '').slice(0, 160))
})

// ── 7 · a question with no action at all ────────────────────────────────────
await scenario('no-action', 'מה זה בעצם "דורש תשומת לב"? איך זה מחושב?', (answer) => {
  check('no-action: did not manufacture a draft',
        !kinds(answer).some((kind) => kind.startsWith('draft_')),
        JSON.stringify(kinds(answer)))
  check('no-action: answered the question', (answer.text ?? '').length > 20,
        (answer.text ?? '').slice(0, 120))
})

// ── 8 · genuinely ambiguous: ping-pong, not a draft ─────────────────────────
await scenario('ambiguous', 'תכין יעד לכמה מהתלמידים החלשים', (answer) => {
  const goal = offerOf(answer, 'draft_goal')
  check('ambiguous: asked rather than picking children itself',
        !goal || (goal.missing ?? []).includes('learners') || ASKS(answer.text),
        JSON.stringify({ kinds: kinds(answer), text: (answer.text ?? '').slice(0, 120) }))
})

// ── 9 · a set that is empty is said, not substituted ────────────────────────
await scenario('empty-set', 'תכין יעד לתלמידים שטרם התחילו', (answer) => {
  const goal = offerOf(answer, 'draft_goal')
  if (!trulyNotStarted.length) {
    check('empty-set: no goal drafted for an empty set', !goal,
          JSON.stringify(goal?.learner_ids ?? []))
  } else if (goal) {
    const drafted = new Set(goal.learner_ids ?? [])
    const strays = [...drafted].filter((id) => !trulyNotStarted.includes(id))
    check('empty-set: every drafted child is actually in the set',
          strays.length === 0, `strays: ${JSON.stringify(strays)}`)
  } else {
    check('empty-set: asked instead of guessing', ASKS(answer.text),
          (answer.text ?? '').slice(0, 160))
  }
})

// ── 10 · a note about a named child ─────────────────────────────────────────
await scenario('note',
  `תרשום לי הערה על {{student:${someStudent}}} שהוא צריך חיזוק בשברים`, (answer) => {
    const note = offerOf(answer, 'draft_note')
    check('note: offered', Boolean(note), JSON.stringify(kinds(answer)))
    if (note) {
      check('note: aimed at that child', note.learner_id === someStudent, note.learner_id)
      check('note: carries text or reports it missing',
            Boolean(note.text) || (note.missing ?? []).includes('text'),
            JSON.stringify(note.missing))
    }
  })

await api.dispose()

console.log('')
if (failures.length) {
  console.log(`✘ ${failures.length} failure(s) / ${passed} passed`)
  for (const name of failures) console.log(`   - ${name}`)
  console.log('\ntranscript:')
  for (const row of transcript) {
    console.log(`  [${row.name}] ${row.kinds.join(',') || '(no actions)'}`)
    console.log(`      ${(row.text ?? '').slice(0, 200).replace(/\n/g, ' ')}`)
  }
  process.exit(1)
}
console.log(`✅ assistant action eval passed (${passed} checks)`)
