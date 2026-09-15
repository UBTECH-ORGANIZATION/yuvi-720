/* The page `render-studio-thumbs.mjs` drives. It imports the real catalogues
 * and the real thumbnail renderer, so a pre-rendered card is pixel-for-pixel
 * what the live fallback would draw — only the encoding differs. */
import { Yuvi_CATALOG, assetThumbnailObject } from '../../src/features/Yuvi-studio/YuviAssets'
import { ROOM_ITEMS, WEEKLY_SURPRISE_ITEMS, roomThumbnailObject } from '../../src/features/Yuvi-studio/RoomCatalog'
import { renderThumbnail, type ThumbnailPreset } from '../../src/features/Yuvi-studio/thumbnailRenderer'
import { probeGpu } from '../../src/features/Yuvi-studio/renderTier'

interface Rendered { dataUrl: string; width: number; height: number }

const ROOM_SPECS = [...ROOM_ITEMS, ...WEEKLY_SURPRISE_ITEMS]

function thumbItems(): Record<ThumbnailPreset, string[]> {
  return { avatar: Yuvi_CATALOG.map((a) => a.id), room: ROOM_SPECS.map((s) => s.id) }
}

async function renderThumb(kind: ThumbnailPreset, id: string, quality: number): Promise<Rendered> {
  const build = kind === 'avatar'
    ? (() => { const asset = Yuvi_CATALOG.find((a) => a.id === id); if (!asset) throw new Error(`no avatar item ${id}`); return () => assetThumbnailObject(asset) })()
    : (() => { const spec = ROOM_SPECS.find((s) => s.id === id); if (!spec) throw new Error(`no room prop ${id}`); return () => roomThumbnailObject(spec) })()
  const url = await renderThumbnail(kind, build, { type: 'image/webp', quality })
  if (!url) throw new Error('no WebGL context')
  const blob = await (await fetch(url)).blob()
  URL.revokeObjectURL(url)
  if (blob.type !== 'image/webp') throw new Error(`browser encoded ${blob.type}, not image/webp`)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  const image = new Image()
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = dataUrl })
  return { dataUrl, width: image.naturalWidth, height: image.naturalHeight }
}

declare global {
  interface Window {
    __thumbItems: typeof thumbItems
    __renderThumb: typeof renderThumb
    __gpu: () => string | null
  }
}
window.__thumbItems = thumbItems
window.__renderThumb = renderThumb
window.__gpu = probeGpu
