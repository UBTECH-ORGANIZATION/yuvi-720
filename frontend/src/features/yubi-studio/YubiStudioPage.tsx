import { useStudioDesign } from './useStudioDesign'
import { StudioContent } from './StudioContent'
import { navigate } from '../../app/router'

/** Direct-route studio (e.g. deep link). The animated entry uses the overlay. */
export function YubiStudioPage() {
  const studio = useStudioDesign(true)
  const goBack = () => {
    if (window.history.length > 1) window.history.back()
    else navigate('/student-dashboard')
  }
  return <StudioContent studio={studio} onClose={goBack} />
}
