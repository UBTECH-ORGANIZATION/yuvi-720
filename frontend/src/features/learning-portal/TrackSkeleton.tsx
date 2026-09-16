import { Icon, Skeleton } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type { LearningSubject } from '../../services/learning'
import './simple-track.css'

/**
 * The track screen before its catalog has arrived.
 *
 * Same skeleton of markup as `SimpleTrackView` — header, resume card, goal
 * grid — so nothing moves when the data lands. Everything the screen knows
 * without the server is real text: the subtitle, the "continue here" eyebrow,
 * the goals heading. Only what the catalog decides (which lesson is next, how
 * many goals, their names and states) is sketched. A spinner in the middle of
 * an empty page said "wait"; this says "here is the screen, it is filling in".
 *
 * The subject name is known on a re-fetch (a retry, a learner change) and
 * unknown on the first visit, where it is one more sketched line.
 */
export function TrackSkeleton({ subject, goals = 3 }: { subject: LearningSubject | null; goals?: number }) {
  const { t } = useI18n()
  return (
    <div
      className="lt-track lt-track--loading"
      role="status"
      aria-busy="true"
      aria-label={t('learning.loading.title')}
      data-track-subject={subject ?? 'none'}
    >
      <header className="lt-head">
        <h1 id="learning-track-title">
          {subject ? t(`learning.subject.${subject}`) : <Skeleton w="7ch" h="1lh" />}
        </h1>
        <p>{t(`learning.track.subtitle.${subject ?? 'other'}`)}</p>
      </header>

      <section className="lt-resume lt-resume--loading">
        <div className="lt-resume__copy">
          <span className="lt-resume__eyebrow">
            <Icon name="play" size={14} />
            {t('learning.track.resume.eyebrow')}
          </span>
          <h2><Skeleton w="min(22ch, 100%)" h="1lh" /></h2>
          <div className="lt-resume__meta">
            <Skeleton w="9ch" h="1lh" />
          </div>
        </div>
        <Skeleton w={168} h={50} r="var(--sp-radius-pill)" />
      </section>

      <section className="lt-goals">
        <div className="lt-goals__head">
          <h2 id="learning-track-goals-title">{t('learning.track.topics.title')}</h2>
          <p>{t('learning.track.topics.body')}</p>
        </div>
        <ul className="lt-goals__grid">
          {Array.from({ length: goals }, (_, index) => (
            <li key={index}>
              <div className="lt-goal lt-goal--loading">
                <Skeleton w={44} h={44} r="var(--sp-radius-md)" />
                <Skeleton w={index % 2 ? '58%' : '76%'} h={20} />
                <span className="lt-goal__meta">
                  <Skeleton w={72} h={22} r="var(--sp-radius-pill)" />
                  <Skeleton w={64} h={14} />
                </span>
                <span className="lt-meter" aria-hidden="true" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
