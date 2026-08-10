import { chromium } from 'playwright'

/** Does English behave like a subject in the learner-facing app?
 *  Signs in as a seeded learner and looks at the portal, a lesson launch and the
 *  dashboard — the three places a ministry reviewer will actually look. */

const BASE = process.env.APP || 'http://localhost:5174'
const out = []
const ok = (l, p, d = '') => { out.push(`${p ? 'PASS' : 'FAIL'}  ${l}${d ? ` — ${d}` : ''}`); return p }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1360, height: 950 } })
page.on('pageerror', (e) => out.push(`PAGE ERROR: ${e.message}`))

// ── sign in ──
await page.goto(`${BASE}/`, { waitUntil: 'load' })
await page.waitForTimeout(2500)
// The landing page keeps the sign-in card behind a CTA, and its buttons never
// go "stable" (constant animation), so the click has to be dispatched.
if ((await page.locator('#auth-username').count()) === 0) {
  await page.locator('.landing720-login-btn').first().dispatchEvent('click').catch(() => {})
  await page.waitForTimeout(1500)
}
await page.locator('#auth-username').waitFor({ timeout: 20000 })
await page.locator('#auth-username').fill('gal')
await page.locator('input[type=password]').first().fill('Aa12345')
await page.locator('input[type=password]').first().press('Enter')
await page.waitForTimeout(8000)
ok('signed in', !page.url().endsWith('/'), page.url().replace(BASE, ''))

// ── the learning portal lists English beside math and science ──
await page.goto(`${BASE}/learning`, { waitUntil: 'load' })
await page.waitForTimeout(5000)
const portal = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
ok('portal shows the English subject', /אנגלית/.test(portal))
ok('portal still shows the ministry subjects', /מתמטיקה|מדע/.test(portal))
ok('portal offers no untranslated keys', !/learning\.[a-z]+\.[a-z]/i.test(portal),
  (portal.match(/learning\.[a-z.]+/i) || [''])[0])

// The world shows ONE subject at a time; English lives behind its own tab.
const englishTab = page.locator('.learning-world-subjects button', { hasText: 'אנגלית' })
ok('there is an English tab in the world', (await englishTab.count()) === 1)
if (await englishTab.count()) {
  await englishTab.first().dispatchEvent('click')
  await page.waitForTimeout(4000)
  const journey = page.locator('.learning-world-journey-open, [class*="journey"] button').first()
  if (await journey.count()) { await journey.dispatchEvent('click').catch(() => {}); await page.waitForTimeout(1500) }
  const english = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  ok('the world is named for English', /נמל השפות/.test(english))
  const areas = ['הבנת הנשמע', 'הבנת הנקרא', 'הבעה בעל פה', 'כתיבה', 'אוצר מילים', 'דקדוק', 'צלילים וכתיב', 'הודעות', 'אומרים את זה נכון', 'מוסרים את המידע']
  const missing = areas.filter((a) => !english.includes(a))
  ok('the Modern Family unit is offered', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '10/10 areas')
  await page.screenshot({ path: '/tmp/app-portal.png', fullPage: false })

}

// ── the lesson chrome opens OUR player for an English component ──
// The world's "walk to the station" animation needs a real GPU to finish, so the
// harness enters the lesson by its route — the same one the walk navigates to.
await page.goto(`${BASE}/learning/lesson?unit=ENG.G7.FAMILY.LISTEN&component=ENG.G7.FAMILY.LISTEN-01`, { waitUntil: 'load' })
await page.waitForTimeout(12000)
{
  const frame = page.locator('iframe').first()
  const src = await frame.getAttribute('src').catch(() => '')
  ok('the lesson launches our own player', /\/content\/player\//.test(src || ''), (src || 'no iframe').slice(0, 60))
  ok('the player is same-origin (no tunnel needed)', (src || '').startsWith('/content/'), (src || '').slice(0, 30))
  const inner = page.frameLocator('iframe').first()
  const text = (await inner.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')
  ok('the lomda renders inside the lesson', text.length > 40, text.slice(0, 90))
  // The chrome around English content still speaks the learner's language.
  ok('the lesson chrome is in Hebrew', /הבנת הנשמע/.test(text) &&
    /הבנת הנשמע/.test((await page.locator('body').innerText()).replace(/\s+/g, ' ')),
    text.slice(0, 45))
  await page.screenshot({ path: '/tmp/app-lesson.png' })
}

// ── the dashboard counts English as a subject ──
await page.goto(`${BASE}/student-dashboard`, { waitUntil: 'load' })
await page.waitForTimeout(6000)
const dash = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
ok('dashboard renders', dash.length > 200, `${dash.length} chars`)
ok('dashboard mentions English', /אנגלית|English/.test(dash))
await page.screenshot({ path: '/tmp/app-dashboard.png' })

// ── the companion offers spoken practice ──
// The dock opens from its portal, but a click on the robot itself is ignored
// (that gesture belongs to the avatar), so aim at the base plate.
const dock = page.locator('.Yuvi-companion-dock__base').first()
if (await dock.count()) {
  await dock.dispatchEvent('click')
  await page.waitForTimeout(3000)
}
const micCount = await page.locator('.sp-companion__voice-btn').count()
ok('the companion offers a voice button', micCount === 1, `${micCount} found`)
if (micCount === 1) {
  await page.locator('.sp-companion__voice-btn').dispatchEvent('click')
  await page.waitForTimeout(1200)
  ok('the voice panel opens', (await page.locator('.vcall').count()) === 1,
    (await page.locator('.vcall__title').innerText().catch(() => '')))
  await page.screenshot({ path: '/tmp/app-voice.png' })
}



// ── the teacher sees English as a subject they can act on ──
await page.context().clearCookies()
await page.goto(`${BASE}/`, { waitUntil: 'load' })
await page.waitForTimeout(2500)
if ((await page.locator('#auth-username').count()) === 0) {
  await page.locator('.landing720-login-btn').last().dispatchEvent('click').catch(() => {})
  await page.waitForTimeout(1500)
}
await page.locator('#auth-username').fill('moti')
await page.locator('input[type=password]').first().fill('Aa12345')
await page.locator('input[type=password]').first().press('Enter')
await page.waitForTimeout(9000)
const teacher = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
ok('the teacher view opens', !/התחברות/.test(teacher), new URL(page.url()).pathname)

// The overview is evidence-driven and this class has no learners yet, so the
// place English has to show up is the content tab — how the material performed.
const lessonsTab = page.locator('nav button, nav a, header button, header a').filter({ hasText: 'למידות' }).first()
if (await lessonsTab.count()) {
  await lessonsTab.dispatchEvent('click')
  await page.waitForTimeout(7000)
  const lessons = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  ok('the teacher can filter their class content by English', /אנגלית/.test(lessons),
    (lessons.match(/כל המקצועות.{0,40}/) || [''])[0])
  const englishFilter = page.locator('button').filter({ hasText: /^אנגלית$/ }).first()
  if (await englishFilter.count()) {
    await englishFilter.dispatchEvent('click')
    await page.waitForTimeout(4000)
    const only = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    ok('filtering to English shows our authored lomdot', /הבנת הנשמע|אוצר מילים|דקדוק/.test(only) && !/מסה ונפח/.test(only),
      (only.match(/\d+\/\d+ למידות/) || [''])[0])
  }
} else {
  ok('the teacher can filter their class content by English', false, 'no content tab')
}
await page.screenshot({ path: '/tmp/app-teacher.png', fullPage: true })

console.log(out.join('\n'))
console.log(out.some((l) => l.startsWith('FAIL') || l.startsWith('PAGE')) ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED')
await browser.close()
