/* Chapter 7 — teacher home, the roster, and one student's card. */
export default {
  id: 'teacher-home',
  async run({ base, shoot, page, goto, waitFor }) {
    await goto(page, base, '/teacher')
    await waitFor(page, '.sp-teacher-shell')
    await page.waitForTimeout(1500)
    await shoot(page, 'home')

    await goto(page, base, '/teacher/students')
    await page.waitForTimeout(1500)
    await shoot(page, 'students')

    const student = page.locator('.sp-teacher-shell__main a[href^="/teacher/student/"]').first()
    if (await student.count()) {
      await student.click().catch(() => {})
    } else {
      // Roster rows are not always links; fall back to the first clickable row.
      const row = page.locator('.sp-teacher-shell__main tbody tr, .sp-teacher-shell__main [class*="student"] button').first()
      if (await row.count()) await row.click().catch(() => {})
    }
    await page.waitForTimeout(2000)
    await shoot(page, 'student-profile')
  }
}
