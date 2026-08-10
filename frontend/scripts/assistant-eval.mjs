/* Teaching-assistant grounding eval — live model, real data, hard assertions.
 *
 * Not a browser check: it interrogates POST /api/teacher/assistant directly and
 * compares the answers against the same numbers the dashboard endpoints return.
 * The contract under test is the anti-hallucination one:
 *
 *   - count questions come back grounded, with the right tool in the trace,
 *     and the number in the answer IS the number in the data;
 *   - per-student questions use student tools;
 *   - questions about students who do not exist are refused, not invented.
 *
 * Run:  node scripts/assistant-eval.mjs        (backend on :8720, LLM creds live)
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

/* Ground truth — the demo class, which has real seeded activity. */
const groups = (await (await api.get('/api/groups')).json()).groups
const group = groups.find((row) => row.id === 'demo-group-a') ?? groups[0]
const snapshot = await (await api.get(
  `/api/teacher/groups/${group.id}/snapshot?language=he`)).json()
const engagement = await (await api.get(
  `/api/teacher/groups/${group.id}/engagement`)).json()
const studentsTotal = snapshot.trends.students_total
const needing = snapshot.trends.needing_attention
const someStudent = (snapshot.attention?.[0]?.learner_id)
  ?? snapshot.students[0].learner_id

console.log(`eval group: ${group.id} · ${studentsTotal} students · ` +
  `${needing} needing attention · avg minutes ${engagement.avg_active_minutes}`)

const screen = { route: '/teacher', screen: 'home', group_id: group.id, subject: null }

async function ask(message) {
  const response = await api.post('/api/teacher/assistant', {
    data: { message, language: 'he', screen, history: [] },
    timeout: 120000,
  })
  if (!response.ok()) return { text: null, text_key: 'http_' + response.status(), tools: [], grounded: false }
  return response.json()
}

const toolNames = (answer) => (answer.tools ?? []).map((tool) => tool.name)
const usedAny = (answer, names) => toolNames(answer).some((name) => names.includes(name))
const numbersIn = (text) => [...(text ?? '').matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))

// ── 1 · how many students ───────────────────────────────────────────────────
{
  const answer = await ask('כמה תלמידים יש בכיתה שלי?')
  check('count: answer is grounded', answer.grounded === true, JSON.stringify(toolNames(answer)))
  check('count: used a group tool',
        usedAny(answer, ['get_group_snapshot', 'list_students', 'get_group_engagement']))
  check('count: states the true number',
        (answer.text ?? '').includes(String(studentsTotal)),
        `expected ${studentsTotal} in: ${(answer.text ?? answer.text_key ?? '').slice(0, 120)}`)
}

// ── 2 · average learning minutes ────────────────────────────────────────────
{
  const answer = await ask('כמה דקות למידה בממוצע היו לתלמיד בשבוע האחרון?')
  check('minutes: used the engagement tool', usedAny(answer, ['get_group_engagement']),
        JSON.stringify(toolNames(answer)))
  if (engagement.timing_available && engagement.avg_active_minutes !== null) {
    const target = engagement.avg_active_minutes
    const close = numbersIn(answer.text).some((n) => Math.abs(n - target) <= 1)
    check('minutes: quotes the computed figure, not an invented one', close,
          `expected ~${target} in: ${(answer.text ?? '').slice(0, 120)}`)
  } else {
    check('minutes: admits missing timing rather than inventing a number',
          !answer.text || !numbersIn(answer.text).length || answer.text_key !== null,
          (answer.text ?? answer.text_key ?? '').slice(0, 120))
  }
}

// ── 3 · what should this student work on ────────────────────────────────────
{
  const answer = await ask(`על מה כדאי שהתלמיד {{student:${someStudent}}} יעבוד? מה הקשיים שלו?`)
  check('student-needs: grounded', answer.grounded === true, JSON.stringify(toolNames(answer)))
  check('student-needs: used a per-student tool',
        toolNames(answer).some((name) => name.startsWith('get_student_')))
  check('student-needs: no display name leaked into the model text',
        !(answer.text ?? '').includes('Shir') || someStudent === 'Shir',
        'names must arrive via {{student:id}} resolution only')
}

// ── 4 · goals ───────────────────────────────────────────────────────────────
{
  const answer = await ask(`אילו יעדים יש לתלמיד {{student:${someStudent}}}?`)
  check('goals: used the goals tool', usedAny(answer, ['get_student_goals']),
        JSON.stringify(toolNames(answer)))
  check('goals: grounded or an honest empty', answer.grounded === true || answer.text_key !== null)
}

// ── 5 · a student who does not exist ────────────────────────────────────────
{
  const answer = await ask('מה שלום יוסי כהן מכיתה ח׳2? באילו נושאים הוא מתקשה?')
  const text = answer.text ?? ''
  const refused = answer.text_key !== null
    || /אין|לא נמצא|לא קיים|לא מזוה|אין לי|לא מופיע/.test(text)
  check('unknown student: refused, not invented', refused, text.slice(0, 140))
  check('unknown student: no fabricated percentage', !/\d+\s*%/.test(text), text.slice(0, 140))
}

// ── 6 · needing-attention count consistency ─────────────────────────────────
{
  const answer = await ask('כמה תלמידים בכיתה דורשים תשומת לב כרגע?')
  check('attention-count: grounded', answer.grounded === true, JSON.stringify(toolNames(answer)))
  const stated = numbersIn(answer.text)
  check('attention-count: any number stated matches the data',
        !stated.length || stated.includes(needing) || stated.includes(studentsTotal),
        `data says ${needing} (of ${studentsTotal}); answer: ${(answer.text ?? '').slice(0, 140)}`)
}

await api.dispose()

console.log('')
if (failures.length) {
  console.log(`✘ ${failures.length} failure(s) / ${passed} passed`)
  for (const name of failures) console.log(`   - ${name}`)
  process.exit(1)
}
console.log(`✅ assistant grounding eval passed (${passed} checks)`)
