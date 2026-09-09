import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../public/models/creator-loft/', import.meta.url))
const headers = { 'User-Agent': 'YuvilabSparkAssetImport/1.0' }
const assets = ['gamepad', 'gaming_console', 'rubber_duck_toy', 'digital_wrist_watch']
const manifest = { license: 'CC0-1.0', licenseUrl: 'https://polyhaven.com/license', assets: [] }

async function json(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  return response.json()
}

async function download(file, target) {
  if (!file.url.startsWith('https://dl.polyhaven.org/')) throw new Error('Unexpected download host')
  if (file.size > 20_000_000) throw new Error('Unexpected asset size')
  const matches = (bytes) => createHash('md5').update(bytes).digest('hex') === file.md5
  try {
    if (matches(await readFile(target))) return
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const response = await fetch(file.url, { headers, signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${file.url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length !== file.size || !matches(bytes)) throw new Error('Asset integrity mismatch')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, bytes)
}

for (const id of assets) {
  const metadata = await json(`https://api.polyhaven.com/info/${id}`)
  const files = await json(`https://api.polyhaven.com/files/${id}`)
  const model = files.gltf?.['2k']?.gltf
  if (!model) throw new Error(`No 2K glTF available: ${id}`)
  const local = `${id}/${id}.gltf`
  await download(model, resolve(root, local))
  const dependencies = []
  for (const [path, file] of Object.entries(model.include)) {
    if (path.includes('..') || path.startsWith('/') || path.includes(':')) throw new Error('Invalid dependency path')
    await download(file, resolve(root, id, path))
    dependencies.push({ path: `${id}/${path}`, source: file.url, md5: file.md5, bytes: file.size })
  }
  manifest.assets.push({ id, author: metadata.authors, source: `https://polyhaven.com/a/${id}`, path: local, md5: model.md5, dependencies })
  console.log(`Imported ${id}: ${dependencies.length} dependencies, verified MD5`)
}
const materialId = 'concrete_floor_02'
const materialFiles = await json(`https://api.polyhaven.com/files/${materialId}`)
const materialInfo = await json(`https://api.polyhaven.com/info/${materialId}`)
manifest.textures = []
for (const map of ['Diffuse', 'nor_gl', 'Rough']) {
  const file = materialFiles[map]['2k'].jpg
  const path = `concrete/${map}.jpg`
  await download(file, resolve(root, path))
  manifest.textures.push({ path, author: materialInfo.authors, source: `https://polyhaven.com/a/${materialId}`, download: file.url, md5: file.md5, bytes: file.size })
}
console.log('Imported concrete: diffuse, OpenGL normal, roughness; verified MD5')
await writeFile(resolve(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)