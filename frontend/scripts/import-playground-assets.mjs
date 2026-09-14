import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../public/models/playground/', import.meta.url))
const assets = ['wood_planks', 'brown_mud_leaves_01', 'aerial_grass_rock']
const manifest = { license: 'CC0-1.0', licenseUrl: 'https://polyhaven.com/license', assets: [] }
await mkdir(root, { recursive: true })
for (const id of assets) {
  const response = await fetch(`https://api.polyhaven.com/files/${id}`)
  if (!response.ok) throw new Error(`${id}: ${response.status}`)
  const files = await response.json()
  const metadata = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json()
  for (const [channel, suffix] of [['Diffuse', 'color'], ['nor_gl', 'normal'], ['Rough', 'roughness']]) {
    const entry = files[channel]?.['1k']?.jpg
    if (!entry) throw new Error(`Missing ${id}/${channel}`)
    const download = await fetch(entry.url)
    if (!download.ok) throw new Error(`Download failed: ${id}/${channel}`)
    const buffer = Buffer.from(await download.arrayBuffer())
    const md5 = createHash('md5').update(buffer).digest('hex')
    if (md5 !== entry.md5) throw new Error(`Checksum mismatch: ${id}/${channel}`)
    const path = `${id}-${suffix}.jpg`
    await writeFile(`${root}/${path}`, buffer)
    manifest.assets.push({ id, channel, path, author: metadata.authors, source: `https://polyhaven.com/a/${id}`, url: entry.url, md5, bytes: buffer.length })
  }
}
await writeFile(`${root}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Imported ${manifest.assets.length} verified CC0 maps (${manifest.assets.reduce((total, asset) => total + asset.bytes, 0)} bytes)`)