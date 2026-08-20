/* The messages screen — the teacher's line to each student, in one place.
 *
 * This file used to open with a paragraph explaining that a free-form 1:1
 * channel with a minor was excluded by design, because it "needs a moderation
 * and retention policy this product does not claim to have". That policy now
 * exists and is enforced in code — `services/direct_messages.py` screens every
 * message before it is stored, denies rather than queues, keeps an audit row,
 * and escalates a child's distress to a teacher alert. So the exclusion is
 * lifted and the reasoning that justified it is recorded here rather than
 * deleted: the channel is open BECAUSE the screen exists, not instead of it.
 *
 * Four sources land in one thread, chronologically:
 *
 *   הודעה       → the direct channel, both directions. Chat bubbles.
 *   מילה טובה   → delivered by Yuvi in the kid's own chat, in Yuvi's voice.
 *   עדכון        → a shared note; rings the student's bell.
 *   יעדים        → assignments and approvals appear as system lines.
 *
 * The plain composer sends a MESSAGE. Kudos and notes moved behind a "+" —
 * they are the occasional acts, and making the everyday one the default is what
 * a teacher expects from something shaped like a chat.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  EmptyState, ErrorState, Icon, Skeleton, SkeletonRows,
} from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { formatMessageTime } from '../../../hooks/messageTime'
import { useI18n } from '../../../i18n/I18nProvider'
import { takeMessageSeed } from './messageSeed'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import { useTeacherLive } from '../../../providers/TeacherLiveProvider'
import { PresenceDot, agoLabel } from '../live/LiveNow'
import {
  createTeacherInsight, getGroupSnapshot, getStudentGoals, getStudentKudos,
  listTeacherInsights, sendKudos, type Subgroup,
} from '../../../services/teacher'
import {
  MessageRefused, getTeacherUnread, listMessages, listSubgroupBroadcasts,
  markMessagesRead, sendMessage, sendSubgroupMessage, type SubgroupBroadcast,
} from '../../../services/directMessages'
import { subscribe } from '../../../services/realtime'
import './teacher-messages.css'
import { StudentAvatar } from '../shared/StudentAvatar'
import { useDismiss } from '../shared/useDismiss'

interface ThreadEvent {
  key: string
  kind: 'message_out' | 'message_in' | 'kudos' | 'note' | 'goal_assigned' | 'goal_approved'
  at: string
  text: string
  /** kudos only: Yuvi has already spoken it in the kid's chat. */
  delivered?: boolean
}

/** What the "+" menu opens. The plain composer is not a mode — it is the
 *  default, and giving it a chip alongside the others is what made the everyday
 *  action look like one option among three. */
type ExtraLane = 'kudos' | 'note'

export function TeacherMessagesPage() {
  const { t, language } = useI18n()
  /* The provider's list — the rail's sub-group THREADS are addresses, not the
     scope narrowing, so `sub:` selection stays this page's own. */
  const {
    groupId, isLoading: scopeLoading, subgroups, subgroupId, subgroupLearnerIds,
  } = useTeacherScope()
  const live = useTeacherLive()

  const [students, setStudents] = useState<{ learner_id: string; display_name: string | null }[] | null>(null)
  const [error, setError] = useState(false)
  /* One selection across two kinds of correspondent. A sub-group is prefixed so
     an id can never be mistaken for a learner's — the rail holds both. */
  const [selected, setSelected] = useState<string | null>(null)
  /* Arriving from a disclosure: the child to write to, and the opening the
     teacher picked. Read once, here, so the rail's default selection does not
     overwrite it a moment later when the roster lands. */
  const [seed] = useState(() => takeMessageSeed())
  /* Arriving from a toast or a notification: `?student=` names the thread to
     open. Read once for the same reason as the seed. */
  const [urlStudent] = useState(() =>
    new URLSearchParams(window.location.search).get('student'))
  /* WhatsApp-style: which threads hold messages the teacher has not read.
     Seeded from the counters, zeroed locally the moment a thread opens (the
     server is told by the thread's own mark-read), bumped by live frames. */
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({})
  /* Bumped when the OPEN thread receives a live message, so it refetches. */
  const [threadNonce, setThreadNonce] = useState(0)
  const selectedRef = useRef<string | null>(null)
  useEffect(() => { selectedRef.current = selected }, [selected])

  useEffect(() => {
    let active = true
    getTeacherUnread()
      .then((result) => { if (active) setUnreadMap(result.unread ?? {}) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!groupId) return
    // The same stream the live provider holds — refcounted, so this adds a
    // handler, not a connection.
    return subscribe(
      `teacher-live:${groupId}`,
      () => `/api/teacher/stream?group_id=${encodeURIComponent(groupId)}`,
      (frame) => {
        if (frame.type !== 'direct_message' || frame.sender !== 'learner') return
        const from = String(frame.learner_id || '')
        if (from && from === selectedRef.current) {
          setThreadNonce((value) => value + 1)   // the open thread shows it
        } else if (from) {
          setUnreadMap((current) => ({ ...current, [from]: (current[from] ?? 0) + 1 }))
        }
      })
  }, [groupId])

  useEffect(() => {
    if (!groupId) return
    let active = true
    setStudents(null)
    getGroupSnapshot(groupId, language)
      .then((snapshot) => {
        if (!active) return
        const rows = snapshot.students ?? []
        setStudents(rows)
        setSelected((current) => {
          // The child the teacher came here to write to wins over both the
          // previous selection and the first row of the rail; a `?student=`
          // deep link (a toast, the bell) is the same intent said by address.
          if (seed && rows.some((row) => row.learner_id === seed.learnerId)) {
            return seed.learnerId
          }
          if (urlStudent && rows.some((row) => row.learner_id === urlStudent)) {
            return urlStudent
          }
          return current && rows.some((row) => row.learner_id === current)
            ? current
            : rows[0]?.learner_id ?? null
        })
      })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [groupId, language, seed])

  if (scopeLoading || (students === null && !error)) {
    return (
      <div className="tch-messages" aria-busy="true">
        {/* Real header, skeleton rail and thread — the two-column frame is the
            same one the loaded page uses, so nothing shifts on arrival. */}
        <header className="tch-messages__head">
          <h1>{t('tch.messages.title')}</h1>
          <p className="tch-messages__subtitle">{t('tch.messages.subtitle')}</p>
        </header>
        {/* The same two-pane frame, filled with quiet lines — not two cards
            stacked on top of each other, which is what a `Panel` holding two
            `SkeletonCard`s collapsed into below 900px. */}
        <div className="tch-messages__layout">
          <div className="tch-messages__people">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="tch-messages__person" aria-hidden="true">
                <Skeleton w={30} h={30} r="50%" />
                <span className="tch-messages__personText">
                  <Skeleton w={110} h={13} />
                  <Skeleton w={64} h={11} />
                </span>
              </div>
            ))}
          </div>
          <div className="tch-messages__thread" aria-hidden="true">
            <SkeletonRows rows={7} />
          </div>
        </div>
      </div>
    )
  }
  if (error) return <ErrorState title={t('tch.error')} />
  if (!groupId || !students?.length) return <EmptyState title={t('tch.noGroups')} />

  const nameOf = (learnerId: string) =>
    students.find((row) => row.learner_id === learnerId)?.display_name ?? learnerId

  return (
    <div className="tch-messages">
      <header className="tch-messages__head">
        <h1>{t('tch.messages.title')}</h1>
        <p className="tch-messages__subtitle">{t('tch.messages.subtitle')}</p>
      </header>

      <div className="tch-messages__layout" data-tour="teacher.messages">
        {/* ── who ─────────────────────────────────────────────────────────── */}
        <nav className="tch-messages__people" aria-label={t('tch.messages.pickAria')}>
          {/* The named groups first, because they are the shortcut: "tell the
              six who are stuck" was six identical sends before this. */}
          {subgroups.length ? (
            <p className="tch-messages__railHead">{t('tch.messages.groups')}</p>
          ) : null}
          {subgroups.map((subgroup) => (
            <button
              key={subgroup.id}
              type="button"
              className={`tch-messages__person tch-messages__person--group${
                selected === `sub:${subgroup.id}` ? ' is-active' : ''}`}
              onClick={() => setSelected(`sub:${subgroup.id}`)}
            >
              <span className="tch-messages__groupIcon" aria-hidden="true">
                <Icon name="users" size={16} />
              </span>
              <span className="tch-messages__personText">
                <span dir="auto">{subgroup.name}</span>
                <small>{t('tch.messages.groupSize', { count: subgroup.size })}</small>
              </span>
            </button>
          ))}

          {subgroups.length ? (
            <p className="tch-messages__railHead">{t('tch.messages.students')}</p>
          ) : null}
          {/* The scope's sub-group narrows WHO IS LISTED, not who is reachable:
              the group threads above stay, and clearing the scope brings the
              rest of the class back. Derived per render — never copied. */}
          {(subgroupId
            ? students.filter((row) => subgroupLearnerIds.includes(row.learner_id))
            : students).map((student) => {
            const presence = live.presence[student.learner_id] ?? null
            return (
              <button
                key={student.learner_id}
                type="button"
                className={`tch-messages__person${selected === student.learner_id ? ' is-active' : ''}${
                  unreadMap[student.learner_id] ? ' has-unread' : ''}`}
                onClick={() => {
                  setSelected(student.learner_id)
                  // Opening reads it; the thread tells the server, this tells
                  // the rail — waiting for a refetch leaves a lying badge.
                  setUnreadMap((current) => {
                    if (!current[student.learner_id]) return current
                    const next = { ...current }
                    delete next[student.learner_id]
                    return next
                  })
                }}
              >
                <StudentAvatar
                  learnerId={student.learner_id}
                  name={student.display_name ?? student.learner_id}
                  size={30}
                />
                <span className="tch-messages__personText">
                  <span dir="auto">{student.display_name ?? student.learner_id}</span>
                  <small>{agoLabel(presence?.last_seen_at ?? null, t)}</small>
                </span>
                {unreadMap[student.learner_id] ? (
                  <span className="tch-messages__unread"
                        aria-label={t('tch.messages.unread', {
                          count: unreadMap[student.learner_id] })}>
                    {unreadMap[student.learner_id] > 99 ? '99+' : unreadMap[student.learner_id]}
                  </span>
                ) : null}
                <PresenceDot presence={presence} />
              </button>
            )
          })}
        </nav>

        {/* ── the thread ──────────────────────────────────────────────────── */}
        {selected?.startsWith('sub:') ? (
          <SubgroupThread
            key={selected}
            subgroup={subgroups.find((row) => row.id === selected.slice(4)) ?? null}
            nameOf={nameOf}
          />
        ) : selected ? (
          <Thread key={selected} learnerId={selected} name={nameOf(selected)}
                  reloadNonce={threadNonce}
                  opening={seed?.learnerId === selected ? seed.text : undefined} />
        ) : (
          <EmptyState title={t('tch.messages.pick')} />
        )}
      </div>
    </div>
  )
}

/* Saying one thing to a named group.
 *
 * Not a room. Every copy lands in that child's own thread with this teacher, so
 * the whole existing contract survives untouched: membership is re-checked per
 * recipient, the words are screened, and a child's reply comes back privately.
 * A shared channel where children read each other is a different product with a
 * different safety model, and this screen deliberately is not it — which is why
 * the composer says out loud where the message will arrive.
 */
function SubgroupThread({ subgroup, nameOf }: {
  subgroup: Subgroup | null
  nameOf: (learnerId: string) => string
}) {
  const { t, language } = useI18n()
  const [sentSoFar, setSentSoFar] = useState<SubgroupBroadcast[] | null>(null)
  const [draft, setDraft] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [failed, setFailed] = useState<'refused' | 'network' | null>(null)
  const [refusalKey, setRefusalKey] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const subgroupId = subgroup?.id ?? null

  const load = useCallback(() => {
    if (!subgroupId) return
    let active = true
    listSubgroupBroadcasts(subgroupId)
      .then((rows) => { if (active) setSentSoFar(rows) })
      .catch(() => { if (active) setSentSoFar([]) })
    return () => { active = false }
  }, [subgroupId])

  useEffect(() => { setSentSoFar(null); return load() }, [load])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [sentSoFar])

  if (!subgroup) return <EmptyState title={t('tch.messages.pick')} />

  async function send() {
    const message = draft.trim()
    if (!message || isBusy || !subgroupId) return
    setIsBusy(true)
    setFailed(null)
    setRefusalKey(null)
    try {
      await sendSubgroupMessage(subgroupId, message, language)
      setDraft('')
      load()
    } catch (error) {
      // Same three outcomes as the 1:1 composer, and the draft survives all of
      // them — a refused message that vanishes makes the writer reconstruct it.
      if (error instanceof MessageRefused) {
        setFailed('refused')
        setRefusalKey(error.key)
      } else {
        setFailed('network')
      }
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className="tch-thread" aria-label={subgroup.name}>
      <header className="tch-thread__head">
        <strong dir="auto">{subgroup.name}</strong>
        <span className="tch-thread__members" dir="auto">
          {subgroup.learner_ids.map(nameOf).join(' · ')}
        </span>
      </header>

      {/* Where this actually arrives. A teacher typing into something labelled
          with a group's name will assume a group chat unless told otherwise,
          and the difference matters to what they write. */}
      <p className="tch-thread__how">
        <Icon name="handoff" size={13} aria-hidden />
        {t('tch.messages.groupHow')}
      </p>

      <div className="tch-thread__body" ref={bodyRef}>
        {sentSoFar === null ? (
          <div aria-busy="true"><SkeletonRows rows={3} /></div>
        ) : sentSoFar.length ? (
          sentSoFar.map((broadcast) => (
            <article key={broadcast.broadcast_id} className="tch-thread__event tch-thread__event--message_out">
              <div className="tch-thread__bubble">
                <p dir="auto">{broadcast.text}</p>
                <span className="tch-thread__meta">
                  {broadcast.unread === 0
                    ? t('tch.messages.groupAllRead', { count: broadcast.recipients.length })
                    : t('tch.messages.groupUnread', {
                        read: broadcast.recipients.length - broadcast.unread,
                        count: broadcast.recipients.length,
                      })}
                </span>
              </div>
              <time className="tch-thread__time" dateTime={broadcast.created_at}>
                {formatMessageTime(broadcast.created_at, language)}
              </time>
            </article>
          ))
        ) : (
          <p className="tch-thread__empty">{t('tch.messages.groupEmpty', { name: subgroup.name })}</p>
        )}
      </div>

      <form
        className="tch-thread__composer"
        onSubmit={(event) => { event.preventDefault(); void send() }}
      >
        <div className="tch-thread__inputRow">
          <input
            value={draft}
            dir="auto"
            placeholder={t('tch.messages.groupPlaceholder', { count: subgroup.size })}
            aria-label={t('tch.messages.groupPlaceholder', { count: subgroup.size })}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="tch-dock__send"
            disabled={!draft.trim() || isBusy || subgroup.size === 0}
            aria-label={t('tch.messages.send')}
            title={t('tch.messages.send')}
          >
            <Icon name="send" size={17} aria-hidden />
          </button>
        </div>
        {failed ? (
          <p className={`tch-thread__failed${failed === 'refused' ? ' is-refused' : ''}`}
             role="status">
            {failed === 'refused'
              ? t(refusalKey || 'moderation.default')
              : t('tch.messages.sendFailed')}
          </p>
        ) : null}
      </form>
    </section>
  )
}

function Thread({ learnerId, name, opening, reloadNonce = 0 }: {
  learnerId: string
  name: string
  /** A sentence carried in from elsewhere — a suggested opening the teacher
   *  picked while reading a disclosure. Editable, and never sent by arriving. */
  opening?: string
  /** Bumped by the page when a live message lands in THIS thread. */
  reloadNonce?: number
}) {
  const { t, language } = useI18n()
  const [events, setEvents] = useState<ThreadEvent[] | null>(null)
  const [draft, setDraft] = useState(opening ?? '')
  const [isBusy, setIsBusy] = useState(false)
  const [failed, setFailed] = useState<'refused' | 'network' | null>(null)
  const [refusalKey, setRefusalKey] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [lane, setLane] = useState<ExtraLane | null>(null)

  const bodyRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useDismiss(menuRef, menuOpen, () => setMenuOpen(false))

  /* Where "unread" begins — the WhatsApp bar. Captured once, on the thread's
     FIRST load: mark-read fires right below, so any later reload would find
     nothing unread and silently take the bar away while the teacher is still
     scrolling up to it. `'unset'` distinguishes "not yet computed" from
     "computed: nothing was unread". */
  const unreadFrom = useRef<string | null | 'unset'>('unset')

  const load = useCallback(() => {
    let active = true
    Promise.all([
      listMessages(learnerId).catch(() => [] as Awaited<ReturnType<typeof listMessages>>),
      getStudentKudos(learnerId).catch(() => ({ kudos: [] })),
      listTeacherInsights(learnerId).catch(() => ({ insights: [] })),
      getStudentGoals(learnerId).catch(() => ({ conversations: [] })),
    ]).then(([messages, kudos, insights, goals]) => {
      if (!active) return
      if (unreadFrom.current === 'unset') {
        const firstUnread = messages.find(
          (message) => message.sender === 'learner' && !message.read_at)
        unreadFrom.current = firstUnread ? `m:${firstUnread.id}` : null
      }
      const rows: ThreadEvent[] = []
      for (const message of messages) {
        rows.push({
          key: `m:${message.id}`,
          kind: message.sender === 'teacher' ? 'message_out' : 'message_in',
          at: message.created_at ?? '',
          text: message.text,
        })
      }
      for (const row of kudos.kudos) {
        rows.push({
          key: `k:${row.id}`,
          kind: 'kudos',
          at: row.created_at ?? '',
          text: row.message,
          delivered: Boolean(row.delivered_at),
        })
      }
      for (const insight of insights.insights) {
        if (insight.visibility !== 'shared') continue
        rows.push({
          key: `n:${insight._id}`, kind: 'note',
          at: insight.created_at, text: insight.text,
        })
      }
      for (const conversation of goals.conversations) {
        for (const goal of conversation.goals ?? []) {
          if (!goal.title) continue
          if (conversation.author === 'teacher') {
            rows.push({
              key: `g:${goal.id}`, kind: 'goal_assigned',
              at: conversation.date ?? '', text: goal.title,
            })
          }
          if (goal.approved_at) {
            rows.push({
              key: `a:${goal.id}`, kind: 'goal_approved',
              at: goal.approved_at, text: goal.title,
            })
          }
        }
      }
      rows.sort((a, b) => (a.at || '').localeCompare(b.at || ''))
      setEvents(rows)
      // Opening a thread reads it. The badge is about "did the teacher look",
      // and by here they are looking.
      void markMessagesRead(learnerId).catch(() => {})
    })
    return () => { active = false }
  }, [learnerId])

  useEffect(() => { setEvents(null); return load() }, [load])
  // A live arrival in the open thread: refetch in place (no skeleton flash).
  useEffect(() => { if (reloadNonce) return load() }, [reloadNonce, load])

  /* Latest at the bottom, which no version of this screen did — the thread grew
     downwards behind the fold and a teacher opened a conversation looking at
     its oldest line. Same effect the assistant dock uses. */
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [events])

  async function send() {
    const message = draft.trim()
    if (!message || isBusy) return
    setIsBusy(true)
    setFailed(null)
    setRefusalKey(null)
    try {
      await sendMessage(learnerId, message, language)
      setDraft('')
      load()
    } catch (error) {
      /* The draft is deliberately NOT cleared on failure. The reference's
         optimistic flow emptied the input before the request resolved, so a
         refused message was simply gone and the writer had to remember what
         they had said. A refusal and a dropped connection also say different
         things — one is about the words, the other is not. */
      if (error instanceof MessageRefused) {
        setFailed('refused')
        setRefusalKey(error.key)
      } else {
        setFailed('network')
      }
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className="tch-thread" aria-label={name}>
      <header className="tch-thread__head">
        <strong dir="auto">{name}</strong>
        <button
          type="button"
          className="sp-btn sp-btn--ghost sp-btn--sm"
          onClick={() => navigate(`/teacher/student/${learnerId}`)}
        >
          {t('tch.attention.open')}
        </button>
      </header>

      {/* Honest about the medium, and now about the screen: what is typed here
          reaches the child directly, and is checked before it is sent. */}
      <p className="tch-thread__how">
        <Icon name="handoff" size={13} aria-hidden />
        {t('tch.messages.how')}
      </p>

      <div className="tch-thread__body" ref={bodyRef}>
        {events === null ? (
          <div aria-busy="true"><SkeletonRows rows={4} /></div>
        ) : events.length ? (
          events.map((event) => (
            <Fragment key={event.key}>
            {event.key === unreadFrom.current && (
              <p className="tch-thread__unreadBar" role="separator">
                {t('tch.messages.unreadFromHere')}
              </p>
            )}
            <article className={`tch-thread__event tch-thread__event--${event.kind}`}>
              {event.kind === 'message_out' || event.kind === 'message_in' ? (
                <>
                  <div className="tch-thread__bubble">
                    <p dir="auto">{event.text}</p>
                  </div>
                  <time className="tch-thread__time" dateTime={event.at}>
                    {formatMessageTime(event.at, language)}
                  </time>
                </>
              ) : event.kind === 'kudos' || event.kind === 'note' ? (
                /* Bubble, then the clock underneath it — the same shape and the
                   same Israel-time formatter the child sees in their own chat,
                   so both sides of a conversation agree on when it happened. */
                <>
                  <div className="tch-thread__bubble">
                    <p dir="auto">{event.text}</p>
                    <span className="tch-thread__meta">
                      {event.kind === 'kudos'
                        ? event.delivered
                          ? t('tch.messages.deliveredByYuvi')
                          : t('tch.messages.waitingForYuvi')
                        : t('tch.messages.sentToBell')}
                    </span>
                  </div>
                  <time className="tch-thread__time" dateTime={event.at}>
                    {formatMessageTime(event.at, language)}
                  </time>
                </>
              ) : (
                <>
                  <div className="tch-thread__system">
                    <Icon name="target" size={13} aria-hidden />
                    <span dir="auto">
                      {t(event.kind === 'goal_assigned'
                        ? 'tch.messages.goalAssigned'
                        : 'tch.messages.goalApproved', { title: event.text })}
                    </span>
                  </div>
                  <time className="tch-thread__time tch-thread__time--system" dateTime={event.at}>
                    {formatMessageTime(event.at, language)}
                  </time>
                </>
              )}
            </article>
            </Fragment>
          ))
        ) : (
          <p className="tch-thread__empty">{t('tch.messages.empty', { name })}</p>
        )}
      </div>

      <form
        className="tch-thread__composer"
        onSubmit={(event) => { event.preventDefault(); void send() }}
      >
        <div className="tch-thread__inputRow">
          {/* The occasional acts, one level down. */}
          <div className="tch-thread__more" ref={menuRef}>
            <button
              type="button"
              className="tch-thread__moreBtn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('tch.messages.more')}
              title={t('tch.messages.more')}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name="plus" size={17} aria-hidden />
            </button>
            {menuOpen ? (
              <div className="tch-thread__menu" role="menu">
                <button
                  type="button" role="menuitem"
                  onClick={() => { setMenuOpen(false); setLane('kudos') }}
                >
                  <Icon name="spark" size={14} aria-hidden />
                  {t('tch.messages.mode.kudos')}
                </button>
                <button
                  type="button" role="menuitem"
                  onClick={() => { setMenuOpen(false); setLane('note') }}
                >
                  <Icon name="bell" size={14} aria-hidden />
                  {t('tch.messages.mode.note')}
                </button>
              </div>
            ) : null}
          </div>

          <input
            value={draft}
            dir="auto"
            placeholder={t('tch.messages.placeholder.message')}
            aria-label={t('tch.messages.placeholder.message')}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="tch-dock__send"
            disabled={!draft.trim() || isBusy}
            aria-label={t('tch.messages.send')}
            title={t('tch.messages.send')}
          >
            <Icon name="send" size={17} aria-hidden />
          </button>
        </div>
        {failed ? (
          <p className={`tch-thread__failed${failed === 'refused' ? ' is-refused' : ''}`}
             role="status">
            {failed === 'refused'
              ? t(refusalKey || 'moderation.default')
              : t('tch.messages.sendFailed')}
          </p>
        ) : null}
      </form>

      <ExtraLaneDialog
        lane={lane}
        learnerId={learnerId}
        name={name}
        onClose={() => setLane(null)}
        onSent={() => { setLane(null); load() }}
      />
    </section>
  )
}

/* Kudos and shared notes, each in its own labelled dialog.
 *
 * They used to be two chips that silently changed what the one input did, so
 * the same box sent praise or a bell notification depending on a control above
 * it — and the placeholder was the only thing that said which. A compose flow
 * with its own consequences gets its own surface (Phase 3's rule, applied to
 * the last two places that still worked the old way). */
function ExtraLaneDialog({ lane, learnerId, name, onClose, onSent }: {
  lane: ExtraLane | null
  learnerId: string
  name: string
  onClose: () => void
  onSent: () => void
}) {
  const { t, language } = useI18n()
  const [text, setText] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  // Reset per opening: a half-typed kudos must not reappear inside the note
  // dialog the next time the menu is used.
  useEffect(() => { setText(''); setFailed(false) }, [lane])

  if (!lane) return null

  async function submit() {
    const body = text.trim()
    if (!body || isBusy) return
    setIsBusy(true)
    setFailed(false)
    try {
      if (lane === 'kudos') {
        await sendKudos(learnerId, body, language)
      } else {
        await createTeacherInsight(learnerId, {
          kind: 'note', text: body, visibility: 'shared',
        })
      }
      onSent()
    } catch {
      setFailed(true)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} titleId="tch-lane-title" className="tch-laneDialog">
      <h2 id="tch-lane-title" className="tch-laneDialog__title">
        <Icon name={lane === 'kudos' ? 'spark' : 'bell'} size={16} aria-hidden />
        {t(lane === 'kudos' ? 'tch.messages.mode.kudos' : 'tch.messages.mode.note')}
        <small dir="auto">{name}</small>
      </h2>
      <p className="tch-laneDialog__how">
        {t(lane === 'kudos' ? 'tch.messages.how.kudos' : 'tch.messages.how.note')}
      </p>
      <label className="tch-laneDialog__field">
        <span>{t(lane === 'kudos'
          ? 'tch.messages.placeholder.kudos'
          : 'tch.messages.placeholder.note')}</span>
        <textarea
          value={text}
          dir="auto"
          rows={3}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {failed ? (
        <p className="tch-thread__failed" role="status">{t('tch.kudos.failed')}</p>
      ) : null}
      <div className="tch-laneDialog__actions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onClose}>
          {t('tch.messages.cancel')}
        </button>
        <button
          type="button"
          className="sp-btn sp-btn--primary sp-btn--sm"
          disabled={!text.trim() || isBusy}
          onClick={() => void submit()}
        >
          {t('tch.messages.send')}
        </button>
      </div>
    </Modal>
  )
}
