/* Every catalogue item ships with its pre-rendered thumbnail.
 *
 *   node --test frontend/tests/
 *
 * The studio's cards are WebP files under `src/assets/studio-thumbs/<kind>/`,
 * produced by `node scripts/render-studio-thumbs.mjs` on a developer's GPU and
 * committed with the catalogue change (see `studioThumbs.ts`). A new item
 * without a file would render live on every school PC — the exact startup
 * burst the files exist to remove — and nothing else would notice. So this
 * reads the ids the render script saw (`manifest.json`, written from the live
 * catalogue) and requires a file for each, and no file for an id that has left.
 *
 * Source-level on purpose: both catalogues import Three.js and build meshes at
 * module load, which needs a DOM this runner does not have. The manifest is the
 * id list because the room catalogue builds whole families of ids in loops —
 * `prestige_room_object_${level}`, the sports artwork, the park rides — that a
 * scan of the source cannot enumerate. A scan still runs: every id spelled out
 * literally must be in the manifest, so a new item cannot ship without the
 * script having been re-run.
 */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const STUDIO = join(SRC, 'features/Yuvi-studio')
const THUMBS = join(SRC, 'assets/studio-thumbs')
const RERUN = 'run `cd frontend && node scripts/render-studio-thumbs.mjs` (needs the Vite dev server and a GPU) and commit the files'

const yuviAssets = readFileSync(join(STUDIO, 'YuviAssets.ts'), 'utf8')
const roomCatalog = readFileSync(join(STUDIO, 'RoomCatalog.ts'), 'utf8')
const studioThumbs = readFileSync(join(STUDIO, 'studioThumbs.ts'), 'utf8')

/** Ids inside `Yuvi_CATALOG`: `{ id: 'snapback', slot: ... }`. */
function avatarIds(): string[] {
  const start = yuviAssets.indexOf('export const Yuvi_CATALOG')
  assert.ok(start > 0, 'Yuvi_CATALOG has been renamed')
  const block = yuviAssets.slice(start, yuviAssets.indexOf('\n]', start))
  return [...block.matchAll(/\{ id: '([^']+)', slot:/g)].map((m) => m[1])
}

/** Literal ids of `ROOM_ITEMS` and `WEEKLY_SURPRISE_ITEMS`: `id: 'rug', category:`,
 *  plus the two surprise-box ids that are spelled as constants. The portal
 *  furniture (`PORTAL_FURNITURE_ITEMS`) is placed by the product, never sold
 *  through the catalogue, so it has no card and no file. */
function roomIds(): string[] {
  const catalogue = roomCatalog.slice(0, roomCatalog.indexOf('export const PORTAL_FURNITURE_ITEMS'))
    + roomCatalog.slice(roomCatalog.indexOf('export const WEEKLY_SURPRISE_ITEMS'))
  const literal = [...catalogue.matchAll(/\bid: '([^']+)', category:/g)].map((m) => m[1])
  const constants = [...roomCatalog.matchAll(/\bid: (WEEKLY_SURPRISE_[A-Z]+), category:/g)].map((m) => {
    const value = roomCatalog.match(new RegExp(`const ${m[1]} = '([^']+)'`))
    assert.ok(value, `${m[1]} is not a string constant in RoomCatalog.ts`)
    return value[1]
  })
  return [...literal, ...constants]
}

const files = (kind: string) =>
  readdirSync(join(THUMBS, kind)).filter((name) => name.endsWith('.webp')).map((name) => name.slice(0, -'.webp'.length))

describe('pre-rendered studio thumbnails', () => {
  const literal = { avatar: avatarIds(), room: roomIds() }
  const catalogues: Record<string, string[]> = JSON.parse(readFileSync(join(THUMBS, 'manifest.json'), 'utf8'))

  it('reads a plausible number of ids out of each catalogue', () => {
    // A regex that silently matches nothing would pass every check below.
    assert.ok(literal.avatar.length >= 20, `only ${literal.avatar.length} avatar ids parsed`)
    assert.ok(literal.room.length >= 40, `only ${literal.room.length} room ids parsed`)
    for (const [kind, ids] of Object.entries(catalogues)) {
      assert.equal(new Set(ids).size, ids.length, `${kind} ids are not unique`)
    }
  })

  for (const [kind, ids] of Object.entries(literal)) {
    it(`every ${kind} id spelled in the source was rendered`, () => {
      // An item added by hand, with the script not re-run since.
      const known = new Set(catalogues[kind])
      const unrendered = ids.filter((id) => !known.has(id))
      assert.deepEqual(unrendered, [], `not in the manifest for ${kind}: ${unrendered.join(', ')} — ${RERUN}`)
    })
  }

  for (const [kind, ids] of Object.entries(catalogues)) {
    it(`every ${kind} id has a file`, () => {
      const missing = ids.filter((id) => !existsSync(join(THUMBS, kind, `${id}.webp`)))
      assert.deepEqual(missing, [], `no pre-rendered thumbnail for ${kind}: ${missing.join(', ')} — ${RERUN}`)
    })

    it(`no ${kind} file is left over from a removed id`, () => {
      const known = new Set(ids)
      const stale = files(kind).filter((id) => !known.has(id))
      assert.deepEqual(stale, [], `stale thumbnails for ${kind}: ${stale.join(', ')} — ${RERUN} (it deletes them)`)
    })

    it(`${kind} files are real WebP, not empty`, () => {
      for (const id of ids) {
        const head = readFileSync(join(THUMBS, kind, `${id}.webp`)).subarray(0, 12)
        assert.equal(head.toString('latin1', 0, 4), 'RIFF', `${kind}/${id}.webp is not RIFF`)
        assert.equal(head.toString('latin1', 8, 12), 'WEBP', `${kind}/${id}.webp is not WebP`)
      }
    })
  }

  it('stays inside the budget the school-PC audit set', () => {
    let total = 0
    for (const kind of Object.keys(catalogues)) {
      for (const id of files(kind)) total += readFileSync(join(THUMBS, kind, `${id}.webp`)).length
    }
    assert.ok(total <= 1.5 * 1024 * 1024, `thumbnails total ${(total / 1024).toFixed(0)} KB, over 1.5 MB — lower --quality in the render script`)
  })
})

describe('the client prefers the files', () => {
  it('both caches start seeded from the pre-rendered map', () => {
    // A cache that starts empty means the live renderer runs on every open
    // and the files are dead weight.
    assert.match(yuviAssets, /export const assetThumbnailCache: Record<string, string> = preRenderedThumbs\('avatar'\)/)
    assert.match(roomCatalog, /export const roomThumbnailCache: Record<string, string> = preRenderedThumbs\('room'\)/)
  })

  it('the files are hashed assets, never inlined into the chunk', () => {
    assert.match(studioThumbs, /import\.meta\.glob<string>\('\.\.\/\.\.\/assets\/studio-thumbs\/\*\/\*\.webp'/)
    assert.match(studioThumbs, /query: '\?no-inline'/)
  })
})
