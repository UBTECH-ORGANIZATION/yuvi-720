import { useEffect, useState } from 'react'

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (`${window.location.pathname}${window.location.search}` === path) return
  // `replace` is for automatic redirects: it keeps the route we bounced away
  // from out of history, so Back doesn't land on it and bounce again.
  if (options.replace) window.history.replaceState({}, '', path)
  else window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): string {
  const [pathname, setPathname] = useState(`${window.location.pathname}${window.location.search}`)

  useEffect(() => {
    const onPopState = () => setPathname(`${window.location.pathname}${window.location.search}`)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  return pathname
}
