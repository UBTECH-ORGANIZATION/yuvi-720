import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { yuviPosition } from '../src/features/roadmap/roadmapModel.ts'

const origin = process.env.ROADMAP_CHECK_URL ?? 'http://127.0.0.1:5173'
const status = {
  level: 5, totalXp: 650, currentLevelXp: 100, xpToNext: 200, nextLevel: 6,
  nextLevelTotalXp: 750, progress: 0.5, rulesVersion: 1, extraHintTokens: 0, claimedLevelRewards: [],
}
const levels = Array.from({ length: 50 }, (_, index) => ({
  level: index + 1, startXp: index * 200, xpToNext: 200,
  reward: { level: index + 1, sparks: index === 4 ? 40 : 0, extraHintTokens: 0, avatarUnlocks: [], roomUnlocks: [] },
}))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  const requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => { if (request.url().includes('/api/')) requests.push(request.url()) })
  await page.addInitScript(() => {
    window.__THREE_DEVTOOLS__ = new EventTarget()
    window.__roadmapObjects = []
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      window.__roadmapObjects.push(event.detail)
      if (event.detail.isWebGLRenderer) {
        const renderer = event.detail
        const render = renderer.render
        renderer.render = function (...args) {
          window.__roadmapCamera = args[1]
          return render.apply(this, args)
        }
      }
    })
  })
  let language = 'en'
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/auth/me') body = {
      authenticated: true,
      user: { user_id: 'roadmap-check', username: 'roadmap-check', display_name: 'Map Check', roles: ['learner'],
        preferences: { language, theme: 'dark', tours_completed: ['learner'] } },
    }
    else if (path === '/api/learner-state') body = { mapping_progress: { completed: true }, profile_summary_progress: { completed: true }, language }
    else if (path === '/api/progression/roadmap') body = { levels, progression: status, maxLevel: 50, rulesVersion: 1 }
    else if (path === '/api/progression/status') body = status
    else if (path === '/api/progression/ledger') body = { entries: [], progression: status }
    else if (path.startsWith('/api/brain/')) body = { identity: { display_name: 'Map Check' }, current_state: {}, profile: {}, insights: {} }
    else if (path.includes('/triggers/subscribe')) return route.fulfill({ contentType: 'text/event-stream', body: '' })
    await route.fulfill({ json: body })
  })
  await page.route('**/locales/*.json', async (route) => route.fulfill({
    contentType: 'application/json',
    body: await readFile(new URL(`../../locales/${new URL(route.request().url()).pathname.split('/').pop()}`, import.meta.url), 'utf8'),
  }))
  await page.goto(`${origin}/roadmap`, { waitUntil: 'load' })
  await page.locator('.rm-page[data-webgl="ready"]').waitFor().catch(async (error) => {
    console.error(JSON.stringify({ errors, requests, body: await page.locator('body').innerText(), root: await page.locator('#root').innerHTML() }))
    throw error
  })
  await page.waitForFunction(() => document.querySelector('.rm-card h2')?.textContent === 'Level 5')
  const inspect = () => page.evaluate(() => {
    const scene = window.__roadmapObjects.find((object) => object.isScene && object.getObjectByName('roadmap-yuvi'))
    const robot = scene?.getObjectByName('roadmap-yuvi')
    return robot ? { position: robot.position.toArray(), arm: robot.getObjectByName('ambient-arm-right').rotation.z, yaw: robot.rotation.y } : null
  })
  const waitAt = async (index, current = status, rtl = false) => {
    const expected = yuviPosition(current, 50, index, rtl)
    await page.waitForFunction((target) => {
      const scene = window.__roadmapObjects.find((object) => object.isScene && object.getObjectByName('roadmap-yuvi'))
      const robot = scene?.getObjectByName('roadmap-yuvi')
      return robot && Math.abs(robot.position.x - target.x) < 0.01 && Math.abs(robot.position.z - target.z) < 0.01
        && Math.abs(robot.position.y - target.y) < 0.05 && Math.abs(robot.rotation.y) < 0.01
    }, expected)
  }
  await waitAt(4)
  const initial = await inspect()
  assert.ok(initial, 'Yuvi is in the existing map scene')
  await page.waitForFunction((arm) => {
    const scene = window.__roadmapObjects.find((object) => object.isScene && object.getObjectByName('roadmap-yuvi'))
    return Math.abs(scene.getObjectByName('ambient-arm-right').rotation.z - arm) > 0.3
  }, initial.arm)
  const desktop = join(tmpdir(), 'yuvi-roadmap-desktop.png')
  await page.screenshot({ path: desktop })
  const pixels = await page.evaluate(() => {
    const renderer = window.__roadmapObjects.find((object) => object.isWebGLRenderer && object.domElement.isConnected)
    return new Promise((resolve) => {
      const render = renderer.render
      renderer.render = function (...args) {
        render.apply(this, args)
        window.__roadmapCamera = args[1]
        const gl = this.getContext()
        const values = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, values)
        this.render = render
        resolve(values.some((value, index) => index % 4 !== 3 && value > 50))
      }
    })
  })
  assert.ok(pixels, 'canvas contains visible scene pixels')
  await page.locator('.rm-rail__range').fill('8')
  await waitAt(8)
  assert.notDeepEqual((await inspect()).position, initial.position, 'Yuvi follows the focused level')
  assert.equal(await page.evaluate(() => {
    const scene = window.__roadmapObjects.find((object) => object.isScene && object.getObjectByName('roadmap-yuvi'))
    return scene.getObjectByName('roadmap-yuvi-thruster-0').visible
  }), true, 'locked-level hover keeps the thrusters lit')
  let spinning = false
  for (const index of [7, 6, 3]) {
    await page.locator('.rm-rail__range').fill(String(index))
    spinning ||= await page.waitForFunction(() => {
      const scene = window.__roadmapObjects.find((object) => object.isScene && object.getObjectByName('roadmap-yuvi'))
      return Math.abs(scene.getObjectByName('roadmap-yuvi').rotation.y) > 0.5
    }, null, { timeout: 1800 }).then(() => true, () => false)
    await waitAt(index)
  }
  assert.ok(spinning, 'some level flights include an axial spin')
  await page.getByRole('button', { name: 'Back to my level' }).click()
  await page.waitForFunction(() => document.querySelector('.rm-card h2')?.textContent === 'Level 5')
  await waitAt(4)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => {
    const scene = window.__roadmapObjects.find((object) => object.isScene && object.getObjectByName('roadmap-yuvi'))
    const robot = scene.getObjectByName('roadmap-yuvi')
    const point = robot.getObjectByName('ambient-head').getWorldPosition(robot.position.clone()).project(window.__roadmapCamera)
    const screenX = (point.x + 1) * innerWidth / 2
    const screenY = (1 - point.y) * innerHeight / 2
    return screenX > innerWidth * 0.35 && screenX < innerWidth * 0.65 && screenY > 210 && screenY < document.querySelector('.rm-card').getBoundingClientRect().top - 80 && Math.abs(window.__roadmapCamera.up.x) < 0.002
  })
  const mobile = join(tmpdir(), 'yuvi-roadmap-mobile.png')
  await page.screenshot({ path: mobile })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.equal(await page.locator('canvas').count(), 1)
  await page.locator('.rm-rail__range').fill('5')
  await waitAt(5)
  const mobileLocked = join(tmpdir(), 'yuvi-roadmap-mobile-locked.png')
  await page.screenshot({ path: mobileLocked })
  const assertFramed = async () => {
    await page.waitForFunction(() => {
      const scene = window.__roadmapObjects.find((object) => object.isScene && object.getObjectByName('roadmap-yuvi'))
      const robot = scene.getObjectByName('roadmap-yuvi')
      const point = robot.getObjectByName('ambient-head').getWorldPosition(robot.position.clone()).project(window.__roadmapCamera)
      const screenX = (point.x + 1) * innerWidth / 2
      const screenY = (1 - point.y) * innerHeight / 2
      return screenX > 110 && screenX < innerWidth - 110 && screenY > 120 && screenY < document.querySelector('.rm-card').getBoundingClientRect().top - 45
    })
  }
  await assertFramed()
  Object.assign(status, { level: 6, progress: 0 })
  await page.evaluate((current) => window.dispatchEvent(new CustomEvent('spark:xp-award', {
    detail: { sparks: 0, receipts: [{ awarded: 100, duplicate: false, progression: { ...current, level: 6, progress: 0 } }] },
  })), status)
  await waitAt(5)
  for (const locale of ['he', 'ar']) {
    language = locale
    await page.reload({ waitUntil: 'load' })
    await page.locator('.rm-page[data-webgl="ready"]').waitFor()
    await page.waitForFunction((expected) => document.documentElement.lang === expected, locale)
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await waitAt(5, status, true)
    await page.locator('.rm-rail__range').fill('9')
    await waitAt(9, status, true)
    await assertFramed()
    await page.screenshot({ path: join(tmpdir(), `yuvi-roadmap-mobile-${locale}-locked.png`) })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload({ waitUntil: 'load' })
  await page.locator('.rm-page[data-webgl="ready"]').waitFor()
  assert.equal((await inspect()).arm, 0.095)
  await page.locator('.rm-rail__range').fill('9')
  await waitAt(9, status, true)
  assert.equal((await inspect()).arm, 0.095, 'reduced motion keeps a neutral pose even on locked levels')
  await page.evaluate(async () => {
    const { navigate } = await import('/src/app/router.tsx')
    navigate('/report')
  })
  await page.locator('.rm-stage canvas').waitFor({ state: 'detached' })
  assert.equal(await inspect(), null, 'Yuvi is detached when leaving the map')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ desktop, mobile, mobileLocked, spinning, moving: true, pixels, locales: ['en', 'he', 'ar'], levelUpdate: true, cleanup: true }))
} finally {
  await browser.close()
}