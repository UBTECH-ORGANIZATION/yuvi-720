import { useEffect, useRef } from 'react'
import { initDashboard } from './dashboardApp'
import skeleton from './skeleton.html?raw'
import dashboardCss from './dashboard.css?inline'

/**
 * Student dashboard (720 Feature 4).
 *
 * This is a 1:1 migration of the original student-dashboard page. The exact
 * markup, CSS, imperative logic, and the real Three.js Yubi robot are reused;
 * React owns routing and mounting. The page CSS is injected only while this
 * route is mounted so its global class names (.top-bar, .journey, .chat-body,
 * ...) never collide with the mapping/results routes.
 */
export function StudentDashboardPage() {
  const didInit = useRef(false)

  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-scope', 'student-dashboard')
    style.textContent = dashboardCss
    document.head.appendChild(style)

    if (!didInit.current) {
      didInit.current = true
      initDashboard()
    }

    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, [])

  return <div dangerouslySetInnerHTML={{ __html: skeleton }} />
}
