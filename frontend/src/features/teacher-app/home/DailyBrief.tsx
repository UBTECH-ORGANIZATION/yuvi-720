/* The teacher's front door: what changed since they were last here.
 *
 * The dashboard used to open on four numbers and a list, which is a filing
 * cabinet. This is the thing a teacher reads first — one sentence about what
 * moved, two or three lines under it, and the moves they can make about it.
 *
 * It is allowed to be the loudest object on the page, and it is the only one.
 * Everything below it stays in the existing quiet visual language, which is
 * what makes the hierarchy legible rather than merely decorated.
 *
 * Three things keep it honest:
 *
 *   **Every line carries its `because`.** Same contract as the digest it
 *   replaces: a bullet with no cited signal is dropped server-side, and the
 *   teacher can open the raw evidence behind any of them.
 *
 *   **The actions are not the model's idea.** `learner_ids` is assembled
 *   server-side from mastery evidence; the model writes prose about counts and
 *   is never given a child's id. What it can do is suggest — the teacher still
 *   edits and confirms in the same `SubGroupAssign` form the gaps panel uses.
 *
 *   **When there is no AI, there is still a brief.** `source: 'fallback'` means
 *   locale keys over the same aggregates, and the badge says so.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../../../app/router'
import { Icon } from '../../../components/primitives'
import { YuviHeadIcon } from '../../../components/YuviHeadIcon'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import { getDailyBrief, type BriefAction, type DailyBrief as Brief, type DigestBullet }
  from '../../../services/teacher'
import { EvidenceToggle } from '../shared/EvidenceDisclosure'
import { SubGroupAssign } from './SubGroupAssign'
import './daily-brief.css'

export function DailyBriefHero({ groupId }: { groupId: string | null }) {
  const { t, language } = useI18n()
  const { names } = useTeacherRoster()
  const [brief, setBrief] = useState<Brief | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [openAction, setOpenAction] = useState<string | null>(null)
  const heroRef = useRef<HTMLElement | null>(null)
  const [condensed, setCondensed] = useState(false)

  useEffect(() => {
    if (!groupId) { setIsLoading(false); return }
    let active = true
    setIsLoading(true)
    getDailyBrief(groupId, language)
      .then((result) => { if (active) setBrief(result) })
      .catch(() => { if (active) setBrief(null) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [groupId, language])

  /* Condense on scroll via an observer on a sentinel, never a scroll listener:
     a listener on this page fires on every frame of the inbox's own scroll too. */
  useEffect(() => {
    const node = heroRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(entry.intersectionRatio < 0.6),
      { threshold: [0.6] }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [brief])

  async function refresh() {
    if (!groupId || isRefreshing) return
    setIsRefreshing(true)
    try {
      setBrief(await getDailyBrief(groupId, language, true))
    } catch {
      /* keep whatever is on screen — a failed refresh is not a reason to blank */
    } finally {
      setIsRefreshing(false)
    }
  }

  const windowLabel = useMemo(() => {
    if (!brief) return ''
    if (!brief.since) return t('tch.brief.windowFirst')
    const days = brief.window_days
    return days <= 1 ? t('tch.brief.windowToday') : t('tch.brief.windowDays', { days })
  }, [brief, t])

  if (!groupId) return null

  if (isLoading) {
    return (
      <section className="tch-brief is-loading" aria-busy="true">
        <div className="tch-brief__aurora" aria-hidden="true" />
        <div className="tch-brief__inner">
          <span className="tch-brief__eyebrow">
            <YuviHeadIcon width={22} height={22} />
            {t('tch.brief.eyebrow')}
          </span>
          <p className="tch-brief__thinking">{t('tch.brief.loading')}</p>
        </div>
      </section>
    )
  }

  if (!brief || brief.source === 'empty') return null

  return (
    <section
      ref={heroRef}
      className={`tch-brief${condensed ? ' is-condensed' : ''}`}
      aria-label={t('tch.brief.eyebrow')}
      data-tour="teacher.brief"
    >
      {/* Decorative only, and behind everything: three slow blurred blobs.
          `prefers-reduced-motion` stops them dead — see the stylesheet. */}
      <div className="tch-brief__aurora" aria-hidden="true">
        <i /><i /><i />
      </div>

      <div className="tch-brief__inner">
        <header className="tch-brief__head">
          <span className="tch-brief__eyebrow">
            <YuviHeadIcon width={22} height={22} />
            {t('tch.brief.eyebrow')}
            <small>{windowLabel}</small>
          </span>
          <span className="tch-brief__spacer" />
          {/* The badge is not decoration: a teacher acting on a sentence should
              know whether a model wrote it or the aggregates did. */}
          {brief.source === 'fallback' ? (
            <span className="tch-brief__badge">{t('tch.brief.computed')}</span>
          ) : null}
          <button
            type="button"
            className="tch-brief__refresh"
            onClick={() => void refresh()}
            disabled={isRefreshing}
            aria-label={t('tch.brief.refresh')}
            title={t('tch.brief.refresh')}
          >
            <Icon name="reflect" size={15} aria-hidden />
          </button>
        </header>

        {brief.headline ? (
          <h2 className="tch-brief__headline" dir="auto">
            <BulletText bullet={brief.headline} t={t} />
          </h2>
        ) : null}

        {brief.bullets.length ? (
          <ul className="tch-brief__bullets">
            {brief.bullets.map((bullet, index) => (
              <li key={index}>
                <span dir="auto"><BulletText bullet={bullet} t={t} /></span>
                <EvidenceToggle raw={bullet.because?.raw} />
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="tch-brief__stats">
          {brief.stats.filter((stat) => stat.value !== null).map((stat) => (
            <div key={stat.key}>
              <dt>{t(`tch.brief.stat.${stat.key}`)}</dt>
              <dd>
                {stat.value}
                {stat.total != null ? <small>{` / ${stat.total}`}</small> : null}
              </dd>
            </div>
          ))}
        </dl>

        {brief.actions.length ? (
          <div className="tch-brief__actions">
            {brief.actions.map((action) => (
              <ActionButton
                key={actionId(action)}
                action={action}
                isOpen={openAction === actionId(action)}
                onToggle={() => setOpenAction(
                  (current) => (current === actionId(action) ? null : actionId(action))
                )}
                groupId={groupId}
                names={names}
                t={t}
              />
            ))}
          </div>
        ) : null}

        {/* The assignment form opens under the row rather than in a modal: the
            teacher is choosing people and editing a goal, which is a task, not
            a confirmation. */}
        {brief.actions
          .filter((action) => actionId(action) === openAction && action.kind === 'assign_subgroup')
          .map((action) => (
            <div className="tch-brief__form" key={actionId(action)}>
              <SubGroupAssign
                candidates={action.learner_ids}
                id={actionId(action)}
                defaultTitle={t('tch.subgroup.defaultTitle', { label: action.label ?? '' })}
                openLabel={t('tch.brief.assignOpen', { count: action.learner_ids.length })}
                groupId={groupId}
                names={names}
                defaultOpen
              />
            </div>
          ))}
      </div>
    </section>
  )
}

function actionId(action: BriefAction): string {
  return `${action.kind}:${action.objective_id ?? action.filter ?? 'all'}`
}

function ActionButton({
  action, isOpen, onToggle, t,
}: {
  action: BriefAction
  isOpen: boolean
  onToggle: () => void
  groupId: string
  names: Map<string, string | null>
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  if (action.kind === 'open_roster') {
    return (
      <button
        type="button"
        className="tch-brief__action"
        onClick={() => navigate(`/teacher/students?filter=${action.filter ?? 'attention'}`)}
      >
        <Icon name="users" size={15} aria-hidden />
        {t('tch.brief.action.openRoster', { count: action.learner_ids.length })}
      </button>
    )
  }

  return (
    <button
      type="button"
      className={`tch-brief__action${isOpen ? ' is-open' : ''}`}
      aria-expanded={isOpen}
      onClick={onToggle}
    >
      <Icon name="wand" size={15} aria-hidden />
      {t('tch.brief.action.assign', {
        count: action.learner_ids.length, label: action.label ?? '',
      })}
    </button>
  )
}

/** Model text, or a locale key over the same numbers when no model ran. */
function BulletText({
  bullet, t,
}: {
  bullet: DigestBullet
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  if (bullet.text) return <>{bullet.text}</>
  if (!bullet.text_key) return null
  return <>{t(bullet.text_key, (bullet.params ?? {}) as Record<string, string | number>)}</>
}
