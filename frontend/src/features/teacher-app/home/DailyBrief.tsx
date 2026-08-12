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
import { useAuth } from '../../../providers/AuthProvider'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import { getDailyBrief, type BriefAction, type BriefBullet, type DailyBrief as Brief }
  from '../../../services/teacher'
import { YuviScene } from '../../../components/yuvi-scenes/YuviScene'
import { propFor } from '../../../components/yuvi-scenes/scenes'
import { ratePercent } from '../learnings/TeacherLearningsPage'
import { countKey } from '../shared/countLabel'
import { BriefBulletRow } from './BriefBulletRow'
import { SubGroupAssign } from './SubGroupAssign'
import './daily-brief.css'

export function DailyBriefHero({ groupId }: { groupId: string | null }) {
  const { t, language } = useI18n()
  const { user } = useAuth()
  const { names } = useTeacherRoster()
  const [brief, setBrief] = useState<Brief | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [openAction, setOpenAction] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
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

  /* Condense on scroll via an observer on a zero-height SENTINEL above the
     hero, never a scroll listener: a listener on this page fires on every frame
     of the inbox's own scroll too.

     The sentinel matters. Observing the hero element itself meant a hero taller
     than the viewport could never reach `intersectionRatio 0.6`, so it rendered
     permanently condensed on a laptop and never condensed on a tall monitor. A
     zero-height marker either is or is not on screen, at any hero height. */
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(!entry.isIntersecting),
      { threshold: [0] }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [brief])

  /* There is no refresh control on this card, deliberately. The brief describes
     a WINDOW — everything since the teacher last logged in — so re-asking for it
     a minute later is the same window and the same answer, at the cost of a
     model call. It reloads when the page does, which is when the window has
     actually moved. `getDailyBrief`'s `force` flag survives for the admin path
     that regenerates one on demand. */

  /* Deterministic, and rendered before the brief resolves.
     A greeting is a lookup, not an inference — asking a model for it would cost
     tokens, a round trip and three chances to get a name wrong in three
     languages, and would make the whole hero blank until generation finished. */
  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
    const name = (user?.display_name || user?.username || '').trim()
    return name
      ? t(`tch.brief.greeting.${part}`, { name })
      : t(`tch.brief.greetingPlain.${part}`)
  }, [user, t])

  const windowLabel = useMemo(() => {
    if (!brief) return ''
    if (!brief.since) return t('tch.brief.windowFirst')
    const days = brief.window_days
    return days <= 1 ? t('tch.brief.windowToday') : t('tch.brief.windowDays', { days })
  }, [brief, t])

  if (!groupId) return null

  /* Everything deterministic renders immediately; only the prose waits. The
     hero used to be one blank block until the generation returned. */
  if (isLoading) {
    return (
      <section className="tch-brief is-loading" aria-busy="true">
        <div className="tch-brief__aurora" aria-hidden="true"><i /><i /><i /></div>
        <div className="tch-brief__inner">
          <span className="tch-brief__eyebrow">
            <YuviHeadIcon width={22} height={22} />
            {t('tch.brief.eyebrow')}
          </span>
          <h2 className="tch-brief__greeting" dir="auto">{greeting}</h2>
          <p className="tch-brief__thinking">{t('tch.brief.loading')}</p>
        </div>
      </section>
    )
  }

  if (!brief || brief.source === 'empty') return null

  return (
    <>
    {/* Zero-height. The observer above watches this, not the hero. */}
    <div ref={sentinelRef} className="tch-brief__sentinel" aria-hidden="true" />
    <section
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
        <div className="tch-brief__prose">
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
        </header>

        <h2 className="tch-brief__greeting" dir="auto">{greeting}</h2>

        {brief.headline ? (
          <p className="tch-brief__headline" dir="auto">
            <BulletText bullet={brief.headline} t={t} />
          </p>
        ) : null}

        {/* The part a teacher actually reads. Model-written, and the only place
            in the card where more than one sentence is allowed. */}
        {brief.summary ? (
          <p className="tch-brief__summary" dir="auto">{brief.summary}</p>
        ) : null}

        {brief.bullets.length ? (
          <ul className="tch-brief__bullets">
            {brief.bullets.map((bullet, index) => (
              <BriefBulletRow key={index} bullet={bullet} t={t} />
            ))}
          </ul>
        ) : null}

        {/* The hero no longer prints its own numbers.
            `brief.stats` is still on the payload — it is the deterministic
            half of the contract and the fallback path is built from it — but
            all three of its values are rendered elsewhere on this page, and
            the KPI strip now sits directly above. Two rows of the same three
            figures, a centimetre apart, is the bug this file's neighbour
            already documents removing once. Numbers belong to the strip;
            the sentence about them belongs here. */}

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

        </div>

        {/* The other half of the card, which used to be empty aurora.
            Not a generated image: the model picked a MOOD from a closed set and
            this draws the matching hand-authored composition. A model asked for
            markup returns off-palette, broken geometry into the most-looked-at
            rectangle in the portal, with nobody reviewing it first.

            A real grid column rather than a positioned panel — in `en` the gap
            is on the other side, and a `left:` would put the robot on top of
            the sentence the moment the teacher switches language. */}
        <div className="tch-brief__scene">
          <YuviScene
            scene={brief.scene}
            prop={propFor(brief.worked_on?.subject)}
            label={t(`tch.brief.scene.${brief.scene ?? 'thinking'}`)}
          />
          {/* The material the class actually spent the window on — already
              computed for the prompt, and discarded before the payload until
              now. It is the one thing on this card no KPI can say. */}
          {/* A lesson name and a percentage, with nothing saying what either
              one is. "פתיחה, הקנייה ותרגול סטנדרטי א · 52% הצלחה" is a
              catalogue title a teacher does not recognise next to a figure that
              could be anything — attendance, completion, a mark. Both get a
              label, and the number says what it counted. */}
          {brief.worked_on?.title ? (
            <div className="tch-brief__worked" dir="auto">
              <span className="tch-brief__workedLabel">{t('tch.brief.workedLabel')}</span>
              <bdi className="tch-brief__workedTitle">{brief.worked_on.title}</bdi>
              {/* `success_rate` is a 0–1 fraction everywhere in this codebase,
                  and every other screen renders it through this one helper.
                  Printed raw it reads "0.516% הצלחה". */}
              {brief.worked_on.success_rate != null ? (
                <span className="tch-brief__workedRate">
                  {brief.worked_on.attempts
                    ? t('tch.brief.workedRateOf', {
                        rate: ratePercent(brief.worked_on.success_rate),
                        attempts: brief.worked_on.attempts,
                      })
                    : t('tch.brief.workedRate', {
                        rate: ratePercent(brief.worked_on.success_rate),
                      })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* The assignment form opens in a centred dialog.
            It used to expand under the row, on the reasoning that choosing
            people and editing a goal is a task rather than a confirmation.
            That reasoning was right about the weight and wrong about the
            placement: a form growing inside the hero pushes the whole
            dashboard down while the teacher fills it in, and the hero is the
            one object on this page that is supposed to hold still. */}
        {brief.actions
          .filter((action) => action.kind === 'assign_subgroup')
          .map((action) => (
            <SubGroupAssign
              key={actionId(action)}
              candidates={action.learner_ids}
              id={actionId(action)}
              defaultTitle={t('tch.subgroup.defaultTitle', { label: action.label ?? '' })}
              groupId={groupId}
              names={names}
              open={openAction === actionId(action)}
              onClose={() => setOpenAction(null)}
            />
          ))}
      </div>
    </section>
    </>
  )
}

function actionId(action: BriefAction): string {
  return `${action.kind}:${action.objective_id ?? action.filter ?? 'all'}`
}

function ActionButton({
  action, isOpen, onToggle, names, t,
}: {
  action: BriefAction
  isOpen: boolean
  onToggle: () => void
  groupId: string
  names: Map<string, string | null>
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  /* At exactly one child the label names them. `t()` has no plural engine, so
     the shared key rendered "משימה ל-1 תלמידים" — and a name is better than a
     fixed singular anyway: a teacher about to write for one child should read
     who, not how many. */
  const count = action.learner_ids.length
  const only = count === 1 ? action.learner_ids[0] : null
  const name = only ? (names.get(only) || only) : ''
  if (action.kind === 'open_roster') {
    return (
      <button
        type="button"
        className="tch-brief__action"
        onClick={() => navigate(`/teacher/students?filter=${action.filter ?? 'attention'}`)}
      >
        <Icon name="users" size={15} aria-hidden />
        {t(countKey('tch.brief.action.openRoster', count), { count, name })}
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
      {t(countKey('tch.brief.action.assign', count), {
        count, name, label: action.label ?? '',
      })}
    </button>
  )
}

/** Model text, or a locale key over the same numbers when no model ran. */
function BulletText({
  bullet, t,
}: {
  bullet: BriefBullet
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  if (bullet.text) return <>{bullet.text}</>
  if (!bullet.text_key) return null
  return <>{t(bullet.text_key, (bullet.params ?? {}) as Record<string, string | number>)}</>
}
