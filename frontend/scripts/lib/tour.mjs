/* Shared by every teacher-facing browser check.
 *
 * Since Phase 8 the spotlight tour opens by itself the first time an account
 * reaches the teacher app, and its scrim deliberately swallows clicks. That is
 * correct product behaviour and must NOT be disabled for tests — so the checks
 * do what a teacher does: dismiss it, then get on with the job.
 *
 * Skipping rather than failing when it is absent keeps the helper safe to call
 * unconditionally: on a second run the account has already completed the tour.
 */
export async function dismissTourIfOpen(page, { timeout = 8000 } = {}) {
  const card = await page.waitForSelector('.sp-tour__card', { timeout })
    .then(() => true).catch(() => false)
  if (!card) return false
  await page.keyboard.press('Escape')
  await page.waitForSelector('.sp-tour__overlay', { state: 'detached', timeout: 5000 })
    .catch(() => {})
  return true
}
