import { useEffect, useState } from 'react'
import { useStudioDesign } from './useStudioDesign'
import { StudioContent } from './StudioContent'
import { navigate } from '../../app/router'
import { useStudioTransition } from './StudioTransitionProvider'

/** Direct-route studio (deep link, or the way back from a game). The animated
 *  entry uses the overlay, which closes onto the page it was opened over. */
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
  // Closing means "leave the studio", never "undo the last navigation": a
  // history.back() here landed the learner inside the game they had just
  // played, because the player sends them to the studio by URL. The dashboard
  // is the one place that is always the right answer.
  const goBack = async () => {
    await transition?.leaveStudio()
    navigate('/student-dashboard', { replace: true })
  }
  return allowed ? <StudioContent studio={studio} onClose={goBack} /> : null
}
