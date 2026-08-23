/* A child said something that needs an adult, and what was done about it.
 *
 * This tab exists because the bell had nowhere to send anyone. "התלמיד/ה כתב/ה
 * משהו שדורש תשומת לב של מבוגר" dropped the teacher at the top of a profile
 * with seven tabs and left them to find which sentence it meant — and by the
 * next day the sentence itself could be gone, because the flag lived in a
 * capped array inside the learner's brain document. It is a row of its own now,
 * and this is the screen that row is for.
 *
 * ## What a card says, in the order a teacher needs it
 *
 *   the words · where they were written · what the child was told back ·
 *   who else was rung · who claimed it · what was done · how it was closed
 *
 * "What the child was told back" is not decoration: an adult walking into this
 * conversation has to know the child has already been told to talk to someone
 * they trust, or they will repeat it as if it were news.
 *
 * The conversation around the sentence is deliberately absent. The teacher gets
 * the disclosure, not the transcript — the same boundary the escalation path
 * has always kept.
 *
 * ## The suggestions
 *
 * Three editable openings, asked for only when the teacher presses the button.
 * They are a first sentence for someone standing in a corridor between lessons,
 * never an action: nothing here sends a message or closes anything, and when
 * the model is unreachable the same button returns written fallbacks and says
 * so rather than failing.
 *
 * The protocol line under them is not the model's to phrase. It is a locale
 * string, identical every time, because "if you think the child is in danger,
 * follow the school's procedure now" is not a sentence to let a completion
 * rewrite.
 */

import { useEffect, useRef, useState } from 'react'
import {
  EmptyState, ErrorState, Hint, Icon, Panel, SkeletonCard, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import { navigate } from '../../../app/router'
import { putMessageSeed } from '../messages/messageSeed'
import {
  acknowledgeWellbeingFlag, closeWellbeingFlag, getStudentInsights,
  listWellbeingFlags, logWellbeingAction, reopenWellbeingFlag, suggestWellbeing,
  type StudentInsight, type WellbeingFlag,
} from '../../../services/teacher'
import { ValenceFace } from '../../checkin/ValenceFaces'
import type { Valence } from '../../checkin/feelings'

type Intent = 'message' | 'handle' | 'close'

const ACTION_KINDS = ['spoke', 'called_home', 'referred', 'watching', 'other'] as const
const CLOSE_REASONS = ['handled', 'referred', 'not_relevant'] as const

export function TeacherWellbeing({ learnerId, focusFlagId, fromAlert }: {
  learnerId: string
  /** From the bell's route. Scrolled to and ringed once the rows are in. */
  focusFlagId?: string | null
  /** True when the teacher arrived here from a notification rather than by
   *  clicking the tab. It changes only the empty state, and only because
   *  "nothing to see" is a strange answer to "come and look at this". */
  fromAlert?: boolean
}) {
  const { t, language } = useI18n()
  const { nameOf } = useTeacherRoster()
  const [flags, setFlags] = useState<WellbeingFlag[] | null>(null)
  const [error, setError] = useState(false)
  const focusRef = useRef<HTMLDivElement | null>(null)
  const [ringing, setRinging] = useState(false)

  const refresh = () => {
    listWellbeingFlags(learnerId)
      .then((result) => setFlags(result.flags))
      .catch(() => setError(true))
  }

  useEffect(() => {
    setFlags(null)
    setError(false)
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnerId])

  /* Land ON it. The scroll waits for the rows because the anchor does not exist
     until they render, and the ring is two seconds — long enough to find, short
     enough not to become part of the design. */
  useEffect(() => {
    if (!focusFlagId || !flags?.length) return
    const node = focusRef.current
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setRinging(true)
    const id = setTimeout(() => setRinging(false), 2400)
    return () => clearTimeout(id)
  }, [focusFlagId, flags])

  if (error) {
    return <ErrorState title={t('tch.wellbeing.error')} body={t('tch.wellbeing.errorBody')} />
  }
  if (flags === null) return <SkeletonCard rows={4} />

  if (!flags.length) {
    return (
      <div className="tch-student__body">
        <CheckinStrip learnerId={learnerId} />
        {/* Arriving from a bell that said something happened, to a tab that
            holds nothing, is the exact confusion this whole screen exists to
            end. It is possible for one reason only — a notification older than
            the record store — and saying that beats an empty page. */}
        {fromAlert ? (
          <p className="tch-wellbeing__missing" dir="auto">
            <Icon name="alert" size={15} aria-hidden="true" />
            {t('tch.wellbeing.focusMissing')}
          </p>
        ) : null}
        <EmptyState icon="check" title={t('tch.wellbeing.none')}
                    body={t('tch.wellbeing.noneBody')} />
      </div>
    )
  }

  /* The one the bell was about, if it is still here. A notification can outlive
     nothing now, but it CAN point at a flag from before this store existed, and
     saying so beats a page that silently scrolls nowhere. */
  const focusMissing = Boolean(
    focusFlagId && !flags.some((flag) => flag._id === focusFlagId))

  return (
    <div className="tch-student__body tch-wellbeing">
      <CheckinStrip learnerId={learnerId} />
      {focusMissing ? (
        <p className="tch-wellbeing__missing" dir="auto">
          <Icon name="alert" size={15} aria-hidden="true" />
          {t('tch.wellbeing.focusMissing')}
        </p>
      ) : null}

      {flags.map((flag) => (
        <FlagCard
          key={flag._id}
          flag={flag}
          language={language}
          nameOf={nameOf}
          focused={flag._id === focusFlagId}
          ringing={ringing && flag._id === focusFlagId}
          anchorRef={flag._id === focusFlagId ? focusRef : undefined}
          onChanged={(next) => setFlags((current) => (current ?? []).map(
            (row) => (row._id === next._id ? next : row)))}
          learnerId={learnerId}
          t={t}
        />
      ))}
    </div>
  )
}

function FlagCard({
  flag, language, nameOf, focused, ringing, anchorRef, onChanged, learnerId, t,
}: {
  flag: WellbeingFlag
  language: string
  nameOf: (id: string) => string | null
  focused: boolean
  ringing: boolean
  anchorRef?: React.RefObject<HTMLDivElement | null>
  onChanged: (flag: WellbeingFlag) => void
  learnerId: string
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<null | 'log' | 'close' | 'message'>(null)
  const closed = flag.status === 'closed'

  const when = new Date(flag.at ?? '').toLocaleString(
    language === 'he' ? 'he-IL' : language === 'ar' ? 'ar' : 'en-GB',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  const run = async (work: () => Promise<{ flag: WellbeingFlag }>) => {
    if (busy || flag.legacy) return
    setBusy(true)
    try {
      onChanged((await work()).flag)
    } catch {
      /* The card keeps its state; the teacher can press again. */
    } finally {
      setBusy(false)
    }
  }

  const others = flag.notified
    .map((id) => nameOf(id))
    .filter((name): name is string => Boolean(name))

  return (
    <Panel
      className={`tch-flag${focused ? ' is-focused' : ''}${ringing ? ' is-ringing' : ''}${
        closed ? ' is-closed' : ''}`}
    >
      <div ref={anchorRef} className="tch-flag__anchor" aria-hidden="true" />

      <header className="tch-flag__head">
        <StatusPill tone={closed ? 'neutral' : 'support'}>
          {t(`tch.wellbeing.status.${flag.status}`)}
        </StatusPill>
        <time className="tch-flag__when" dateTime={flag.at}>{when}</time>
      </header>

      {/* Where it was written, in words. The raw `source` key was the only
          answer to "where is this?" and it was behind a "why?" toggle. */}
      <p className="tch-flag__where" dir="auto">
        {t(`tch.wellbeing.source.${flag.source}`)}
        {!flag.delivered ? (
          <span className="tch-flag__blocked">{t('tch.wellbeing.notDelivered')}</span>
        ) : null}
      </p>

      {/* The child's own words, quoted and unedited. */}
      <blockquote className="tch-flag__words" dir="auto">{flag.evidence}</blockquote>

      {flag.reply ? (
        <div className="tch-flag__reply" dir="auto">
          <span className="tch-flag__replyLabel">{t('tch.wellbeing.replyLabel')}</span>
          <p>{flag.reply}</p>
        </div>
      ) : null}

      {others.length ? (
        <p className="tch-flag__notified" dir="auto">
          <Icon name="users" size={14} aria-hidden="true" />
          {t('tch.wellbeing.notified', { names: others.join(', ') })}
        </p>
      ) : null}

      {flag.acknowledged_by ? (
        <p className="tch-flag__claimed" dir="auto">
          <Icon name="check" size={14} aria-hidden="true" />
          {t('tch.wellbeing.claimedBy', {
            name: nameOf(flag.acknowledged_by) ?? flag.acknowledged_by })}
        </p>
      ) : null}

      {flag.actions.length ? (
        <ul className="tch-flag__log">
          {flag.actions.map((entry) => (
            <li key={entry.id} dir="auto">
              <strong>{t(`tch.wellbeing.action.${entry.kind}`)}</strong>
              {entry.text ? <span> — {entry.text}</span> : null}
              <small>
                {nameOf(entry.by) ?? entry.by} ·{' '}
                {new Date(entry.at).toLocaleDateString(
                  language === 'he' ? 'he-IL' : language === 'ar' ? 'ar' : 'en-GB')}
              </small>
            </li>
          ))}
        </ul>
      ) : null}

      {closed ? (
        <p className="tch-flag__closed" dir="auto">
          {t('tch.wellbeing.closedBy', {
            name: nameOf(flag.closed_by ?? '') ?? flag.closed_by ?? '',
            reason: t(`tch.wellbeing.reason.${flag.close_reason}`),
          })}
          {flag.close_note ? <span> — {flag.close_note}</span> : null}
        </p>
      ) : null}

      {/* A row projected out of the old brain array. Readable, but there is no
          record behind it to write an action into, so it says so instead of
          offering buttons that would 404. */}
      {flag.legacy ? (
        <p className="tch-flag__legacy" dir="auto">{t('tch.wellbeing.legacy')}</p>
      ) : (
        /* Every one of these says what it does on hover and on focus. Three of
           the four are shared acts on a record other teachers are looking at —
           claiming it, logging it, closing it — and "does this tell anyone?" is
           not a question to answer by pressing the button and finding out. */
        <div className="tch-flag__actions">
          {!closed ? (
            <>
              {!flag.acknowledged_by ? (
                <Hint text={t('tch.wellbeing.claimHint')}>
                  <button type="button" className="sp-btn sp-btn--sm" disabled={busy}
                          onClick={() => void run(() => acknowledgeWellbeingFlag(flag._id))}>
                    <Icon name="hand" size={15} />
                    {t('tch.wellbeing.claim')}
                  </button>
                </Hint>
              ) : null}
              <Hint text={t('tch.wellbeing.messageHint')}>
                <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                        aria-expanded={panel === 'message'}
                        onClick={() => setPanel(panel === 'message' ? null : 'message')}>
                  <Icon name="message" size={15} />
                  {t('tch.wellbeing.message')}
                </button>
              </Hint>
              <Hint text={t('tch.wellbeing.logHintTip')}>
                <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                        aria-expanded={panel === 'log'}
                        onClick={() => setPanel(panel === 'log' ? null : 'log')}>
                  <Icon name="note" size={15} />
                  {t('tch.wellbeing.log')}
                </button>
              </Hint>
              <Hint text={t('tch.wellbeing.closeHintTip')}>
                <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                        aria-expanded={panel === 'close'}
                        onClick={() => setPanel(panel === 'close' ? null : 'close')}>
                  <Icon name="check" size={15} />
                  {t('tch.wellbeing.close')}
                </button>
              </Hint>
            </>
          ) : (
            <Hint text={t('tch.wellbeing.reopenHint')}>
              <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" disabled={busy}
                      onClick={() => void run(() => reopenWellbeingFlag(flag._id))}>
                <Icon name="reflect" size={15} />
                {t('tch.wellbeing.reopen')}
              </button>
            </Hint>
          )}
        </div>
      )}

      {panel === 'message' ? (
        <MessagePanel flag={flag} learnerId={learnerId} t={t} />
      ) : null}

      {panel === 'log' ? (
        <LogPanel flag={flag} busy={busy} t={t}
                  onSubmit={(kind, text) => void run(
                    () => logWellbeingAction(flag._id, kind, text)).then(() => setPanel(null))} />
      ) : null}

      {panel === 'close' ? (
        <ClosePanel flag={flag} busy={busy} t={t}
                    onSubmit={(reason, note) => void run(
                      () => closeWellbeingFlag(flag._id, reason, note)).then(() => setPanel(null))} />
      ) : null}
    </Panel>
  )
}

/** Three openings and the protocol line, asked for on demand.
 *
 *  Shared by both panels and by the message button: the same shape answers
 *  "what do I say", "what do I do" and "how do I write this up", and which one
 *  is being asked is the only difference.
 */
function Suggestions({ flagId, intent, t, onPick }: {
  flagId: string
  intent: Intent
  t: (key: string, params?: Record<string, string | number>) => string
  onPick?: (text: string) => void
}) {
  const [options, setOptions] = useState<string[] | null>(null)
  const [generated, setGenerated] = useState(true)
  const [busy, setBusy] = useState(false)

  const ask = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await suggestWellbeing(flagId, intent)
      setOptions(result.options)
      setGenerated(result.generated)
    } catch {
      setOptions([])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tch-flag__suggest">
      <button type="button" className="tch-builder__discard" disabled={busy} onClick={() => void ask()}>
        <Icon name="wand" size={14} aria-hidden="true" />
        {busy ? t('tch.wellbeing.suggesting') : t(`tch.wellbeing.suggest.${intent}`)}
      </button>

      {options?.length ? (
        <>
          <ul className="tch-flag__options">
            {options.map((option) => (
              <li key={option}>
                {onPick ? (
                  <button type="button" onClick={() => onPick(option)} dir="auto">{option}</button>
                ) : (
                  <span dir="auto">{option}</span>
                )}
              </li>
            ))}
          </ul>
          {/* Which the teacher is reading. A written fallback presented as a
              considered suggestion would be a small lie about this child. */}
          <small className="tch-flag__suggestNote" dir="auto">
            {t(generated ? 'tch.wellbeing.suggestNote' : 'tch.wellbeing.suggestOffline')}
          </small>
          <small className="tch-flag__protocol" dir="auto">{t('tch.wellbeing.protocol')}</small>
        </>
      ) : options ? (
        <small className="tch-flag__suggestNote" dir="auto">{t('tch.wellbeing.suggestFailed')}</small>
      ) : null}
    </div>
  )
}

/** What to say, and the one place it can honestly be said.
 *
 *  The teacher→child line in this product is the moderated message thread —
 *  not the kudos lane beside it, which is framed as praise and would put "I saw
 *  what you wrote" in a box labelled "a good word". Picking an opening carries
 *  it to that thread, with the child already selected. Nothing is sent by
 *  arriving; the teacher presses send, having read it.
 */
function MessagePanel({ flag, learnerId, t }: {
  flag: WellbeingFlag
  learnerId: string
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const open = (text: string) => {
    putMessageSeed({ learnerId, text })
    navigate('/teacher/messages')
  }
  return (
    <div className="tch-flag__panel">
      <p className="tch-flag__panelLead" dir="auto">{t('tch.wellbeing.messageLead')}</p>
      <Suggestions flagId={flag._id} intent="message" t={t} onPick={open} />
      <div className="tch-flag__panelActions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                onClick={() => navigate('/teacher/messages')}>
          <Icon name="arrow" size={15} />
          {t('tch.wellbeing.messageOpen')}
        </button>
      </div>
    </div>
  )
}

function LogPanel({ flag, busy, t, onSubmit }: {
  flag: WellbeingFlag
  busy: boolean
  t: (key: string, params?: Record<string, string | number>) => string
  onSubmit: (kind: string, text: string) => void
}) {
  const [kind, setKind] = useState<string>('spoke')
  const [text, setText] = useState('')
  return (
    <div className="tch-flag__panel">
      <div className="tch-builder__chips">
        {ACTION_KINDS.map((value) => (
          <button key={value} type="button"
                  className={`tch-chip${kind === value ? ' is-on' : ''}`}
                  aria-pressed={kind === value} onClick={() => setKind(value)}>
            {t(`tch.wellbeing.action.${value}`)}
          </button>
        ))}
      </div>
      <textarea className="sp-input" rows={2} value={text} dir="auto"
                placeholder={t('tch.wellbeing.logHint')}
                onChange={(event) => setText(event.target.value)} />
      <Suggestions flagId={flag._id} intent="handle" t={t}
                   onPick={(option) => setText(option)} />
      <div className="tch-flag__panelActions">
        <button type="button" className="sp-btn sp-btn--sm" disabled={busy}
                onClick={() => onSubmit(kind, text)}>
          {t('tch.wellbeing.logSave')}
        </button>
      </div>
    </div>
  )
}

function ClosePanel({ flag, busy, t, onSubmit }: {
  flag: WellbeingFlag
  busy: boolean
  t: (key: string, params?: Record<string, string | number>) => string
  onSubmit: (reason: string, note: string) => void
}) {
  const [reason, setReason] = useState<string>('')
  const [note, setNote] = useState('')
  return (
    <div className="tch-flag__panel">
      <p className="tch-flag__panelLead" dir="auto">{t('tch.wellbeing.closeLead')}</p>
      <div className="tch-builder__chips">
        {CLOSE_REASONS.map((value) => (
          <button key={value} type="button"
                  className={`tch-chip${reason === value ? ' is-on' : ''}`}
                  aria-pressed={reason === value} onClick={() => setReason(value)}>
            {t(`tch.wellbeing.reason.${value}`)}
          </button>
        ))}
      </div>
      <textarea className="sp-input" rows={2} value={note} dir="auto"
                placeholder={t('tch.wellbeing.closeHint')}
                onChange={(event) => setNote(event.target.value)} />
      <Suggestions flagId={flag._id} intent="close" t={t}
                   onPick={(option) => setNote(option)} />
      <div className="tch-flag__panelActions">
        {/* Closing without a reason is not offered: the reason is the only
            signal that could ever tell a false positive from a handled one. */}
        <button type="button" className="sp-btn sp-btn--sm" disabled={busy || !reason}
                onClick={() => onSubmit(reason, note)}>
          {t('tch.wellbeing.closeSave')}
        </button>
        {!reason ? (
          <small className="tch-flag__panelHint" dir="auto">{t('tch.wellbeing.closeNeedsReason')}</small>
        ) : null}
      </div>
    </div>
  )
}

/* ── the daily check-in strip (#452) ─────────────────────────────────────────
 *
 * Today's feeling, a 14-day valence-dot strip, and the skip streak — read
 * from the same guarded insight payload as the rest of the profile. Additive
 * and quiet: a child with no check-in history renders nothing at all, and a
 * feeling here never escalates anything — it is a conversation opener. */

function CheckinStrip({ learnerId }: { learnerId: string }) {
  const { t, language } = useI18n()
  const [insight, setInsight] = useState<StudentInsight | null>(null)

  useEffect(() => {
    let active = true
    getStudentInsights(learnerId, language)
      .then((data) => { if (active) setInsight(data) })
      .catch(() => {})
    return () => { active = false }
  }, [learnerId, language])

  const history = insight?.checkin_history ?? []
  if (!insight || history.length === 0) return null
  const today = insight.today_feeling
  const streak = insight.checkin_skip_streak ?? 0

  return (
    <Panel className="tch-checkinStrip">
      <h3 className="tch-checkinStrip__title">{t('tch.checkin.title')}</h3>
      <p className="tch-checkinStrip__today" dir="auto">
        {today?.feeling ? (
          <>
            <span className={`tch-checkinStrip__face is-${today.valence}`}>
              <ValenceFace valence={today.valence as Valence} size={22} />
            </span>
            {t('tch.checkin.today', { feeling: t(`checkin.feeling.${today.feeling}`) })}
          </>
        ) : (
          t('tch.checkin.noToday')
        )}
      </p>
      <div className="tch-checkinStrip__days" role="img"
           aria-label={t('tch.checkin.historyAria')}>
        {[...history].reverse().map((day) => (
          <span
            key={day.date}
            className={`tch-checkinStrip__dot${day.valence ? ` is-${day.valence}` : ' is-skipped'}`}
            title={day.valence
              ? `${day.date} · ${t(`checkin.feeling.${day.feeling}`)}`
              : `${day.date} · ${t('tch.checkin.skipped')}`}
          />
        ))}
      </div>
      {streak >= 3 && (
        <p className="tch-checkinStrip__streak" dir="auto">
          <Icon name="alert" size={14} aria-hidden="true" />
          {t('tch.checkin.skipStreak', { count: streak })}
        </p>
      )}
    </Panel>
  )
}
