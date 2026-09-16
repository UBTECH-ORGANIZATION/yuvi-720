/* Chapter 6 — goals, the mentoring trail, and badges.
   Captured on `goalLearner`, the seeded learner that actually has goals. */
export default {
  id: 'mentoring',
  async run({ base, shoot, page, goto, waitFor }) {
    await goto(page, base, '/mentoring')
    await waitFor(page, '.sp-learner-shell')
    await page.waitForTimeout(1200)
    await shoot(page, 'goals')

    await shoot(page, 'conversation', {
      selector: ['[class*="journey-trail"]', '[class*="journey"]']
    })

    await goto(page, base, '/badges')
    await waitFor(page, '.badges-page')
    await shoot(page, 'badges')
  }
}
