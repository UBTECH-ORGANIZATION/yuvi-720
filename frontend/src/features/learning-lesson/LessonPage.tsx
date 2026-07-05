import { useEffect, useRef } from 'react'
import { initLessonPlayer } from './app'
import skeleton from './skeleton.html?raw'
import lessonCss from './lesson.css?inline'

/**
 * Lesson player (720 Feature 3, chrome).
 *
 * 1:1 migration of learning-agent/lesson.html. React owns routing/mounting;
 * page CSS is injected only while this route is mounted.
 */
export function LessonPage() {
  const didInit = useRef(false)

  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-scope', 'learning-lesson')
    style.textContent = lessonCss
    document.head.appendChild(style)

    if (!didInit.current) {
      didInit.current = true
      initLessonPlayer()
    }

    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, [])

  return <div dangerouslySetInnerHTML={{ __html: skeleton }} />
}
