/* Ship the worlds' PBR textures and models as small hashed assets.
 *
 *   cd frontend && node scripts/optimize-model-assets.mjs [--quality 0.85] [--max 1024]
 *
 * The import scripts (`import-playground-assets.mjs`, `import-loft-assets.mjs`)
 * download Poly Haven's 1K/2K JPEG sets into `scripts/.model-sources/`
 * (gitignored). This turns them into what actually ships, under
 * `src/assets/models/` where Vite hashes every file into `/assets` (immutable
 * cache, Front Door, like the catalogue thumbnails):
 *
 *   - every map re-encoded as WebP at `--quality`, no wider than `--max` px
 *     (a 2K set is 28 MB of JPEG; the same set at 1K WebP is under 3 MB, and
 *     a prop seen from the room camera cannot show the difference);
 *   - each glTF rewritten to reference the WebP maps through
 *     `EXT_texture_webp` (three's GLTFLoader reads it); the `.bin` geometry
 *     is copied as is;
 *   - a manifest per world with the shipped bytes and md5 of every file plus
 *     the Poly Haven provenance carried over from the download manifest.
 *     `tests/loft-assets.test.ts` checks the files against it.
 *
 * Encoding runs in Playwright's Chromium (canvas → `image/webp`), the same
 * encoder the thumbnail script uses, so no image library is added. */

import { mkdir, readdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const quality = Number(flag('--quality', '0.85'))
const maxPx = Number(flag('--max', '1024'))
const SRC = fileURLToPath(new URL('./.model-sources/', import.meta.url))
const OUT = fileURLToPath(new URL('../src/assets/models/', import.meta.url))

const md5 = (bytes) => createHash('md5').update(bytes).digest('hex')
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
/** JPEG bytes → WebP bytes, downscaled to fit `maxPx` (aspect kept). */
async function toWebp(bytes) {
  const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`
  const out = await page.evaluate(async ([src, q, max]) => {
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = src })
    const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', q))
    if (!blob || blob.type !== 'image/webp') throw new Error(`encoded ${blob?.type}, not image/webp`)
    const buffer = new Uint8Array(await blob.arrayBuffer())
    return { bytes: Array.from(buffer), width: canvas.width, height: canvas.height }
  }, [dataUrl, quality, maxPx])
  return { bytes: Buffer.from(out.bytes), width: out.width, height: out.height }
}

const shipped = []   // for the summary
async function emit(relPath, bytes) {
  const target = join(OUT, relPath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, bytes)
  shipped.push({ path: relPath, bytes: bytes.length })
  return { path: relPath, bytes: bytes.length, md5: md5(bytes) }
}

// ── playground: nine PBR maps, three per material ─────────────────────────
{
  const source = await readJson(join(SRC, 'playground/manifest.json'))
  const manifest = { license: source.license, licenseUrl: source.licenseUrl, quality, maxPx, assets: [] }
  for (const asset of source.assets) {
    const input = await readFile(join(SRC, 'playground', asset.path))
    const webp = await toWebp(input)
    const file = await emit(`playground/${asset.path.replace(/\.jpg$/, '.webp')}`, webp.bytes)
    manifest.assets.push({ id: asset.id, channel: asset.channel, ...file, width: webp.width, height: webp.height,
      source: { url: asset.url, md5: asset.md5, bytes: asset.bytes, author: asset.author, page: asset.source } })
  }
  await writeFile(join(OUT, 'playground/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`  ✔ playground: ${manifest.assets.length} maps`)
}

// ── creator loft: four glTF props and the concrete floor ──────────────────
{
  const source = await readJson(join(SRC, 'creator-loft/manifest.json'))
  const manifest = { license: source.license, licenseUrl: source.licenseUrl, quality, maxPx, assets: [], textures: [] }
  for (const asset of source.assets) {
    const document = await readJson(join(SRC, 'creator-loft', asset.path))
    const dependencies = []
    const provenance = new Map(asset.dependencies.map((d) => [d.path.slice(asset.id.length + 1), d]))
    for (const image of document.images ?? []) {
      const original = provenance.get(image.uri)
      const webp = await toWebp(await readFile(join(SRC, 'creator-loft', asset.id, image.uri)))
      const uri = image.uri.replace(/\.(jpe?g|png)$/i, '.webp')
      const file = await emit(`creator-loft/${asset.id}/${uri}`, webp.bytes)
      dependencies.push({ ...file, width: webp.width, height: webp.height, source: original && { url: original.source, md5: original.md5, bytes: original.bytes } })
      image.uri = uri
      image.mimeType = 'image/webp'
    }
    // Every texture goes through the extension; a plain `source` must not stay
    // behind, or a loader without WebP support would read a JPEG that is gone.
    for (const texture of document.textures ?? []) {
      texture.extensions = { ...(texture.extensions ?? {}), EXT_texture_webp: { source: texture.source } }
      delete texture.source
    }
    const used = new Set([...(document.extensionsUsed ?? []), 'EXT_texture_webp'])
    const required = new Set([...(document.extensionsRequired ?? []), 'EXT_texture_webp'])
    document.extensionsUsed = [...used]
    document.extensionsRequired = [...required]
    for (const buffer of document.buffers ?? []) {
      const original = provenance.get(buffer.uri)
      const bytes = await readFile(join(SRC, 'creator-loft', asset.id, buffer.uri))
      const file = await emit(`creator-loft/${asset.id}/${buffer.uri}`, bytes)
      dependencies.push({ ...file, source: original && { url: original.source, md5: original.md5, bytes: original.bytes } })
    }
    const gltfBytes = Buffer.from(`${JSON.stringify(document, null, 1)}\n`)
    const file = await emit(`creator-loft/${asset.id}/${asset.id}.gltf`, gltfBytes)
    manifest.assets.push({ id: asset.id, ...file, author: asset.author, page: asset.source,
      source: { md5: asset.md5 }, dependencies })
    console.log(`  ✔ ${asset.id}: ${dependencies.length} files`)
  }
  for (const map of source.textures) {
    const webp = await toWebp(await readFile(join(SRC, 'creator-loft', map.path)))
    const file = await emit(`creator-loft/${map.path.replace(/\.jpg$/, '.webp')}`, webp.bytes)
    manifest.textures.push({ ...file, width: webp.width, height: webp.height, author: map.author, page: map.source,
      source: { url: map.download, md5: map.md5, bytes: map.bytes } })
  }
  await writeFile(join(OUT, 'creator-loft/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`  ✔ creator-loft concrete: ${manifest.textures.length} maps`)
}
await browser.close()

// Anything under src/assets/models that this run did not write is stale.
const written = new Set(shipped.map((f) => f.path))
async function sweep(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { await sweep(full); continue }
    const rel = relative(OUT, full)
    if (!written.has(rel) && !rel.endsWith('manifest.json')) { await rm(full); console.log(`  · removed stale ${rel}`) }
  }
}
await sweep(OUT)
const total = shipped.reduce((sum, f) => sum + f.bytes, 0)
console.log(`  · ${shipped.length} files, ${(total / 1024).toFixed(0)} KB at quality ${quality}, ≤${maxPx}px\n✅ written to src/assets/models/`)
