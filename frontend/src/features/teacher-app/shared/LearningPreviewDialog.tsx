/* The teacher's own window into a lomda: the content in an iframe, nothing
 * else — no coach, no chat, no tracking (the launch the server mints reports
 * into a sink; see `learning_sessions.create_preview_launch`). A dialog rather
 * than a route so closing it lands the teacher exactly where they were —
 * mid-list or mid-profile.
 *
 * Mounted from the learnings list (every card) and the learning detail page.
 * The caller owns which component is being previewed; `null` means closed.
 */

import { useEffect, useState } from 'react'
import { Icon, Skeleton } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { previewLearning, type LearningPreview } from '../../../services/teacher'

export function LearningPreviewDialog({
  componentId, title, onClose,
}: {
  /** Which lomda to show; null keeps the dialog closed. */
  componentId: string | null
  /** The name the opener already shows — the payload title is only a fallback. */
  title?: string | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const [view, setView] = useState<LearningPreview | null>(null)
  const [failed, setFailed] = useState(false)
  /* Bumped to remount the iframe. The content is the vendor's own player,
     and it locks its "check" button after a wrong answer until the marked
     item is fixed — a teacher skimming slides hits that wall on a misclick
     (#510). A restart is the teacher's way out that never leaves the page. */
  const [run, setRun] = useState(0)

  useEffect(() => {
    if (!componentId) return
    let alive = true
    setView(null)
    setFailed(false)
    setRun(0)
    previewLearning(componentId)
      .then((payload) => { if (alive) setView(payload) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [componentId])

  return (
    <Modal
      open={componentId !== null}
      onClose={onClose}
      titleId="tch-preview-title"
      className="tch-preview__modal"
    >
      <div className="tch-preview__head">
        <h2 id="tch-preview-title" dir="auto">
          {title || view?.title || t('tch.learnings.preview')}
        </h2>
        <div className="tch-preview__acts">
          {view?.embeddable ? (
            <>
              <button
                type="button"
                className="sp-btn sp-btn--ghost sp-btn--sm"
                onClick={() => setRun((value) => value + 1)}
                title={t('tch.learnings.previewRestartHint')}
              >
                <Icon name="refresh" size={15} aria-hidden />
                {t('tch.learnings.previewRestart')}
              </button>
              <a
                href={view.player_url}
                target="_blank"
                rel="noreferrer"
                className="sp-btn sp-btn--ghost sp-btn--sm"
                title={t('tch.learnings.previewOpenTab')}
                aria-label={t('tch.learnings.previewOpenTab')}
              >
                <Icon name="external" size={15} aria-hidden />
              </a>
            </>
          ) : null}
          <button
            type="button"
            className="sp-btn sp-btn--ghost sp-btn--sm"
            onClick={onClose}
            aria-label={t('tch.learnings.previewClose')}
          >
            <Icon name="close" size={16} aria-hidden />
          </button>
        </div>
      </div>
      {failed ? (
        <p className="tch-preview__error" role="alert">{t('tch.learnings.previewError')}</p>
      ) : !view ? (
        <div className="tch-preview__loading" aria-busy="true">
          <Skeleton w="100%" h="100%" />
        </div>
      ) : view.embeddable ? (
        <iframe
          key={run}
          className="tch-preview__frame"
          src={view.player_url}
          title={title || view.title}
          allow="fullscreen"
        />
      ) : (
        /* A provider re-blocked by configuration still gets an honest door. */
        <p className="tch-preview__error">
          <a href={view.player_url} target="_blank" rel="noreferrer" className="sp-btn sp-btn--ghost">
            {t('tch.learnings.previewOpenTab')}
          </a>
        </p>
      )}
    </Modal>
  )
}
