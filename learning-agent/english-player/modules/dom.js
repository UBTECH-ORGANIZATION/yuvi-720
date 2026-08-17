/* Line icons and the element helper.
 *
 * Drawn inline because this page can be framed by another platform, so it cannot
 * rely on an icon font or a CDN — and emojis render differently on every device,
 * which is exactly what a learning screen must not do.
 */

export const ICONS = {
  play: '<path d="M8.5 5.6 18.5 12l-10 6.4Z"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2.5"/>',
  slower: '<circle cx="12" cy="12" r="8"/><path d="M12 7.6V12l2.9 1.9"/>',
  transcript: '<rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/><path d="M8.2 9.6h7.6M8.2 13h7.6M8.2 16.2h4.6"/>',
  sound: '<path d="M4.5 9.5h3l4-3.2v11.4l-4-3.2h-3z"/><path d="M15.2 9.3a3.9 3.9 0 0 1 0 5.4"/><path d="M17.7 6.9a7.4 7.4 0 0 1 0 10.2"/>',
  textsize: '<path d="M2.8 18 7.4 6.4 12 18"/><path d="M4.4 14.2h6"/><path d="M14.6 18l2.9-7.4 2.9 7.4"/><path d="M15.7 15.5h3.6"/>',
  contrast: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16Z" fill="currentColor" stroke="none"/>',
  mic: '<rect x="9.3" y="3.4" width="5.4" height="10" rx="2.7"/><path d="M6.2 11.4a5.8 5.8 0 0 0 11.6 0"/><path d="M12 17.3V20.6"/>',
  tip: '<path d="M12 3.6a5.4 5.4 0 0 0-3.2 9.8c.5.4.8 1 .8 1.6h4.8c0-.6.3-1.2.8-1.6A5.4 5.4 0 0 0 12 3.6Z"/><path d="M9.8 17.8h4.4"/><path d="M10.6 20.4h2.8"/>',
  headphones: '<path d="M4.4 14.2v-2.1a7.6 7.6 0 0 1 15.2 0v2.1"/><rect x="3.2" y="13.4" width="4.2" height="6.8" rx="2.1"/><rect x="16.6" y="13.4" width="4.2" height="6.8" rx="2.1"/>',
  book: '<path d="M12 6.6S10 4.9 6.6 4.9H4.2v12.7h2.4C10 17.6 12 19.3 12 19.3s2-1.7 5.4-1.7h2.4V4.9h-2.4C14 4.9 12 6.6 12 6.6Z"/><path d="M12 6.6v12.7"/>',
  pen: '<path d="M4.6 19.4h4L19 9a2.6 2.6 0 0 0-3.6-3.6L4.6 15.4z"/><path d="M14.6 6.6l2.8 2.8"/>',
  think: '<circle cx="12" cy="12" r="8"/><path d="M9.7 9.8a2.4 2.4 0 1 1 3.2 2.3c-.6.2-.9.7-.9 1.3v.4"/><path d="M12 16.5h.01"/>',
  check: '<path d="M5.5 12.4l4.2 4.2 8.8-9"/>',
  alert: '<circle cx="12" cy="12" r="8"/><path d="M12 8.2v4.6"/><path d="M12 15.9h.01"/>',
  retry: '<path d="M19.4 12a7.4 7.4 0 1 1-2.3-5.3"/><path d="M19.6 4.6v4.2h-4.2"/>',
  next: '<path d="M9 5.6 15.4 12 9 18.4"/>',
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'lp-i');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  });
  (Array.isArray(children) ? children : [children]).filter(Boolean).forEach((child) => node.append(child));
  return node;
}

export function setButtonLabel(button, iconName, text) {
  button.replaceChildren(icon(iconName), el('span', { text }));
}

/** Marks a directional icon so RTL mirrors it. */
export function flip(svg) {
  svg.setAttribute('data-flip', '');
  return svg;
}
