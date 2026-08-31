import { Icon } from '../../../components/primitives'

export type StudioHelpTopic =
  | 'start'
  | 'move'
  | 'furniture'
  | 'change'
  | 'yuvi'
  | 'save'
  | 'firstPerson'
  | 'locked'
  | 'resetCamera'

const TOPICS: StudioHelpTopic[] = ['start', 'move', 'furniture', 'change', 'yuvi', 'save', 'firstPerson', 'locked', 'resetCamera']

export function StudioHelp({
  activeTopic,
  onClose,
  onSelectTopic,
  onCloseTopic,
  t,
}: {
  activeTopic: StudioHelpTopic | null
  onClose: () => void
  onSelectTopic: (topic: StudioHelpTopic) => void
  onCloseTopic: () => void
  t: (key: string) => string
}) {
  return (
    <div className="ys-help__layer">
      <section className="ys-help__menu" id="yuvi-studio-help" aria-label={t('YuviStudio.help.title')}>
        <div className="ys-help__head">
          <strong>{t('YuviStudio.help.title')}</strong>
          <button type="button" className="ys-help__close" onClick={onClose} aria-label={t('YuviStudio.help.close')} title={t('YuviStudio.help.close')}>
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="ys-help__topics">
          {TOPICS.map((topic) => (
            <button
              type="button"
              key={topic}
              className={`ys-help__topic${activeTopic === topic ? ' is-active' : ''}`}
              onClick={() => onSelectTopic(topic)}
            >
              {t(`YuviStudio.help.topic.${topic}`)}
            </button>
          ))}
        </div>
      </section>
      {activeTopic && (
        <aside className="ys-help__bubble" aria-live="polite">
          <button type="button" className="ys-help__close" onClick={onCloseTopic} aria-label={t('YuviStudio.help.closeTopic')} title={t('YuviStudio.help.closeTopic')}>
            <Icon name="close" size={14} />
          </button>
          <strong>{t(`YuviStudio.help.topic.${activeTopic}`)}</strong>
          <p>{t(`YuviStudio.help.body.${activeTopic}`)}</p>
        </aside>
      )}
    </div>
  )
}