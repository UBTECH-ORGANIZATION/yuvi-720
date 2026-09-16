/* Chapter 4 — learning portal, a lesson, and the companion. */
export default {
  id: 'learning',
  async run({ base, shoot, page, goto, waitFor }) {
    await goto(page, base, '/learning')
    await waitFor(page, '.learning-catalog-page')
    await shoot(page, 'portal')

    // Open the first goal/track card. Which card that is depends on the seeded
    // learner, which is fine — the guide is showing the shape of the screen.
    const card = page.locator('.learning-catalog-main a:visible, .learning-catalog-main button:visible').first()
    if (await card.count()) {
      await card.click().catch(() => {})
      await page.waitForTimeout(1500)
    }
    await shoot(page, 'goal-lessons', { selector: ['.learning-catalog-main'] })

    const lesson = page.locator('.learning-catalog-main a[href*="/learning/lesson"]').first()
    if (await lesson.count()) {
      await lesson.click().catch(() => {})
      await waitFor(page, '.learning-lesson-page', 20000)
      // The lesson body is third-party content in an iframe; give it a beat
      // rather than waiting on the network, which never goes quiet here.
      await page.waitForTimeout(2500)
    }
    await shoot(page, 'lesson')

    // The companion dock is hidden on the lesson focus surface, so open the
    // chat from a normal learner screen.
    await goto(page, base, '/student-dashboard')
    const dock = page.locator('[class*="companion-dock"] button, button[class*="companion-dock"]').first()
    if (await dock.count()) {
      await dock.click().catch(() => {})
      await page.waitForTimeout(1200)
    }
    await shoot(page, 'companion', { selector: ['.sp-companion', '.sp-companion-slot'] })
  }
}
