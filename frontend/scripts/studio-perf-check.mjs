/* Yuvi Studio under a software GPU — the worst school PC, on a laptop.
 *
 *   cd frontend && node scripts/studio-perf-check.mjs [--port 5173] [--headed]
 *
 * Needs the local stack (see .claude/skills/verify/SKILL.md): the backend on
 * :8720 and Vite on the given port, with the seeded `gal` account.
 *
 * Chromium is started on SwiftShader (ANGLE's CPU rasteriser), so whatever the
 * machine running this has, the page sees a GPU string the tier probe must
 * call `low`. Asserts what the tiering promised and a screenshot cannot: the
 * probe picks low, the first frame lands inside the budget, the perf HUD shows
 * the shadow map off and the light budget honoured. Nothing here is
 * pixel-sensitive, so it is safe to run on any machine.
 */

import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '5173'
const base = `http://localhost:${port}`
const shots = 'scripts/.studio-perf-shots'
await mkdir(shots, { recursive: true })

// SwiftShader is slow by design; the budget is generous so the check measures
// "did the tiering engage", not the CI box's CPU.
const FIRST_FRAME_BUDGET_MS = 20_000
const MAX_LIGHTS_ON_LOW = 6

const browser = await chromium.launch({
  headless: !args.includes('--headed'),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
// A tier that only exists on weak GPUs is exactly where an uncaught path hides
// (a Standard material has no `sheenColor`). Surface crashes, do not time out on them.
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)))

const fail = []
const ok = (label) => console.log(`  ✔ ${label}`)
const bad = (label) => { fail.push(label); console.log(`  ✖ ${label}`) }

// ── sign in ────────────────────────────────────────────────────────────────
await page.goto(`${base}/`, { waitUntil: 'load' })
await page.waitForTimeout(1000)
await page.evaluate(async () => {
  await fetch('/api/auth/login', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gal', password: 'Aa12345' }),
  })
})

// ── open the studio with the HUD on ────────────────────────────────────────
const openedAt = Date.now()
await page.goto(`${base}/yuvi-studio?perf=1`, { waitUntil: 'load' })
const stage = page.locator('.ys-stage .Yuvi-avatar-canvas')
try {
  await stage.waitFor({ timeout: 60_000 })
  ok('studio stage mounted')
} catch {
  bad('studio stage mounted')
}

let firstFrameMs = null
try {
  await page.waitForSelector('.ys-stage .Yuvi-avatar-canvas[data-first-frame="1"]', { timeout: FIRST_FRAME_BUDGET_MS + 30_000 })
  firstFrameMs = Date.now() - openedAt
  if (firstFrameMs <= FIRST_FRAME_BUDGET_MS) ok(`first frame rendered in ${firstFrameMs} ms (budget ${FIRST_FRAME_BUDGET_MS})`)
  else bad(`first frame rendered in ${firstFrameMs} ms (budget ${FIRST_FRAME_BUDGET_MS})`)
} catch {
  bad('first frame rendered')
}

const gpu = await page.evaluate(() => {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  const info = gl?.getExtension('WEBGL_debug_renderer_info')
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER)
})
console.log(`  · gpu: ${gpu}`)
if (/swiftshader/i.test(String(gpu))) ok('running on SwiftShader')
else bad(`running on SwiftShader (got "${gpu}")`)

const tier = await stage.getAttribute('data-render-tier')
if (tier === 'low') ok('tier detected as low')
else bad(`tier detected as low (got "${tier}")`)

// ── the HUD says what the low tier promised ────────────────────────────────
await page.waitForTimeout(2500)   // one HUD refresh past the first frame
const hud = await page.locator('.Yuvi-avatar-hud').innerText().catch(() => '')
console.log(hud.split('\n').map((line) => `  · ${line}`).join('\n'))
if (/shadow off/.test(hud)) ok('shadow map is off')
else bad('shadow map is off')
const lights = Number(/lights (\d+)/.exec(hud)?.[1] ?? NaN)
if (lights <= MAX_LIGHTS_ON_LOW) ok(`light budget honoured (${lights} ≤ ${MAX_LIGHTS_ON_LOW})`)
else bad(`light budget honoured (${lights} > ${MAX_LIGHTS_ON_LOW})`)
const dpr = Number(/dpr ([\d.]+)/.exec(hud)?.[1] ?? NaN)
if (dpr <= 1) ok(`pixel ratio capped at 1 (${dpr})`)
else bad(`pixel ratio capped at 1 (${dpr})`)

// The toggle exists and cycles.
const toggle = page.locator('.ys-stage-tools [data-quality]')
if (await toggle.count()) {
  const before = await toggle.getAttribute('data-quality')
  await toggle.click()
  await page.waitForTimeout(300)
  const after = await toggle.getAttribute('data-quality')
  if (before !== after) ok(`quality toggle cycles (${before} → ${after})`)
  else bad('quality toggle cycles')
  // Back to auto so the next run starts clean.
  await page.evaluate(() => { try { localStorage.removeItem('spark.renderTier.forced') } catch {} })
} else bad('quality toggle is in the toolbar')

if (pageErrors.length) bad(`no uncaught errors (${pageErrors.length}): ${pageErrors[0]}`)
else ok('no uncaught errors')

await page.screenshot({ path: `${shots}/studio-low.png` })
await browser.close()
console.log(fail.length ? `\n❌ ${fail.length} check(s) failed` : '\n✅ all checks passed')
process.exit(fail.length ? 1 : 0)
