import { useEffect, useState } from 'react'
import { useStudioDesign } from './useStudioDesign'
import { StudioContent } from './StudioContent'
import { navigate } from '../../app/router'
import { useStudioTransition } from './StudioTransitionProvider'

/** Direct-route studio (e.g. deep link). The animated entry uses the overlay. */
export function YuviStudioPage() {
  const studio = useStudioDesign(true)
  const transition = useStudioTransition()
  const enterStudio = transition?.enterStudio
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    if (!enterStudio) return
    void enterStudio().then((time) => {
      if (time.allowed) setAllowed(true)
      else navigate('/student-dashboard', { replace: true })
    })
  }, [enterStudio])
  const goBack = async () => {
    await transition?.leaveStudio()
    if (window.history.length > 1) window.history.back()
    else navigate('/student-dashboard')
  }
  return allowed ? <StudioContent studio={studio} onClose={goBack} /> : null
}
