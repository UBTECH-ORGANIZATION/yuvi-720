import { Icon } from './primitives'
import { useI18n } from '../i18n/I18nProvider'
import type { VisualMode } from '../services/agents'

/** "Show me a video / image" buttons shown under a text-only Yuvi reply, so the
 * learner can ask for a visual explanation even when one wasn't produced.
 * Presentational only — the caller owns the request + loading state. Shared by
 * the floating companion chat and the learning-map topic chat. */
export function VisualCTA({
  failed,
  onRequest,
}: {
  failed?: boolean
  onRequest: (mode: VisualMode) => void
}) {
  const { t } = useI18n()
  return (
    <div className="sp-visual-cta">
      <span className="sp-visual-cta__label" dir="auto">
        {failed ? t('companion.visualCta.failed') : t('companion.visualCta.prompt')}
      </span>
      <div className="sp-visual-cta__buttons">
        <button type="button" className="sp-visual-cta__btn" onClick={() => onRequest('video')}>
          <Icon name="play" size={14} />
          <span>{t('companion.visualCta.video')}</span>
        </button>
        <button type="button" className="sp-visual-cta__btn" onClick={() => onRequest('image')}>
          <Icon name="image" size={14} />
          <span>{t('companion.visualCta.image')}</span>
        </button>
      </div>
    </div>
  )
}
