/* Chapter 9 — the task lifecycle on the teacher side.
   Stops before launching: the builder is opened and shot, never submitted. */
export default {
  id: 'teacher-tasks',
  async run({ base, shoot, page, goto, waitFor }) {
    await goto(page, base, '/teacher/tasks')
    await waitFor(page, '.sp-teacher-shell')
    await page.waitForTimeout(1500)
    await shoot(page, 'list')

    const create = page.locator('.sp-teacher-shell__main button:visible').first()
    if (await create.count()) {
      await create.click().catch(() => {})
      await page.waitForTimeout(1500)
    }
    await shoot(page, 'create', {
      selector: ['[class*="builder"]', '[role="dialog"]', '.sp-teacher-shell__main']
    })
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(600)

    const task = page.locator('.sp-teacher-shell__main a[href*="/teacher/tasks/"]').first()
    const href = (await task.count()) ? await task.getAttribute('href') : null
    if (href) {
      const id = href.split('/teacher/tasks/')[1]?.split('/')[0]
      if (id) {
        await goto(page, base, `/teacher/tasks/${id}/review`)
        await page.waitForTimeout(1800)
        await shoot(page, 'review')
        await goto(page, base, `/teacher/tasks/${id}`)
        await page.waitForTimeout(1800)
        await shoot(page, 'tracking')
        return
      }
    }
    // No task to open — still emit the two frames so the chapter's images
    // resolve; they will show the list, and the PR review will catch it.
    console.warn('   ⚠️ teacher-tasks: no existing task to open for review/tracking')
    await shoot(page, 'review')
    await shoot(page, 'tracking')
  }
}
