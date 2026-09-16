/* The worlds' self-hosted PBR textures and models, as hashed assets.
 *
 * `scripts/optimize-model-assets.mjs` writes them under `src/assets/models/`
 * (1K WebP maps, glTF props referencing them through `EXT_texture_webp`);
 * Vite hashes every file into `/assets`, so a texture rides the immutable
 * cache and Front Door like a catalogue thumbnail, and a changed map is a new
 * URL rather than a stale one. The glob is the registry: a path that is not in
 * it throws at the call site, not as a silent 404 on a school PC.
 *
 * A glTF names its buffer and images by relative URI; those files are hashed
 * too, so the document is fetched and its URIs are pointed at the hashed
 * files before `GLTFLoader` parses it. */
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type * as THREE from 'three'

// Two globs because the queries differ: `?no-inline` keeps a small WebP out of
// the JS chunk (Vite knows images), while `?url` is what makes Vite treat a
// glTF or a .bin — extensions it does not know — as an emitted file at all.
// `node --test` loads the world modules without Vite, where `import.meta.glob`
// does not exist: the registry is empty there and a path resolves to itself,
// which the tests' mocked loaders never fetch.
function registry(): Record<string, string> {
  try {
    return {
      ...import.meta.glob<string>('../../assets/models/**/*.webp', { eager: true, query: '?no-inline', import: 'default' }),
      ...import.meta.glob<string>('../../assets/models/**/*.{gltf,bin}', { eager: true, query: '?url&no-inline', import: 'default' }),
    }
  } catch {
    return {}
  }
}
const files = registry()
const bundled = Object.keys(files).length > 0

function assetUrl(path: string): string {
  const url = files[`../../assets/models/${path}`]
  if (url) return url
  if (!bundled) return `/src/assets/models/${path}`
  throw new Error(`no model asset ${path} — run scripts/optimize-model-assets.mjs`)
}

export type PlaygroundChannel = 'color' | 'normal' | 'roughness'
export const playgroundTextureUrl = (asset: string, channel: PlaygroundChannel) =>
  assetUrl(`playground/${asset}-${channel}.webp`)

export type LoftConcreteMap = 'Diffuse' | 'nor_gl' | 'Rough'
export const loftConcreteTextureUrl = (map: LoftConcreteMap) => assetUrl(`creator-loft/concrete/${map}.webp`)

/** A Creator Loft prop by id (`gamepad`, `gaming_console`, …): the parsed scene. */
export async function loadLoftModel(id: string): Promise<THREE.Object3D> {
  const response = await fetch(assetUrl(`creator-loft/${id}/${id}.gltf`))
  if (!response.ok) throw new Error(`model ${id}: HTTP ${response.status}`)
  const document = await response.json() as {
    buffers?: Array<{ uri?: string }>
    images?: Array<{ uri?: string }>
  }
  const hashed = (uri: string) => (/^(data|blob|https?):/.test(uri) ? uri : assetUrl(`creator-loft/${id}/${uri}`))
  for (const buffer of document.buffers ?? []) if (buffer.uri) buffer.uri = hashed(buffer.uri)
  for (const image of document.images ?? []) if (image.uri) image.uri = hashed(image.uri)
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(document), '')
  return gltf.scene
}
