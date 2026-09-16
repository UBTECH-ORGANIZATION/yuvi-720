/* Chapter 10 — learnings, calendar, messages. Three plain page captures. */
export default {
  id: 'teacher-followup',
  async run({ base, shoot, page, goto, waitFor }) {
    for (const [path, slug] of [
      ['/teacher/learnings', 'learnings'],
      ['/teacher/calendar', 'calendar'],
      ['/teacher/messages', 'messages']
    ]) {
      await goto(page, base, path)
      await waitFor(page, '.sp-teacher-shell')
      await page.waitForTimeout(1800)
      await shoot(page, slug)
    }
  }
}
