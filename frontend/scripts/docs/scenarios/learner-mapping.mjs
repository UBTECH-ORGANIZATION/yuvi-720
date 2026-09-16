/* Chapter 2 — the mapping questionnaire.

   Runs on a learner that has deliberately NOT been marked onboarded
   (`freshLearner` in docs-map.json), because this is the one chapter where the
   onboarding gate is the subject rather than an obstacle. */
export default {
  id: 'learner-mapping',
  async run({ base, shoot, page, goto, waitFor }) {
    await goto(page, base, '/learner-mapping')
    await waitFor(page, '.learner-mapping-page')
    await shoot(page, 'intro')

    // Step into the questionnaire. The intro's call to action is the only
    // primary button on the screen at this point.
    const start = page.locator('.learner-mapping-page button:visible').first()
    if (await start.count()) {
      await start.click().catch(() => {})
      await page.waitForTimeout(1200)
    }
    await shoot(page, 'question', { selector: ['.screen.active', '.learner-mapping-page'] })

    // Answer forward until a reflection interlude appears. Bounded so a change
    // in question count can never turn this into an infinite loop.
    let reflected = false
    for (let i = 0; i < 12 && !reflected; i += 1) {
      const option = page.locator('.screen.active button:visible').first()
      if (!(await option.count())) break
      await option.click().catch(() => {})
      await page.waitForTimeout(900)
      reflected = (await page.locator('.reflection-phase-header').count()) > 0
    }
    await shoot(page, 'reflection', {
      selector: ['.reflection-phase-header', '.screen.active', '.learner-mapping-page']
    })

    // The results screen is reached by finishing the questionnaire, which is
    // far too long to click through. Shoot it directly instead — it renders
    // from saved state, so it is the same screen the learner lands on.
    await goto(page, base, '/results')
    await waitFor(page, '.results-page')
    await shoot(page, 'results', { selector: ['.results-journey', '.results-page'] })
  }
}
