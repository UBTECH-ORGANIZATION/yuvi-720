/* Chapter 3 — the student dashboard, section by section. */
export default {
  id: 'student-dashboard',
  async run({ base, shoot, page, goto, waitFor }) {
    await goto(page, base, '/student-dashboard')
    await waitFor(page, '.sd-page')
    await shoot(page, 'overview')

    await shoot(page, 'activeness', {
      selector: ['[class*="aweb"]', '.sd-dashboard section:nth-of-type(2)']
    })
    await shoot(page, 'goals', {
      selector: ['[class*="sd-goals"]', '[class*="my-goals"]']
    })
    await shoot(page, 'subjects', {
      selector: ['[class*="sd-subjects"]', '[class*="my-subjects"]']
    })
  }
}
