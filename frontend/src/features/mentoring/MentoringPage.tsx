import { useEffect, useRef } from 'react'
import { initMentoring } from './mentoringApp'
import skeleton from './skeleton.html?raw'
import mentoringCss from './mentoring.css?inline'

/**
 * Mentoring (720 Feature 5).
 *
 * 1:1 migration of the original mentoring page. The exact markup, CSS, and
 * imperative logic are reused; React owns routing and mounting. The page CSS is
 * injected only while this route is mounted so its global class names never
 * collide with other routes.
 */
export function MentoringPage() {
  const didInit = useRef(false)

  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-scope', 'mentoring')
    style.textContent = mentoringCss
    document.head.appendChild(style)

    if (!didInit.current) {
      didInit.current = true
      initMentoring()
    }

    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, [])

  return <div dangerouslySetInnerHTML={{ __html: skeleton }} />
}
