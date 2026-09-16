/* Pre-rendered catalogue thumbnails.
 *
 * Every avatar part and room prop has a 280×280 WebP under
 * `src/assets/studio-thumbs/<kind>/<id>.webp`, produced once by a developer
 * with `node scripts/render-studio-thumbs.mjs` (real GPU, same renderer the
 * client falls back to). Vite hashes each file into `/assets`, so a card's
 * picture rides the immutable cache and Front Door like any other static
 * asset, and opening the studio on a school PC creates no WebGL context for
 * the cards.
 *
 * The glob is the whole registry: adding a file is enough, and
 * `tests/studio-thumbs.test.ts` fails the build when a catalogue id has none.
 * `?no-inline` keeps the smaller files out of the JS chunk — an inlined base64
 * card is paid for on every studio load, a hashed file once. */

export type ThumbKind = 'avatar' | 'room'

const files = import.meta.glob<string>('../../assets/studio-thumbs/*/*.webp', {
  eager: true,
  query: '?no-inline',
  import: 'default',
})

const pathFor = (kind: ThumbKind, id: string) => `../../assets/studio-thumbs/${kind}/${id}.webp`

/** The hashed URL of one item's picture, or `undefined` when it must be
 *  rendered live (a new item before the script has been re-run). */
export function preRenderedThumb(kind: ThumbKind, id: string): string | undefined {
  return files[pathFor(kind, id)]
}

/** Every pre-rendered id of a kind, as the seed for that catalogue's
 *  thumbnail cache. A fresh object each call: the caches are mutated. */
export function preRenderedThumbs(kind: ThumbKind): Record<string, string> {
  const prefix = `../../assets/studio-thumbs/${kind}/`
  const out: Record<string, string> = {}
  for (const [path, url] of Object.entries(files)) {
    if (path.startsWith(prefix)) out[path.slice(prefix.length, -'.webp'.length)] = url
  }
  return out
}
