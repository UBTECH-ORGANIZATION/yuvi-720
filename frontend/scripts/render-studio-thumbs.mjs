/* Pre-render every Yuvi Studio catalogue thumbnail to a WebP file.
 *
 *   cd frontend && node scripts/render-studio-thumbs.mjs [--port 5173] [--quality 0.82] [--only avatar|room] [--allow-software]
 *
 * Run by a developer, on a machine with a GPU, whenever `Yuvi_CATALOG`
 * (YuviAssets.ts) or the room props (RoomCatalog.ts) change — NOT in CI: the
 * runners have no GPU and the cards must look exactly as the live fallback
 * draws them on a real one. `tests/studio-thumbs.test.ts` is the reminder: a
 * catalogue id without a file fails the build and names this script.
 *
 * Needs the Vite dev server on the given port. It opens the dev-only entry
 * `scripts/studio-thumbs/index.html`, which imports the real catalogues and
 * the real shared thumbnail renderer, renders each item at 2× (280×280) and
 * hands back a WebP; the files land in `src/assets/studio-thumbs/<kind>/<id>.webp`
 * and are committed with the catalogue change. Files whose id has left the
 * catalogue are deleted, so the glob never ships an orphan.
 *
 * Playwright's default headless build is the "headless shell", which only has
 * SwiftShader; `channel: 'chromium'` is the full browser in new-headless mode
 * and renders on the machine's GPU (`npx playwright install chromium` if it is
 * missing). A software rasteriser is refused unless `--allow-software`. */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const port = flag('--port', '5173')
const quality = Number(flag('--quality', '0.82'))
const only = flag('--only', null)
const base = `http://localhost:${port}`
const OUT = fileURLToPath(new URL('../src/assets/studio-thumbs/', import.meta.url))
const EXPECTED_PX = 280

const kinds = ['avatar', 'room'].filter((kind) => !only || kind === only)
if (!kinds.length) { console.error(`--only must be avatar or room, got "${only}"`); process.exit(2) }

const browser = await chromium.launch({ headless: true, channel: 'chromium' }).catch(async (error) => {
  console.error(`could not launch the full Chromium (${String(error).split('\n')[0]}); run: npx playwright install chromium`)
  process.exit(2)
})
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)))
// Resource 404s (favicon) are noise; a thrown error in the render page is not.
page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) pageErrors.push(message.text().slice(0, 300)) })

await page.goto(`${base}/scripts/studio-thumbs/index.html`, { waitUntil: 'load' })
await page.waitForFunction(() => typeof window.__renderThumb === 'function', null, { timeout: 60_000 })

const gpu = await page.evaluate(() => window.__gpu())
console.log(`  · gpu: ${gpu}`)
if (/swiftshader|llvmpipe|softpipe|microsoft basic render/i.test(String(gpu)) && !args.includes('--allow-software')) {
  console.error('  ✖ that is a software rasteriser; the shipped cards must come from a real GPU (pass --allow-software to override)')
  await browser.close()
  process.exit(1)
}

const items = await page.evaluate(() => window.__thumbItems())
let failures = 0

// Everything is rendered first and written after the browser is closed: the
// output directory is what `studioThumbs.ts` globs, so the dev server reloads
// the page the moment a file lands there, and a reload mid-run loses the
// page's functions between two items.
const rendered = new Map()   // kind → Map(id → Buffer)
for (const kind of kinds) {
  const buffers = new Map()
  for (const id of items[kind]) {
    try {
      const { dataUrl, width, height } = await page.evaluate(([k, i, q]) => window.__renderThumb(k, i, q), [kind, id, quality])
      if (width !== EXPECTED_PX || height !== EXPECTED_PX) throw new Error(`rendered ${width}×${height}, expected ${EXPECTED_PX}×${EXPECTED_PX} (is the render tier forced high?)`)
      buffers.set(id, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
    } catch (error) {
      failures += 1
      console.log(`  ✖ ${kind}/${id}: ${String(error).split('\n')[0]}`)
    }
  }
  rendered.set(kind, buffers)
}
if (pageErrors.length) { failures += 1; console.log(`  ✖ page errors (${pageErrors.length}): ${pageErrors[0]}`) }
await browser.close()

let totalBytes = 0
let totalFiles = 0
for (const [kind, buffers] of rendered) {
  const dir = join(OUT, kind)
  await mkdir(dir, { recursive: true })
  let bytes = 0
  for (const [id, buffer] of buffers) {
    await writeFile(join(dir, `${id}.webp`), buffer)
    bytes += buffer.length
  }
  // An id that left the catalogue must not keep shipping.
  const ids = items[kind]
  const stale = (await readdir(dir)).filter((name) => name.endsWith('.webp') && !ids.includes(name.slice(0, -'.webp'.length)))
  for (const name of stale) { await rm(join(dir, name)); console.log(`  · removed stale ${kind}/${name}`) }
  console.log(`  ${buffers.size === ids.length ? '✔' : '✖'} ${kind}: ${buffers.size}/${ids.length} files, ${(bytes / 1024).toFixed(0)} KB`)
  totalBytes += bytes
  totalFiles += buffers.size
}
console.log(`  · total: ${totalFiles} files, ${(totalBytes / 1024).toFixed(0)} KB at quality ${quality}, ${EXPECTED_PX}px`)
console.log(failures ? `\n❌ ${failures} problem(s)` : '\n✅ thumbnails written to src/assets/studio-thumbs/')
process.exit(failures ? 1 : 0)
