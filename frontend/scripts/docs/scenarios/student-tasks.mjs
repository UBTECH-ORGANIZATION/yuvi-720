/* Chapter 5 — the learner's task list and the solve screen. */
export default {
  id: 'student-tasks',
  async run({ base, shoot, page, goto, waitFor }) {
    await goto(page, base, '/tasks')
    await waitFor(page, '.st-wrap')
    await shoot(page, 'list')

    const row = page.locator('.st-row__hit, .st-row a, .st-row button').first()
    if (await row.count()) {
      await row.click().catch(() => {})
      await waitFor(page, '.st-solve', 15000)
      await page.waitForTimeout(1200)
    }
    await shoot(page, 'solve')
  }
}
