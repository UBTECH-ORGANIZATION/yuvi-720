/* Chapter 8 — the mentoring-conversation wizard.

   The wizard is a modal with sequential steps. We advance it by clicking the
   footer's primary action, and we never submit: the last shot is the review
   step, so the capture leaves no goals behind on the seeded learner. */
export default {
  id: 'teacher-goals',
  async run({ base, shoot, page, goto, waitFor }) {
    await goto(page, base, '/teacher/goals')
    await waitFor(page, '.sp-teacher-shell')
    await page.waitForTimeout(1500)
    await shoot(page, 'prep')

    const open = page.locator('.sp-teacher-shell__main button:visible').first()
    if (await open.count()) {
      await open.click().catch(() => {})
      await page.waitForTimeout(1500)
    }
    const modal = ['[class*="composer"]', '[role="dialog"]', '.sp-teacher-shell__main']
    await shoot(page, 'discussed', { selector: modal })

    const advance = async () => {
      const next = page.locator('[role="dialog"] button:visible, [class*="composer"] button:visible').last()
      if (await next.count()) {
        await next.click().catch(() => {})
        await page.waitForTimeout(1500)
      }
    }
    await advance()
    await shoot(page, 'goals-step', { selector: modal })
    await advance()
    await shoot(page, 'review', { selector: modal })
  }
}
