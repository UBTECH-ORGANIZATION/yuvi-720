/**
 * Mode A screen sharing: a masked DOM snapshot plus cursor and scroll updates.
 *
 * This is deliberately not a video feed. It costs almost nothing on a school laptop,
 * it survives a weak connection, and - most importantly - it lets us strip the things
 * a supporter must never see before anything leaves the browser.
 *
 * Masking rules, applied to the clone and never to the live page:
 *   - every input value, textarea body and contenteditable body is replaced
 *   - anything marked `data-support-private` is blanked
 *   - password/e-mail/tel fields are blanked even if empty
 *   - scripts are dropped; the viewer iframe is sandboxed with scripting off anyway
 */

const PRIVATE_ATTR = 'data-support-private'
const MASK = '•••'

export type MaskAction = 'none' | 'blank-value' | 'mask-value' | 'mask-text'

/**
 * The masking rule table, kept free of the DOM so it can be tested directly.
 * `attrs` are lower-cased attribute names as they appear on the element.
 */
export function maskActionFor(tag: string, attrs: Record<string, string | null>): MaskAction {
  if (PRIVATE_ATTR in attrs) return 'mask-text'
  const name = tag.toLowerCase()
  if (name === 'input') {
    const type = (attrs.type ?? 'text').toLowerCase()
    return type === 'checkbox' || type === 'radio' ? 'blank-value' : 'mask-value'
  }
  if (name === 'textarea') return 'mask-text'
  if ((attrs.contenteditable ?? '').toLowerCase() === 'true') return 'mask-text'
  return 'none'
}

function attributesOf(node: Element): Record<string, string | null> {
  const attrs: Record<string, string | null> = {}
  for (const attr of Array.from(node.attributes)) attrs[attr.name.toLowerCase()] = attr.value
  return attrs
}

function maskElement(node: Element): void {
  switch (maskActionFor(node.tagName, attributesOf(node))) {
    case 'blank-value':
      node.setAttribute('value', '')
      node.removeAttribute('placeholder')
      break
    case 'mask-value':
      node.setAttribute('value', MASK)
      node.removeAttribute('placeholder')
      break
    case 'mask-text':
      node.textContent = MASK
      break
    default:
      break
  }
}

function sanitize(root: Document): string {
  const clone = root.documentElement.cloneNode(true) as HTMLElement

  for (const script of clone.querySelectorAll('script, noscript')) script.remove()
  for (const node of clone.querySelectorAll(
    `input, textarea, [contenteditable="true"], [${PRIVATE_ATTR}]`,
  )) {
    maskElement(node)
  }

  // Relative asset URLs resolve against the portal origin otherwise.
  const base = clone.querySelector('base') ?? document.createElement('base')
  base.setAttribute('href', window.location.origin + '/')
  clone.querySelector('head')?.prepend(base)

  return `<!doctype html>${clone.outerHTML}`
}

export interface DomStreamHandle {
  stop(): void
}

/**
 * Starts streaming. `send` is called with a wire type and payload that match what the
 * supporter portal's DOM viewer expects.
 */
export function startDomStream(
  send: (type: string, payload: Record<string, unknown>) => void,
): DomStreamHandle {
  let stopped = false

  const snapshot = (): void => {
    if (stopped) return
    send('dom.snapshot', {
      html: sanitize(document),
      width: window.innerWidth,
      height: window.innerHeight,
    })
  }

  let pending: Record<string, unknown>[] = []
  const flush = (): void => {
    if (stopped || pending.length === 0) return
    send('dom.events', { events: pending })
    pending = []
  }

  const onPointer = (event: PointerEvent): void => {
    pending.push({ kind: 'cursor', x: event.clientX, y: event.clientY })
  }
  const onScroll = (): void => {
    pending.push({
      kind: 'scroll',
      top: window.scrollY,
      left: window.scrollX,
    })
  }

  // A full re-snapshot on structural change is cheap enough at 1 Hz and avoids an
  // incremental-patch protocol that would drift out of sync after one dropped frame.
  let dirty = false
  const observer = new MutationObserver(() => {
    dirty = true
  })
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  })

  window.addEventListener('pointermove', onPointer, { passive: true })
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', snapshot)

  snapshot()
  const eventTimer = window.setInterval(flush, 200)
  const snapshotTimer = window.setInterval(() => {
    if (!dirty) return
    dirty = false
    snapshot()
  }, 1000)

  return {
    stop() {
      stopped = true
      observer.disconnect()
      window.clearInterval(eventTimer)
      window.clearInterval(snapshotTimer)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', snapshot)
    },
  }
}
