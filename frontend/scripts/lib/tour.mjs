/* Shared by every browser check that signs somebody in.
 *
 * The spotlight tour opens by itself the first time an account reaches the app
 * it belongs to — the teacher app since Phase 8, and now the student dashboard
 * too — and its scrim deliberately swallows clicks. That is correct product
 * behaviour and must NOT be disabled for tests, so the checks do what a person
 * does: get past it, then get on with the job.
 *
 * Two ways past, because the two tours differ on purpose. A teacher may leave
 * whenever they like, so Escape closes theirs. A child's first run has no way
 * out but finishing it — no skip, no close, and Escape does nothing — so the
 * only honest way through is to click Next until it ends, which is exactly what
 * the child has to do.
 *
 * Skipping rather than failing when it is absent keeps the helper safe to call
 * unconditionally: on a second run the account has already completed the tour.
 */
export async function dismissTourIfOpen(page, { timeout = 8000 } = {}) {
  const card = await page.waitForSelector('.sp-tour__card', { timeout })
    .then(() => true).catch(() => false)
  if (!card) return false

  await page.keyboard.press('Escape')
  const closed = await page.waitForSelector('.sp-tour__overlay', {
    state: 'detached', timeout: 2000,
  }).then(() => true).catch(() => false)
  if (closed) return true

  // Bounded: a tour that will not end is a failure the calling check should
  // surface through its own assertions, not a hang in a shared helper.
  for (let i = 0; i < 40; i += 1) {
    const next = page.locator('.sp-tour__actions .sp-btn--primary')
    if (!(await next.count())) break
    await next.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(450)
  }
  await page.waitForSelector('.sp-tour__overlay', { state: 'detached', timeout: 5000 })
    .catch(() => {})
  return true
}
