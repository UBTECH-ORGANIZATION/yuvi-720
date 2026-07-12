import { useEffect, useLayoutEffect } from 'react'
import { initLearningPortal } from './app'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { ThemeSwitcher } from '../../components/ThemeSwitcher'
import skeleton from './skeleton.html?raw'
import portalCss from './portal.css?inline'

/**
 * Learning portal / roadmap (720 Feature 3, chrome).
 *
 * 1:1 migration of learning-agent/index.html. React owns routing/mounting; the
 * interactive game stays a self-contained iframe document at /learning/game.html
 * (per 720 content standards for iframe/lomda content). Page CSS is injected
 * only while this route is mounted to avoid global class-name collisions.
 */
export function LearningPortalPage() {
  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-scope', 'learning-portal')
    style.textContent = portalCss
    document.head.appendChild(style)

    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, [])

  useLayoutEffect(() => {
    const startPortal = () => {
      const grid = document.getElementById('subjectsGrid')
      if (!grid || grid.dataset.portalInitialized === 'true') return
      grid.dataset.portalInitialized = 'true'
      try {
        initLearningPortal()
      } catch (error) {
        console.error('Learning portal initialization failed:', error)
        grid.innerHTML = '<div class="portal-error">לא הצלחנו לטעון את מסלולי הלמידה כרגע.</div>'
      }
    }

    startPortal()
  }, [])

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: skeleton }} />
      <div className="learning-navbar-language">
        <ThemeSwitcher />
        <LanguageSwitcher />
      </div>
    </>
  )
}
