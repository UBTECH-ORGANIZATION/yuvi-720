import { Icon } from '../../../components/primitives'

export type StudioHelpTopic =
  | 'start'
  | 'move'
  | 'furniture'
  | 'change'
  | 'yuvi'

const TOPICS: StudioHelpTopic[] = ['start', 'move', 'furniture', 'change', 'yuvi']
const TOPIC_ICONS: Record<StudioHelpTopic, string> = {
  start: 'compass', move: 'click', furniture: 'sofa', change: 'wand', yuvi: 'spark',
}

export function StudioHelp({
  activeTopic,
  onClose,
  onSelectTopic,
  onCloseTopic,
  onOpenRoomDesign,
  onOpenYuviDesign,
  t,
}: {
  activeTopic: StudioHelpTopic | null
  onClose: () => void
  onSelectTopic: (topic: StudioHelpTopic) => void
  onCloseTopic: () => void
  onOpenRoomDesign: () => void
  onOpenYuviDesign: () => void
  t: (key: string) => string
}) {
  return (
    <div className="ys-help__layer">
      <section className="ys-help__menu" id="yuvi-studio-help" aria-label={t('YuviStudio.help.title')}>
        <div className="ys-help__topics">
          {TOPICS.map((topic) => (
            <div className={`ys-help__topic-anchor${activeTopic === topic ? ' is-active' : ''}`} key={topic}>
              <button
                type="button"
                className="ys-help__topic"
                onClick={() => onSelectTopic(topic)}
              >
                <Icon name={TOPIC_ICONS[topic]} size={17} />
                <span>{t(`YuviStudio.help.topic.${topic}`)}</span>
              </button>
              {activeTopic === topic && (
                <aside className="ys-help__bubble" aria-live="polite">
                  <button type="button" className="ys-help__close" onClick={onCloseTopic} aria-label={t('YuviStudio.help.closeTopic')} title={t('YuviStudio.help.closeTopic')}>
                    <Icon name="close" size={14} />
                  </button>
                  <strong>{t(`YuviStudio.help.topic.${topic}`)}</strong>
                  <p>{t(`YuviStudio.help.body.${topic}`)}</p>
                  {topic === 'furniture' && (
                    <button type="button" className="ys-help__action" onClick={onOpenRoomDesign}>
                      <Icon name="home" size={15} />
                      <span>{t('YuviStudio.help.action.room')}</span>
                    </button>
                  )}
                  {topic === 'yuvi' && (
                    <button type="button" className="ys-help__action" onClick={onOpenYuviDesign}>
                      <Icon name="spark" size={15} />
                      <span>{t('YuviStudio.help.action.yuvi')}</span>
                    </button>
                  )}
                </aside>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="ys-help__dismiss" onClick={onClose} aria-label={t('YuviStudio.help.close')} title={t('YuviStudio.help.close')}>
          <Icon name="close" size={14} />
        </button>
      </section>
    </div>
  )
}