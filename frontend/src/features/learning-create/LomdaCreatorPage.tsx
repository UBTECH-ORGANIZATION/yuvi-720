import { useEffect, useRef } from 'react'
import { initLomdaCreator } from './app'
import skeleton from './skeleton.html?raw'
import createCss from './create.css?inline'

/**
 * Lomda creator / generator (720 Feature 3, chrome).
 *
 * 1:1 migration of learning-agent/create.html. React owns routing/mounting; the
 * generated lomda output stays self-contained HTML rendered via iframe srcdoc
 * (per 720 content standards). Page CSS is injected only while this route is
 * mounted.
 */
export function LomdaCreatorPage() {
  const didInit = useRef(false)

  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-scope', 'learning-create')
    style.textContent = createCss
    document.head.appendChild(style)

    if (!didInit.current) {
      didInit.current = true
      initLomdaCreator()
    }

    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, [])

  return <div dangerouslySetInnerHTML={{ __html: skeleton }} />
}
