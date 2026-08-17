/* The gallery: every component, in a real player, at a chosen size.
 *
 * Frames are created lazily. Forty-five live players each booting a payload, a
 * speech SDK and an xAPI queue at once will stall the tab, so a frame is only
 * given its `src` when it comes near the viewport, and the grid stays usable
 * while you scroll to the unit you care about.
 */

const grid = document.getElementById('gl-grid')
const countEl = document.getElementById('gl-count')
const emptyEl = document.getElementById('gl-empty')
const viewportSel = document.getElementById('gl-viewport')
const themeSel = document.getElementById('gl-theme')
const langSel = document.getElementById('gl-lang')
const unitSel = document.getElementById('gl-unit')
const kindSel = document.getElementById('gl-kind')
const zoomSel = document.getElementById('gl-zoom')

let items = []

/* Frames are only loaded when they scroll into view — see the note above. */
const lazy = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return
    const frame = entry.target
    if (!frame.dataset.src || frame.src) return
    frame.src = frame.dataset.src
    lazy.unobserve(frame)
  })
}, { rootMargin: '400px' })

const frameUrl = (item) => {
  const url = new URL(item.launchUrl, window.location.origin)
  url.searchParams.set('lang', langSel.value)
  if (themeSel.value) url.searchParams.set('theme', themeSel.value)
  else url.searchParams.delete('theme')
  // Cache-buster so "Reload all" genuinely re-boots rather than restoring bfcache.
  url.searchParams.set('_r', String(Date.now()))
  return url.toString()
}

function card(item) {
  const [width, height] = viewportSel.value.split('x').map(Number)
  const zoom = Number(zoomSel.value) || 1

  const frame = document.createElement('iframe')
  frame.className = 'gl-frame'
  frame.title = item.componentId
  frame.loading = 'lazy'
  // The same sandbox the lesson page uses, so anything that breaks here would
  // have broken there too.
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  frame.setAttribute('allow', 'autoplay; microphone')
  frame.style.inlineSize = `${width}px`
  frame.style.blockSize = `${height}px`
  frame.style.transform = `scale(${zoom})`
  frame.dataset.src = frameUrl(item)

  // The frame keeps its full layout size; only its painted size shrinks. The
  // holder is what actually takes up room in the grid, so it carries the scaled
  // dimensions — otherwise a scaled frame would still reserve its original box.
  const holder = document.createElement('div')
  holder.className = 'gl-holder'
  holder.style.inlineSize = `${Math.round(width * zoom)}px`
  holder.style.blockSize = `${Math.round(height * zoom)}px`
  holder.append(frame)

  const open = document.createElement('a')
  open.className = 'gl-open'
  open.href = frame.dataset.src
  open.target = '_blank'
  open.rel = 'noopener'
  open.textContent = 'open ↗'

  const reload = document.createElement('button')
  reload.type = 'button'
  reload.className = 'gl-btn gl-btn--small'
  reload.textContent = 'reload'
  reload.addEventListener('click', () => { frame.src = frameUrl(item) })

  const head = document.createElement('div')
  head.className = 'gl-card__head'
  // The learner-facing name leads; the component id stays as the small print a
  // developer needs to find the file behind a card.
  const title = Object.assign(document.createElement('span'), {
    className: 'gl-card__title', textContent: item.title || item.componentId,
  })
  title.dir = 'auto'
  head.append(
    title,
    Object.assign(document.createElement('span'), {
      className: 'gl-card__id', textContent: item.componentId,
    }),
    Object.assign(document.createElement('span'), {
      className: 'gl-card__kinds', textContent: (item.kinds || []).join(' · '),
    }),
    reload, open,
  )
  if (item.isAssessment) {
    head.prepend(Object.assign(document.createElement('span'), {
      className: 'gl-badge', textContent: 'assessment',
    }))
  }

  const wrap = document.createElement('section')
  wrap.className = 'gl-card'
  wrap.dataset.unit = item.unitId
  wrap.dataset.kinds = (item.kinds || []).join(',')
  wrap.append(head, holder)
  lazy.observe(frame)
  return wrap
}

function render() {
  grid.replaceChildren()
  const unit = unitSel.value
  const kind = kindSel.value
  const shown = items.filter((item) =>
    (!unit || item.unitId === unit)
    && (!kind || (item.kinds || []).includes(kind)))
  shown.forEach((item) => grid.append(card(item)))
  countEl.textContent = `${shown.length} of ${items.length} components`
  emptyEl.hidden = items.length > 0
}

function fillFilters() {
  // `load()` can run again (the language switch refetches so the names follow
  // it), so the filters rebuild from their placeholder rather than append.
  const keep = (sel) => {
    const chosen = sel.value
    sel.replaceChildren(sel.options[0])
    return chosen
  }
  const chosenUnit = keep(unitSel)
  const units = new Map(items.map((i) => [i.unitId, i.unitTitle || i.unitId]))
  ;[...units.keys()].sort().forEach((id) => {
    const option = Object.assign(document.createElement('option'), {
      value: id, textContent: units.get(id),
    })
    option.dir = 'auto'
    unitSel.append(option)
  })
  unitSel.value = units.has(chosenUnit) ? chosenUnit : ''

  const chosenKind = keep(kindSel)
  const kinds = [...new Set(items.flatMap((i) => i.kinds || []))].sort()
  kinds.forEach((kind) => kindSel.append(
    Object.assign(document.createElement('option'), { value: kind, textContent: kind })))
  kindSel.value = kinds.includes(chosenKind) ? chosenKind : ''
}

async function load() {
  countEl.textContent = 'loading…'
  const response = await fetch(`/content/player-gallery/launches?lang=${langSel.value}`)
  if (!response.ok) {
    countEl.textContent = `could not load (${response.status})`
    return
  }
  const data = await response.json()
  items = data.items || []
  fillFilters()
  render()
}

;[viewportSel, zoomSel, themeSel, unitSel, kindSel].forEach((control) =>
  control.addEventListener('change', render))
// A language switch refetches, so the card names change language with it.
langSel.addEventListener('change', load)
document.getElementById('gl-reload').addEventListener('click', render)

load()
