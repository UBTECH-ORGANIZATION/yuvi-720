/* The daily check-in (#452) opens once per learner per ISRAELI day, over
 * whatever learner page is visited first — which, on the first harness run of
 * a day, is a modal sitting on top of whatever a script wants to assert.
 *
 * Worse, the demo accounts are SHARED: whichever script runs first dismisses
 * it and the rest go green in that order only. So every learner sign-in path
 * calls this.
 *
 * The helper asks the API first whether a dialog is even coming — the gate
 * fetches /pending and may spend seconds in /start (the step-0 question can
 * involve a model call), so "not visible yet" proves nothing. When one is
 * due it WAITS for it, then Escapes: Escape records "skip remaining"
 * server-side, so the day's doc closes and no other script in the run sees
 * the dialog again. Not-a-learner sessions and disabled environments return
 * immediately.
 *
 * (Backends can also set DAILY_CHECKIN_DISABLED=1 to keep the gate shut for
 * an environment.) */

export async function dismissCheckin(page, { patience = 24 } = {}) {
  let due = false
  try {
    const response = await page.request.get(
      new URL('/api/me/checkin/pending', page.url()).toString())
    due = response.ok() ? (await response.json())?.due === true : false
  } catch {
    return false
  }
  if (!due) return false
  // Due — but the gate only opens after onboarding is done, so for accounts
  // parked in onboarding this loop simply runs out and that is fine.
  //
  // The dialog's own skip button, NOT Escape: the shared Modal ignores Escape
  // while any non-hidden [role=tooltip] exists in the DOM, and the dashboard
  // keeps one around. The top-left `.ck-skipTop` bails the whole dialog in
  // one click and records skip-remaining; the ghost fallback covers any step
  // that renders without it.
  for (let round = 0; round < patience; round += 1) {
    if (await page.locator('.ck-root').count().catch(() => 0)) {
      await page.locator('.ck-root .ck-skipTop, .ck-root .ck-btn--ghost').first()
        .click({ timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(600)
      if (!(await page.locator('.ck-root').count().catch(() => 0))) return true
      continue
    }
    await page.waitForTimeout(500)
  }
  return false
}
