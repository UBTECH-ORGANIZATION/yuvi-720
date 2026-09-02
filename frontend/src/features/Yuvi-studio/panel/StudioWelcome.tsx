import { Icon } from '../../../components/primitives'

export function StudioWelcome({
  scene, copy, onContinue,
}: {
  scene: number
  copy: { title: string; body: string; avatar: string; room: string; action?: string }
  onContinue: () => void
}) {
  return (
    <aside className="ys-welcome" role="dialog" aria-label={copy.title}>
      <div className="ys-welcome__copy">
        <span className="ys-welcome__eyebrow"><Icon name="spark" size={15} /> {copy.title}</span>
        <p>{copy.body}</p>
        {copy.action && (
          <button type="button" className="ys-btn ys-btn--primary" onClick={onContinue}>
            {copy.action}
            <Icon name="arrow" size={16} />
          </button>
        )}
      </div>
      <div className="ys-welcome__markers" aria-hidden="true">
        <span className={scene >= 2 ? 'is-active' : ''}><Icon name="spark" size={15} /> {copy.avatar}</span>
        <span className={scene >= 1 ? 'is-active' : ''}><Icon name="home" size={15} /> {copy.room}</span>
      </div>
    </aside>
  )
}