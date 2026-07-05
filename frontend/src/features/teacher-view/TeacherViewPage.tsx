import { useEffect, useRef } from 'react'
import { initTeacherView } from './teacherViewApp'
import skeleton from './skeleton.html?raw'
import teacherViewCss from './teacherView.css?inline'

/**
 * Teacher view (720 Feature 6).
 *
 * 1:1 migration of the original teacher-view page. The exact markup, CSS, and
 * imperative logic are reused; React owns routing and mounting. The page CSS is
 * injected only while this route is mounted so its global class names
 * (.topbar, .chat-body, .panel, .pane, ...) never collide with other routes.
 */
export function TeacherViewPage() {
  const didInit = useRef(false)

  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-scope', 'teacher-view')
    style.textContent = teacherViewCss
    document.head.appendChild(style)

    if (!didInit.current) {
      didInit.current = true
      initTeacherView()
    }

    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, [])

  return <div dangerouslySetInnerHTML={{ __html: skeleton }} />
}
