/* Chapter 1 — landing page, login dialog, language switcher, user menu.

   The only chapter that needs two sessions: a signed-in user is redirected off
   `/` (App.tsx `homeFor`), so the three anonymous shots have to be taken before
   any cookie exists. */
export default {
  id: 'getting-started',
  async run({ base, shoot, page, newSession, goto, waitFor }) {
    const anon = await newSession(null)
    await goto(anon.page, base, '/')
    await waitFor(anon.page, '.landing720-login-btn.student')
    await shoot(anon.page, 'landing')

    await anon.page.locator('.landing720-login-btn.student').click()
    await waitFor(anon.page, '.auth-dialog')
    await shoot(anon.page, 'login-dialog', { selector: ['.auth-dialog'] })

    await anon.page.keyboard.press('Escape').catch(() => {})
    await waitFor(anon.page, '.yuvi-language-switcher')
    await shoot(anon.page, 'language-switcher', {
      selector: ['.yuvi-language-switcher', '.yuvi-language-switcher-inline']
    })
    await anon.context.close()

    // Signed in: the user menu lives in the learner app bar.
    await goto(page, base, '/student-dashboard')
    if (await waitFor(page, '.user-menu__trigger')) {
      await page.locator('.user-menu__trigger').first().click()
      await waitFor(page, '.user-menu__pop', 5000)
    }
    await shoot(page, 'user-menu', { selector: ['.user-menu'] })
  }
}
