import { useEffect, useRef } from 'react'
import { initLearningPortal } from './app'
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
  const didInit = useRef(false)

  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-scope', 'learning-portal')
    style.textContent = portalCss
    document.head.appendChild(style)

    if (!didInit.current) {
      didInit.current = true
      initLearningPortal()
    }

    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, [])

  return <div dangerouslySetInnerHTML={{ __html: skeleton }} />
}
