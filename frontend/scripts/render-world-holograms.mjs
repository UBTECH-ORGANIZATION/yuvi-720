/* Pre-render the Room panel's four world holograms to WebP sprite strips.
 *
 *   cd frontend && node scripts/render-world-holograms.mjs [--port 5173] [--quality 0.8] [--allow-software]
 *
 * Run by a developer, on a machine with a GPU, whenever `worldHolograms.ts`
 * changes — NOT in CI: the runners have no GPU and the strips must look
 * exactly as the live projection drew them on a real one.
 * `tests/world-holograms.test.ts` is the reminder: a world without a strip
 * fails the build and names this script.
 *
 * Needs the Vite dev server on the given port. It opens the dev-only entry
 * `scripts/world-holograms/index.html`, which builds each world with the real
 * builders, renders `WORLD_HOLOGRAM_FRAMES` frames of one full turn and
 * stacks them top to bottom; the strips land in
 * `src/assets/world-holograms/<id>.webp`, the pad they all stand on (the same
 * in every frame of a turn) in `pad.webp`, the padlock overlay in `lock.webp`,
 * and `manifest.json` records the frame geometry the CSS steps through.
 *
 * Playwright's default headless build only has SwiftShader; `channel:
 * 'chromium'` is the full browser and renders on the machine's GPU
 * (`npx playwright install chromium` if it is missing). A software rasteriser
 * is refused unless `--allow-software`. */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const port = flag('--port', '5173')
const quality = Number(flag('--quality', '0.8'))
const base = `http://localhost:${port}`
const OUT = fileURLToPath(new URL('../src/assets/world-holograms/', import.meta.url))

const browser = await chromium.launch({ headless: true, channel: 'chromium' }).catch(async (error) => {
  console.error(`could not launch the full Chromium (${String(error).split('\n')[0]}); run: npx playwright install chromium`)
  process.exit(2)
})
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)))
page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) pageErrors.push(message.text().slice(0, 300)) })

await page.goto(`${base}/scripts/world-holograms/index.html`, { waitUntil: 'load' })
await page.waitForFunction(() => typeof window.__renderStrip === 'function', null, { timeout: 60_000 })

const gpu = await page.evaluate(() => window.__gpu())
console.log(`  · gpu: ${gpu}`)
if (/swiftshader|llvmpipe|softpipe|microsoft basic render/i.test(String(gpu)) && !args.includes('--allow-software')) {
  console.error('  ✖ that is a software rasteriser; the shipped strips must come from a real GPU (pass --allow-software to override)')
  await browser.close()
  process.exit(1)
}

// The frame geometry is read from the page (it imports the same constants the
// picker's CSS is driven by), so the manifest cannot drift from the code.
const geometry = await page.evaluate(() => window.__geometry())
const ids = await page.evaluate(() => window.__worldIds())
let failures = 0

// Rendered first, written after the browser is closed: the output directory
// is what `worldHologramStrips.ts` globs, so a file landing there reloads the
// dev page mid-run.
const rendered = new Map()
for (const id of ids) {
  try {
    const { dataUrl, width, height } = await page.evaluate(([i, q]) => window.__renderStrip(i, q), [id, quality])
    const expectedHeight = geometry.height * geometry.frames
    if (width !== geometry.width || height !== expectedHeight) throw new Error(`rendered ${width}×${height}, expected ${geometry.width}×${expectedHeight}`)
    rendered.set(id, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
  } catch (error) {
    failures += 1
    console.log(`  ✖ ${id}: ${String(error).split('\n')[0]}`)
  }
}
// The stills: the pad every world stands on and the padlock of a locked one.
for (const name of ['pad', 'lock']) {
  try {
    const { dataUrl, width, height } = await page.evaluate(([n, q]) => window.__renderStill(n, q), [name, quality])
    if (width !== geometry.width || height !== geometry.height) throw new Error(`rendered ${width}×${height}, expected ${geometry.width}×${geometry.height}`)
    rendered.set(name, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
  } catch (error) {
    failures += 1
    console.log(`  ✖ ${name}: ${String(error).split('\n')[0]}`)
  }
}
if (pageErrors.length) { failures += 1; console.log(`  ✖ page errors (${pageErrors.length}): ${pageErrors[0]}`) }
await browser.close()

await mkdir(OUT, { recursive: true })
let bytes = 0
for (const [id, buffer] of rendered) {
  await writeFile(join(OUT, `${id}.webp`), buffer)
  bytes += buffer.length
  console.log(`  ✔ ${id}.webp: ${(buffer.length / 1024).toFixed(0)} KB`)
}
const keep = new Set([...ids, 'pad', 'lock'].map((id) => `${id}.webp`))
for (const name of await readdir(OUT)) {
  if (name.endsWith('.webp') && !keep.has(name)) { await rm(join(OUT, name)); console.log(`  · removed stale ${name}`) }
}
await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify({ ...geometry, worlds: [...ids].sort(), quality }, null, 2)}\n`)
console.log(`  · total: ${rendered.size} files, ${(bytes / 1024).toFixed(0)} KB at quality ${quality}, ${geometry.frames} frames of ${geometry.width}×${geometry.height}`)
console.log(failures ? `\n❌ ${failures} problem(s)` : '\n✅ strips written to src/assets/world-holograms/')
process.exit(failures ? 1 : 0)
