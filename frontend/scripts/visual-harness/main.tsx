import { createRoot } from 'react-dom/client'
import SceneRenderer from '../../src/features/visuals/SceneRenderer'
import fixtures from './fixtures.json'

const cases = Object.entries(fixtures as Record<string, any>)
createRoot(document.getElementById('root')!).render(
  <>
    {cases.map(([name, visual]) => (
      <div className="case" key={name} data-case={name}>
        <h3>{name} — {visual.renderer}</h3>
        <SceneRenderer visual={visual} />
      </div>
    ))}
  </>,
)
