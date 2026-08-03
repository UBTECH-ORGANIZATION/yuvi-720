/* Can this provider's activity live inside our lesson frame?
 *
 * Most 720 content can: a static lomda drops into an <iframe> and stays there.
 * Some cannot — a player that authenticates against its own SSO finds no session
 * in a cross-site frame, bounces through its logout/timeout redirect, lands back
 * on itself and starts over, several times a second, forever. The learner sees a
 * strobing lesson and nothing else.
 *
 * Two independent answers, because neither alone is enough:
 *   - the server may already KNOW (`session.embeddable === false`), which spares
 *     the learner even the first flash of the loop;
 *   - and the client watches the frame, so a provider nobody has configured is
 *     still caught — on its own, without a deploy.
 *
 * Kept pure and free of React so it can be tested (`frontend/tests/`), because
 * the failure it guards against is one nobody wants to reproduce by hand.
 */

/** Loads within this window are what we look at. */
export const RELOAD_WINDOW_MS = 15_000
/** …and this many of them is no longer navigation, it is a loop.
 *
 *  Four, not two: content that genuinely paginates (a screen per document) can
 *  legitimately load two or three times while a learner clicks through. The
 *  observed loop runs ~6 loads in 15s, so this sits clear of both. */
export const RELOAD_STORM_COUNT = 4

/** Keep only the loads inside the window ending at `now`. */
export function recentLoads(loads: readonly number[], now: number): number[] {
  return loads.filter((at) => now - at < RELOAD_WINDOW_MS)
}

/** Is the frame reloading itself rather than being navigated? */
export function isReloadStorm(loads: readonly number[], now: number): boolean {
  return recentLoads(loads, now).length >= RELOAD_STORM_COUNT
}

/** Record a load and report whether the frame has started looping. */
export function noteLoad(
  loads: readonly number[],
  now: number,
): { loads: number[]; storm: boolean } {
  const next = recentLoads([...loads, now], now)
  return { loads: next, storm: next.length >= RELOAD_STORM_COUNT }
}

/** Where the activity should be opened.
 *
 *  `frame` is the norm and stays the norm; `tab` is the honest fallback for
 *  content that refuses to be framed. The learner may overrule a client-side
 *  detection (`overrideToFrame`) — if we ever misread ordinary pagination as a
 *  loop, they are one click from the embedded lesson they expected. A server
 *  verdict is not overridable: there we know the frame cannot work at all. */
export function playbackMode(
  serverEmbeddable: boolean | undefined,
  stormDetected: boolean,
  overrideToFrame: boolean,
): 'frame' | 'tab' {
  if (serverEmbeddable === false) return 'tab'
  if (stormDetected && !overrideToFrame) return 'tab'
  return 'frame'
}
