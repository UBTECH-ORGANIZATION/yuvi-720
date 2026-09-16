import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const output = fileURLToPath(new URL('../../.runtime/playground-review/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
console.log('Isolated Chromium started')
const progress = setInterval(() => console.log('Visual review still running'), 4000)
const report = { passed: false, equipment: null, error: null }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') console.log('browser:', message.text()) })
  await page.route('**/__playground-review*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Playground isolated review</title></head><body></body></html>' }))
  await page.goto(`http://127.0.0.1:5173/__playground-review${process.argv.includes('--direct') ? '?direct' : ''}`, { waitUntil: 'load' })
  console.log('Review document loaded')
  await page.evaluate(async () => { window.reviewModule = await import('/scripts/playground-review.mjs') })
  console.log('Review module imported')
  await page.evaluate(async (rich) => { window.review = await window.reviewModule.createPlaygroundReview(rich); await window.review.locale('en') }, !process.argv.includes('--low'))
  console.log('Scene and assets ready')
  const structure = await page.evaluate(() => ({
    roof: Boolean(window.review.park.group.getObjectByName('playground-roof')),
    fans: [0, 1, 2].every((index) => Boolean(window.review.park.group.getObjectByName(`playground-ceiling-fan-${index}`))),
    removed: ['playground-swings', 'playground-roundabout', 'playground-train', 'playground-towers', 'playground-zipline', 'playground-rope-adventure', 'playground-sand-discovery'].every((name) => !window.review.park.group.getObjectByName(name)),
  }))
  assert.deepEqual(structure, { roof: true, fans: true, removed: true })
  const decluttered = await page.evaluate(() => {
    const root = window.review.park.group
    const counts = { trees: 0, benches: 0, beds: 0, shrubs: 0 }
    window.review.equipment.traverse((node) => {
      if (node.name.startsWith('park-tree-')) counts.trees++
      if (node.name === 'parkBench') counts.benches++
      if (node.name.startsWith('planting-bed-')) {
        counts.beds++
        node.children.forEach((child) => { if (child.isInstancedMesh) counts.shrubs += child.count })
      }
    })
    const labels = []
    window.review.park.setLabels((key) => { labels.push(key); return key })
    return { ...counts,
      signsRemoved: !root.getObjectByName('park-information') && !root.getObjectByName('park-directions'),
      extraTextRemoved: labels.every((key) => key.startsWith('YuviStudio.playground.route.')),
    }
  })
  assert.deepEqual(decluttered, { trees: 2, benches: 1, beds: 1, shrubs: process.argv.includes('--low') ? 90 : 220, signsRemoved: true, extraTextRemoved: true })
  console.log('decluttered scene', decluttered)
  const equipment = await page.evaluate(() => window.review.checkEquipment())
  report.equipment = equipment
  assert.ok(equipment.hitGift, 'gift must be visible and raycastable from the clear approach')
  for (const check of equipment.checks) {
    assert.ok(check.preserved, `${check.kind} animation overwrote editor rotation`)
    assert.ok(check.radius <= check.allowed + 0.05, `${check.kind} geometry radius ${check.radius} exceeds ${check.allowed}`)
  }
  console.log('equipment rotation and bounds', equipment)
  await page.evaluate(() => window.review.locale('en'))
  for (const view of ['overview', 'roof', 'towers', 'climbing', 'traffic', 'sand', 'cleared', 'gift']) {
    const metrics = await page.evaluate((name) => window.review.view(name), view)
    console.log('frame', view, JSON.stringify(metrics))
    await page.screenshot({ path: `${output}/${view}.png` })
    assert.ok(metrics.colors > 50, `${view} blank`)
    console.log(view, JSON.stringify(metrics))
  }
  const motion = await page.evaluate(() => { window.review.view('roof'); return [window.review.render(1).hash, window.review.render(2).hash] })
  assert.notEqual(motion[0], motion[1], 'ambient movement must change pixels')
  const catalogMetrics = await page.evaluate(() => window.review.catalog())
  assert.ok(catalogMetrics.colors > 50, 'catalog rides must render')
  await page.screenshot({ path: `${output}/catalog.png` })
  const rides = await page.evaluate(() => {
    const { samples } = window.review
    window.review.render(0)
    const before = samples.children.map((ride) => ride.getObjectByName(ride.name === 'parkCarousel' ? 'carousel-platform' : 'swing-pivot-0').rotation.toArray())
    window.review.render(2)
    return samples.children.map((ride, index) => ({
      name: ride.name,
      animated: JSON.stringify(before[index]) !== JSON.stringify(ride.getObjectByName(ride.name === 'parkCarousel' ? 'carousel-platform' : 'swing-pivot-0').rotation.toArray()),
    }))
  })
  assert.equal(rides.length, 3)
  assert.ok(rides.every((ride) => ride.animated))
  console.log('catalog', rides)
  for (const language of ['he', 'ar']) {
    await page.evaluate((language) => window.review.locale(language), language)
    await page.evaluate(() => window.review.view('traffic'))
    await page.screenshot({ path: `${output}/traffic-${language}.png` })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = await page.evaluate(() => window.review.view('overview'))
  assert.ok(mobile.colors > 50, 'mobile canvas must not be blank')
  await page.screenshot({ path: `${output}/mobile.png` })
  await page.evaluate(() => window.review.view('gift'))
  await page.screenshot({ path: `${output}/gift-mobile.png` })
  console.log('disposal', await page.evaluate(() => window.review.dispose()))
  const reducedMotion = await page.evaluate(async () => {
    window.review = await window.reviewModule.createPlaygroundReview(false, true)
    window.review.view('roof')
    const fanBefore = window.review.render(1).hash
    const fanAfter = window.review.render(2).hash
    window.review.catalog()
    const ridesBefore = window.review.render(1).hash
    const ridesAfter = window.review.render(2).hash
    window.review.dispose()
    return { fansStill: fanBefore === fanAfter, ridesStill: ridesBefore === ridesAfter }
  })
  assert.deepEqual(reducedMotion, { fansStill: true, ridesStill: true })
  console.log('reduced motion', reducedMotion)
  assert.deepEqual(errors, [])
  report.passed = true
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  clearInterval(progress)
  await browser.close()
  await writeFile(`${output}/result.json`, JSON.stringify(report, null, 2))
}