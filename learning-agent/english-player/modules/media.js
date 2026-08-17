/* Images, built so they never move the page under a tapping finger.
 *
 * `width`/`height` are always written out even though CSS resizes the picture:
 * they give the browser the aspect ratio before a single byte arrives, so the
 * box is reserved from the first paint. Without them a screen re-flows the
 * moment the image lands, which on a phone means the option a learner is
 * reaching for slides out from under their thumb.
 *
 * Loading is `eager` and decoding `async` on purpose. These are small, they are
 * same-origin, they are served immutable, and the player preloads the next
 * screen's — so by the time a screen is shown its picture is already in cache.
 * Lazy-loading here would trade an invisible cost for a visible one.
 */

import { el } from './dom.js';
import { pick } from './i18n.js';

/** The path a payload `src` resolves to. Content-hashed, hence cacheable. */
export const mediaUrl = (src) => `/content/player-assets/media/${String(src).replace(/^\/+/, '')}`;

export function mediaImage(media, { sizes, className = 'lp-img' } = {}) {
  if (!media?.src) return null;
  return el('img', {
    class: className,
    src: mediaUrl(media.src),
    srcset: media.srcset
      ? media.srcset.split(',').map((entry) => {
        const [file, descriptor] = entry.trim().split(/\s+/);
        return `${mediaUrl(file)}${descriptor ? ` ${descriptor}` : ''}`;
      }).join(', ')
      : null,
    sizes: media.srcset ? (media.sizes || sizes) : null,
    width: media.width,
    height: media.height,
    // Never empty: in an image MCQ the picture IS the option, so a learner on a
    // screen reader who loses it loses the question rather than a decoration.
    alt: pick(media.alt),
    decoding: 'async',
    loading: 'eager',
  });
}

/** Every image URL on a screen, for warming the next one's cache. */
export function screenMedia(item) {
  const sources = [(item?.presentation || {}).image];
  (item?.questions || []).forEach((question) => {
    sources.push(question.image);
    Object.values(question.answerMedia || {}).forEach((media) => sources.push(media));
    (question.prompts || []).forEach((prompt) => sources.push(prompt.media));
  });
  return sources.filter((media) => media?.src).map((media) => mediaUrl(media.src));
}

const warmed = new Set();

/** Pull the next screen's pictures down while the learner reads this one.
 *
 * The point of the whole imagery pipeline is that a picture is THERE when its
 * screen arrives — an image that fades in late is worse than no image, because
 * it moves the page under a learner who has already started reading. Combined
 * with immutable caching, a screen's second visit costs nothing at all.
 */
export function preload(item) {
  screenMedia(item).forEach((url) => {
    if (warmed.has(url)) return;
    warmed.add(url);
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = url;
    document.head.append(link);
  });
}
