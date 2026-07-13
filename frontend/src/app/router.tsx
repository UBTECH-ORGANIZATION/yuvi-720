import { useEffect, useState } from 'react'

export function navigate(path: string) {
  if (`${window.location.pathname}${window.location.search}` === path) return
  window.history.pushState({}, '', path)
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
