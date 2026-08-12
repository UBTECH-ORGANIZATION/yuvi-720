/**
 * WCAG 2.1 AA audit of the live English environment, using axe-core injected
 * from the CDN (the repo has Playwright but no axe dependency).
 *
 * Produces the evidence behind the accessibility declaration — we do not claim
 * conformance we have not measured.
 *
 *   node scripts/audit-a11y.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'https://ubi-yuvi-720-english.azurewebsites.net';
const USER = process.env.A11Y_USER || 'moe-1-student';
const TEACHER = process.env.A11Y_TEACHER || 'moe-1-teacher';
const PASS = process.env.A11Y_PASS;
const AXE = 'https://unpkg.com/axe-core@4.10.2/axe.min.js';

if (!PASS) {
  console.error('set A11Y_PASS');
  process.exit(2);
}

const PAGES = [
  { name: 'כניסה למערכת', path: '/', role: 'anon' },
  { name: 'שאלון מיפוי', path: '/learner-mapping', role: 'student' },
  { name: 'פורטל הלמידה', path: '/learning', role: 'student' },
  { name: 'דשבורד תלמיד', path: '/student-dashboard', role: 'student' },
  { name: 'שיעור אנגלית', path: '/learning/lesson?unit=ENG.G7.FAMILY.LISTEN&component=ENG.G7.FAMILY.LISTEN-01', role: 'student' },
  { name: 'תצוגת מורה', path: '/teacher', role: 'teacher' },
  { name: 'רשימת תלמידים', path: '/teacher/students', role: 'teacher' },
];

async function login(page, role) {
  const user = role === 'teacher' ? TEACHER : USER;
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const selector = `.landing720-login-btn.${role}`;
  await page.waitForSelector(selector, { timeout: 20000 });
  await (await page.$(selector)).dispatchEvent('click');
  await page.waitForSelector('input[type=password]', { timeout: 20000 });
  const fields = await page.$$('input:not([type=hidden])');
  await fields[0].fill(user);
  await page.fill('input[type=password]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
}

async function audit(page, label) {
  await page.addScriptTag({ url: AXE });
  await page.waitForFunction(() => !!window.axe, null, { timeout: 20000 });
  const result = await page.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return r.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
      sample: v.nodes.slice(0, 2).map((n) => n.html.slice(0, 110)),
    }));
  });
  console.log(`\n=== ${label} ===`);
  if (!result.length) {
    console.log('  ✅ no WCAG 2.1 AA violations detected');
    return { label, violations: [] };
  }
  for (const v of result) {
    console.log(`  ✗ [${v.impact}] ${v.id} — ${v.help} (${v.nodes} elements)`);
    for (const s of v.sample) console.log(`      ${s}`);
  }
  return { label, violations: result };
}

const browser = await chromium.launch();
const context = await browser.newContext({ locale: 'he-IL' });
const page = await context.newPage();
const report = [];

let signedInAs = 'anon';
for (const spec of PAGES) {
  if (spec.role !== 'anon' && signedInAs !== spec.role) {
    await context.clearCookies();
    await login(page, spec.role);
    signedInAs = spec.role;
  }
  await page.goto(BASE + spec.path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  report.push(await audit(page, `${spec.name}  (${spec.path})`));
}

// Structural checks the automated rules don't cover but the MoE guidance names.
await page.goto(BASE + '/learning', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const structural = await page.evaluate(() => ({
  htmlLang: document.documentElement.lang,
  htmlDir: document.documentElement.dir,
  title: document.title,
  h1: document.querySelectorAll('h1').length,
  skipLink: !!document.querySelector('a[href^="#"][class*=skip], .skip-link'),
  landmarks: {
    main: document.querySelectorAll('main, [role=main]').length,
    nav: document.querySelectorAll('nav, [role=navigation]').length,
  },
  imagesWithoutAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
  ariaLive: document.querySelectorAll('[aria-live]').length,
}));
console.log('\n=== מבנה עמוד ===');
console.log(structural);

const total = report.reduce((n, r) => n + r.violations.length, 0);
console.log(`\nסה"כ סוגי ליקויים: ${total}`);

await browser.close();
