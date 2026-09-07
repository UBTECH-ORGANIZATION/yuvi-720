/* The child's side of the conversation.
 *
 * Until now this pane was read-only: it showed what a teacher had written and
 * offered no way to answer, because a 1:1 channel with a minor was excluded by
 * design. `services/direct_messages.py` is that exclusion's replacement — every
 * message is screened before it is stored, in BOTH directions — so the child
 * can write back, and their message goes through exactly the same gate their
 * teacher's does.
 *
 * One asymmetry, and it is deliberate: a message that reads as distress is
 * refused delivery and raises the teacher's urgent alert instead. A child in
 * that moment should not be depending on their teacher opening a thread.
 *
 * The shape is the one every chat this age group already knows: a rail of
 * chats on the reading-start side, the open one filling the rest, no frame
 * around either — the page itself is the chat. Two kinds of chat, named for
 * what they are: the private chat with a teacher, and a group chat for each
 * sub-group the child is in, holding what that teacher said to the group.
 * A group line is a record of the send, not a room the child can answer
 * into (`direct_messages.send_to_subgroup`), so the group chat has no box;
 * it points at the private chat instead.
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../../app/router'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { EmptyState, ErrorState, Icon, Skeleton } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useBrain } from '../../providers/BrainProvider'
import { listMentoring, type MentoringConversation } from '../../services/mentoring'
import { getMyTeachers, type MyTeacher } from '../../services/me'
import {
  MessageRefused, getMyUnread, listMyMessages, markMyMessagesRead, sendMyMessage,
  type DirectMessage,
} from '../../services/directMessages'
import { subscribe } from '../../services/realtime'
import './student-connections.css'

/* ── remembered across mounts ────────────────────────────────────────────────
   Every page remounts on navigation (App.tsx keys the route by path), and a
   chat that opens empty, then shows the teacher, then the messages, is a chat
   that looks broken three times a visit. What was on screen last time is shown
   at once and refreshed behind it; a skeleton only the very first time. */
/** Unread, the way the rail shows it: per teacher (their whole thread) and
 *  per sub-group (the part of that thread said to the group). */
interface Unread { teachers: Record<string, number>; groups: Record<string, number> }
interface Remembered {
  learnerId: string | null
  roster: MyTeacher[] | null
  rows: MentoringConversation[] | null
  unread: Unread
  messages: Record<string, DirectMessage[]>
}
const remembered: Remembered = { learnerId: null, roster: null, rows: null, unread: { teachers: {}, groups: {} }, messages: {} }
function memoryFor(learnerId: string | null): Remembered {
  if (remembered.learnerId !== learnerId) {
    remembered.learnerId = learnerId
    remembered.roster = null
    remembered.rows = null
    remembered.unread = { teachers: {}, groups: {} }
    remembered.messages = {}
  }
  return remembered
}

/** One entry in the rail. `teacher`: the private chat with a teacher who can
 *  write to me. `group`: a sub-group I am in, showing what one teacher said to
 *  it. `history`: summaries whose teacher no longer has a live link. */
interface Chat {
  key: string
  kind: 'teacher' | 'group' | 'history'
  /** Whose server-side thread the lines live in; null for history. */
  teacherId: string | null
  teacherName: string
  /** For a group chat: which sub-group's lines to show. */
  subgroupId?: string
  name: string
  groups: string[]
  /** For a group chat: the members' names, me included. */
  members: string[]
  summaries: MentoringConversation[]
}

interface StudentConnectionsPaneProps {
  studentName: string
}

export function StudentConnectionsPane({ studentName }: StudentConnectionsPaneProps) {
  const { learnerId } = useBrain()
  const { t, language } = useI18n()
  const memory = memoryFor(learnerId)
  const [roster, setRoster] = useState<MyTeacher[] | null>(() => memory.roster)
  const [rows, setRows] = useState<MentoringConversation[] | null>(() => memory.rows)
  const [unread, setUnread] = useState<Unread>(() => memory.unread)
  const [failed, setFailed] = useState({ roster: false, rows: false })

  const refreshUnread = useCallback(() => {
    getMyUnread()
      .then((result) => {
        memory.unread = { teachers: result.unread ?? {}, groups: result.subgroups ?? {} }
        setUnread(memory.unread)
      })
      .catch(() => {})
  }, [memory])

  useEffect(() => {
    let active = true
    // All three leave at once. The learner is resolved server-side from the
    // session; learnerId only keys the refetch when the signed-in learner
    // changes. The roster is the authority on who my teachers are; the
    // summaries fold into their teacher's thread when they land; neither
    // waits for the other.
    const rosterRequest = getMyTeachers()
    const rowsRequest = listMentoring()
    refreshUnread()
    rosterRequest
      .then((response) => {
        if (!active) return
        memory.roster = response.teachers
        setRoster(response.teachers)
      })
      .catch(() => { if (active) setFailed((current) => ({ ...current, roster: true })) })
    rowsRequest
      .then((response) => {
        if (!active) return
        memory.rows = response.conversations
        setRows(response.conversations)
      })
      .catch(() => { if (active) setFailed((current) => ({ ...current, rows: true })) })
    return () => { active = false }
  }, [learnerId, memory, refreshUnread])

  /* The rail. A teacher on the roster is a private chat with a composer, and
     each sub-group they reach me through is a group chat beside it. A summary
     joins its teacher by id first — the reliable join — and by name second,
     for records written before the id was stored. What still has no home goes
     to the one teacher when there is exactly one (those old summaries are
     theirs; a second "teacher" with the same person's name in another script
     is how this rail used to show two Gals), and otherwise becomes a readable
     history entry rather than vanishing. */
  const chats = useMemo<Chat[]>(() => {
    const teachers: Chat[] = []
    const groupChats: Chat[] = []
    const byId = new Map<string, Chat>()
    const byName = new Map<string, Chat>()
    for (const teacher of roster ?? []) {
      if (byId.has(teacher.teacher_id)) continue
      const name = teacher.display_name.trim() || teacher.teacher_id
      const chat: Chat = {
        key: `t:${teacher.teacher_id}`, kind: 'teacher',
        teacherId: teacher.teacher_id, teacherName: name, name,
        groups: [...new Set(teacher.groups.map((group) => group.name).filter((value): value is string => !!value))],
        members: [], summaries: [],
      }
      teachers.push(chat)
      byId.set(teacher.teacher_id, chat)
      byName.set(name.toLowerCase(), chat)
      for (const subgroup of teacher.subgroups ?? []) {
        groupChats.push({
          key: `g:${subgroup.subgroup_id}:${teacher.teacher_id}`, kind: 'group',
          teacherId: teacher.teacher_id, teacherName: name, subgroupId: subgroup.subgroup_id,
          name: subgroup.name || t('sdash.chat.kind.groupFallback'),
          groups: [], summaries: [],
          members: (subgroup.members ?? []).map((member) => member.display_name?.trim() || member.learner_id),
        })
      }
    }
    const orphans: MentoringConversation[] = []
    for (const row of rows ?? []) {
      const home = (row.teacher_id && byId.get(row.teacher_id))
        || byName.get(row.teacher_name.trim().toLowerCase())
      if (home) home.summaries.push(row)
      else orphans.push(row)
    }
    const histories: Chat[] = []
    if (orphans.length && teachers.length === 1) {
      teachers[0].summaries.push(...orphans)
    } else if (orphans.length) {
      const named = new Map<string, MentoringConversation[]>()
      for (const row of orphans) {
        const name = row.teacher_name.trim() || t('sdash.chat.teacherFallback')
        named.set(name, [...(named.get(name) ?? []), row])
      }
      for (const [name, summaries] of named) {
        histories.push({ key: `h:${name}`, kind: 'history', teacherId: null, teacherName: name, name, groups: [], members: [], summaries })
      }
    }
    return [...teachers, ...groupChats, ...histories]
  }, [roster, rows, t])

  /* Which sub-groups have a chat of their own: their lines leave the private
     chat. A line said to a group that is no longer in the rail (archived, or
     one I have since left) stays in the private chat, wearing the group's
     name, rather than vanishing. */
  const railSubgroupIds = useMemo(
    () => new Set(chats.flatMap((chat) => (chat.subgroupId ? [chat.subgroupId] : []))),
    [chats],
  )

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const active = useMemo(
    () => chats.find((chat) => chat.key === selectedKey) ?? chats[0] ?? null,
    [chats, selectedKey],
  )

  /* WhatsApp-style: which teachers have written something not yet read.
     Seeded from the counters, zeroed locally when that thread opens, bumped
     by live frames on the stream the page already holds. */
  const [threadNonce, setThreadNonce] = useState(0)
  const activeIdRef = useRef(active?.teacherId ?? null)
  useEffect(() => { activeIdRef.current = active?.teacherId ?? null }, [active])

  useEffect(() => {
    return subscribe('learner-triggers', () => '/api/agent/triggers/subscribe', (frame) => {
      if (frame.type !== 'direct_message' || frame.sender !== 'teacher') return
      const from = String(frame.teacher_id || '')
      if (!from) return
      // The frame says who, not which chat — the group stamp lands a moment
      // after the send — so the open thread re-reads and the badges are
      // re-asked from the server rather than guessed at.
      if (from === activeIdRef.current) setThreadNonce((value) => value + 1)
      else refreshUnread()
    })
  }, [refreshUnread])

  /* A teacher's badge is their thread minus what their groups account for;
     a group's badge is its own count. */
  const badgeOf = useCallback((chat: Chat) => {
    if (!chat.teacherId) return 0
    if (chat.kind === 'group') return chat.subgroupId ? unread.groups[chat.subgroupId] ?? 0 : 0
    const inGroups = chats
      .filter((other) => other.kind === 'group' && other.teacherId === chat.teacherId && other.subgroupId)
      .reduce((sum, other) => sum + (unread.groups[other.subgroupId as string] ?? 0), 0)
    return Math.max(0, (unread.teachers[chat.teacherId] ?? 0) - inGroups)
  }, [chats, unread])

  const [tab, setTab] = useState<'teachers' | 'groups'>('teachers')
  const openChat = (chat: Chat) => {
    setSelectedKey(chat.key)
    setTab(chat.kind === 'group' ? 'groups' : 'teachers')
    // Opening reads it; the thread tells the server, this clears the badge
    // without waiting for a refetch.
    const cleared = badgeOf(chat)
    if (chat.teacherId && cleared) {
      setUnread((current) => {
        const teachers = { ...current.teachers, [chat.teacherId as string]: Math.max(0, (current.teachers[chat.teacherId as string] ?? 0) - cleared) }
        const groups = { ...current.groups }
        if (chat.kind === 'group' && chat.subgroupId) delete groups[chat.subgroupId]
        memory.unread = { teachers, groups }
        return memory.unread
      })
    }
  }

  /* The rail's sections say which kind a chat is, so a teacher's card is the
     name alone. A group is named by its members, the way every chat this age
     group knows names one; history says it is history. */
  const subtitleOf = (chat: Chat): string | null => {
    if (chat.kind === 'history') return t('sdash.chat.history')
    if (chat.kind === 'group') return chat.members.join(', ') || chat.teacherName
    return null
  }

  /* Two tabs, teachers and groups, when there are groups at all. The tab you
     are not on wears a mark when something in it is unread, so a group line
     is never missed because the child was looking at the teachers. */
  const tabs = useMemo(() => {
    const groups = chats.filter((chat) => chat.kind === 'group')
    const teachers = chats.filter((chat) => chat.kind !== 'group')
    return [
      { key: 'teachers' as const, title: t('sdash.chat.section.teachers'), chats: teachers, unread: teachers.some((chat) => badgeOf(chat) > 0) },
      { key: 'groups' as const, title: t('sdash.chat.section.groups'), chats: groups, unread: groups.some((chat) => badgeOf(chat) > 0) },
    ]
  }, [chats, t, badgeOf])
  const hasGroups = tabs[1].chats.length > 0
  const shown = hasGroups ? (tabs.find((entry) => entry.key === tab) ?? tabs[0]) : tabs[0]

  const loading = roster === null && rows === null && !(failed.roster && failed.rows)
  const broken = failed.roster && failed.rows && roster === null && rows === null

  return (
    <div className="sd-page sd-connections-page">
      <LearnerAppBar studentName={studentName} />
      <main className="sd-chat" aria-label={t('sdash.chat.windowLabel')}>
        <aside className="sd-chat__rail">
          <div className="sd-chat__railHead">
            <h1>{t('sdash.chat.teachers')}</h1>
            <span className="sd-chat__railIcon" aria-hidden="true"><Icon name="message" size={18} /></span>
          </div>
          {loading ? (
            <RailSkeleton />
          ) : chats.length ? (
            <>
              {hasGroups ? (
                <div className="sd-chat__tabs" role="tablist">
                  {tabs.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      role="tab"
                      aria-selected={shown.key === entry.key}
                      className={`sd-chat__tab${shown.key === entry.key ? ' is-active' : ''}`}
                      onClick={() => setTab(entry.key)}
                    >
                      {entry.title}
                      {entry.unread ? <span className="sd-chat__tabDot" aria-label={t('sdash.chat.tabUnread')} /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <ul className="sd-chat__list" role={hasGroups ? 'tabpanel' : undefined}>
              {shown.chats.map((chat) => {
                const count = badgeOf(chat)
                const subtitle = subtitleOf(chat)
                return (
                  <li key={chat.key}>
                    <button
                      type="button"
                      className={`sd-chat__item${chat === active ? ' is-active' : ''}${count ? ' has-unread' : ''}`}
                      aria-current={chat === active ? 'true' : undefined}
                      onClick={() => openChat(chat)}
                    >
                      <span className={`sd-chat__avatar is-${chat.kind}`} aria-hidden="true">
                        {chat.kind === 'group' ? <Icon name="users" size={22} /> : chat.name.charAt(0)}
                      </span>
                      <span className="sd-chat__itemText">
                        <strong dir="auto">{chat.name}</strong>
                        {subtitle ? <small dir="auto">{subtitle}</small> : null}
                      </span>
                      {count ? (
                        <span className="sd-chat__unread" aria-label={t('sdash.chat.unread', { count })}>
                          {count > 99 ? '99+' : count}
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
              </ul>
            </>
          ) : (
            <p className="sd-chat__railEmpty">{t('sdash.chat.noTeachers')}</p>
          )}
        </aside>

        {broken ? (
          <section className="sd-chat__thread"><ErrorState title={t('sdash.chat.error')} /></section>
        ) : loading || !active ? (
          <ThreadSkeleton />
        ) : (
          <ChatThread
            key={active.key}
            chat={active}
            subtitle={subtitleOf(active)}
            reloadNonce={threadNonce}
            memory={memory}
            language={language}
            railSubgroupIds={railSubgroupIds}
            onSynced={refreshUnread}
            onOpenTeacher={() => {
              const teacher = chats.find((chat) => chat.kind === 'teacher' && chat.teacherId === active.teacherId)
              if (teacher) openChat(teacher)
            }}
          />
        )}
      </main>
    </div>
  )
}

/* ── skeletons ───────────────────────────────────────────────────────────────
   The real chrome (rail head, the two columns) is already on screen; only the
   people and the lines are placeholders, in the places they will appear. */
function RailSkeleton() {
  return (
    <ul className="sd-chat__list is-skeleton" role="status" aria-busy="true">
      {[0, 1, 2].map((index) => (
        <li key={index} className="sd-chat__item">
          <Skeleton w={48} h={48} r="50%" />
          <span className="sd-chat__itemText">
            <Skeleton w={index === 1 ? '46%' : '58%'} h="1em" />
            <Skeleton w={index === 2 ? '52%' : '72%'} h="0.85em" />
          </span>
        </li>
      ))}
    </ul>
  )
}

function ThreadSkeleton() {
  const widths = ['54%', '38%', '62%', '30%', '46%']
  return (
    <section className="sd-chat__thread is-skeleton" role="status" aria-busy="true">
      <header className="sd-chat__head">
        <Skeleton w={44} h={44} r="50%" />
        <span className="sd-chat__headText">
          <Skeleton w={140} h="1em" />
          <Skeleton w={200} h="0.85em" />
        </span>
      </header>
      <div className="sd-chat__body">
        {widths.map((width, index) => (
          <span key={index} className={`sd-msg sd-msg--${index % 3 === 2 ? 'me' : 'them'} sd-msg--skeleton`} style={{ inlineSize: width }}>
            <Skeleton h="1em" />
            {index % 2 === 0 ? <Skeleton w="70%" h="1em" /> : null}
          </span>
        ))}
      </div>
      <div className="sd-chat-compose"><Skeleton h={52} r={16} /></div>
    </section>
  )
}

/* ── one thread ──────────────────────────────────────────────────────────────
 * What the teacher wrote, what the child wrote back, and the box to write in.
 *
 * The mentoring summaries and the direct messages are merged and sorted by
 * time, because they are one relationship and reading them as two lists means
 * reading the same week twice. Summaries have a date only (no clock), so they
 * sort onto the start of their day. Days are separated the way every chat
 * separates them, so a summary reads as "that Tuesday", not as a card.
 */
function ChatThread({ chat, subtitle, reloadNonce = 0, memory, language, railSubgroupIds, onSynced, onOpenTeacher }: {
  chat: Chat
  /** Null for a teacher: the name is enough. */
  subtitle: string | null
  /** Bumped by the pane when a live message lands in THIS thread. */
  reloadNonce?: number
  memory: Remembered
  language: string
  railSubgroupIds: Set<string>
  /** After the read receipt lands: the badges can be re-asked. */
  onSynced: () => void
  /** From a group chat: open the private chat with the same teacher. */
  onOpenTeacher: () => void
}) {
  const { t } = useI18n()
  const teacherId = chat.teacherId
  /* The server keeps one thread per teacher; a group chat is that thread
     narrowed to one sub-group's lines, the private chat is the rest. */
  const [thread, setThread] = useState<DirectMessage[] | null>(
    () => (teacherId ? memory.messages[teacherId] ?? null : []),
  )
  const messages = useMemo(() => {
    if (thread === null) return null
    if (chat.kind === 'group') return thread.filter((message) => message.subgroup_id === chat.subgroupId)
    return thread.filter((message) => !message.subgroup_id || !railSubgroupIds.has(message.subgroup_id))
  }, [thread, chat.kind, chat.subgroupId, railSubgroupIds])
  const setMessages = setThread
  const canWrite = chat.kind === 'teacher' && !!teacherId
  const [draft, setDraft] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [failed, setFailed] = useState<'refused' | 'network' | null>(null)
  const [refusalKey, setRefusalKey] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  /* Where "unread" begins. Captured once, on first load — mark-read fires
     right below, so recomputing on a later reload would silently take the
     bar away while the child is still reading up to it. */
  const unreadFrom = useRef<string | null | 'unset'>('unset')

  const load = useCallback(() => {
    if (!teacherId) { setMessages([]); return }
    let active = true
    listMyMessages(teacherId)
      .then((rows) => {
        if (!active) return
        if (unreadFrom.current === 'unset') {
          const firstUnread = rows.find(
            (row) => row.sender === 'teacher' && !row.read_at)
          unreadFrom.current = firstUnread ? firstUnread.id : null
        }
        memory.messages[teacherId] = rows
        setMessages(rows)
        // Receipt only what this chat shows: a group's lines are a chat of
        // their own, and reading one must not clear the other's badge.
        void markMyMessagesRead(teacherId, chat.kind === 'group' && chat.subgroupId ? { subgroup: chat.subgroupId } : 'private')
          .then(() => { if (active) onSynced() })
          .catch(() => {})
      })
      .catch(() => { if (active) setMessages((current) => current ?? []) })
    return () => { active = false }
  }, [teacherId, memory, chat.kind, chat.subgroupId, onSynced])

  useEffect(() => load(), [load])
  // A live arrival in the open thread: refetch in place.
  useEffect(() => { if (reloadNonce) return load() }, [reloadNonce, load])

  /* Latest at the bottom — a thread that opens on its oldest line is a thread
     nobody reads the end of. Before paint, so the child never sees the top,
     and once more after it, for the fonts and wrapping that settle late. */
  useLayoutEffect(() => {
    if (!bodyRef.current) return
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    const frame = requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [messages, chat.summaries])

  const dayLabel = useMemo(() => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const key = (date: Date) => date.toISOString().slice(0, 10)
    const todayKey = key(today)
    const yesterdayKey = key(yesterday)
    const formatter = new Intl.DateTimeFormat(language, { weekday: 'long', day: 'numeric', month: 'long' })
    return (day: string) => {
      if (day === todayKey) return t('sdash.chat.today')
      if (day === yesterdayKey) return t('sdash.chat.yesterday')
      const date = new Date(`${day}T12:00:00`)
      return Number.isNaN(date.getTime()) ? day : formatter.format(date)
    }
  }, [language, t])

  const clock = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' })
    return (value: string) => {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? '' : formatter.format(date)
    }
  }, [language])

  const timeline = useMemo(() => {
    const items: {
      key: string; at: string; kind: 'summary' | 'from_teacher' | 'from_me'
      body: MentoringConversation | DirectMessage
    }[] = []
    for (const summary of chat.summaries) {
      items.push({
        key: `s:${summary.id || summary.date}`,
        // A date with no clock; the start of its day keeps it before that
        // day's messages whichever way the timezone falls.
        at: summary.date ? `${summary.date}T00:00:00` : '',
        kind: 'summary', body: summary,
      })
    }
    for (const message of messages ?? []) {
      items.push({
        key: `m:${message.id}`,
        at: message.created_at || '',
        kind: message.sender === 'teacher' ? 'from_teacher' : 'from_me',
        body: message,
      })
    }
    items.sort((a, b) => a.at.localeCompare(b.at))
    // Day separators, computed once here so the render below stays a map.
    let day = ''
    return items.map((item) => {
      const itemDay = item.at.slice(0, 10)
      const separator = itemDay && itemDay !== day ? itemDay : null
      if (itemDay) day = itemDay
      return { ...item, separator }
    })
  }, [chat.summaries, messages])

  async function send() {
    const text = draft.trim()
    if (!text || !teacherId || !canWrite || isBusy) return
    setIsBusy(true)
    setFailed(null)
    setRefusalKey(null)
    try {
      await sendMyMessage(teacherId, text, language)
      setDraft('')
      load()
    } catch (error) {
      // The draft stays in the box. A child who was just told their words were
      // not okay should be able to edit them, not retype them from memory.
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
    <section className="sd-chat__thread">
      <header className="sd-chat__head">
        <span className={`sd-chat__avatar is-${chat.kind}`} aria-hidden="true">
          {chat.kind === 'group' ? <Icon name="users" size={20} /> : chat.name.charAt(0)}
        </span>
        <span className="sd-chat__headText">
          <strong dir="auto">{chat.name}</strong>
          {subtitle ? <small dir="auto">{subtitle}</small> : null}
        </span>
        {chat.kind !== 'group' ? (
          <button type="button" className="sd-chat__headAction" onClick={() => navigate('/mentoring')}>
            <Icon name="target" size={16} />
            {t('sdash.chat.openMentoring')}
          </button>
        ) : null}
      </header>

      <div className="sd-chat__body" ref={bodyRef} aria-live="polite">
        {messages === null ? (
          <span className="sd-chat__bodyWait" role="status" aria-busy="true">
            <span className="sd-msg sd-msg--them sd-msg--skeleton" style={{ inlineSize: '52%' }}><Skeleton h="1em" /></span>
            <span className="sd-msg sd-msg--me sd-msg--skeleton" style={{ inlineSize: '36%' }}><Skeleton h="1em" /></span>
            <span className="sd-msg sd-msg--them sd-msg--skeleton" style={{ inlineSize: '44%' }}><Skeleton h="1em" /></span>
          </span>
        ) : timeline.length ? timeline.map((row) => {
          const separator = row.separator ? (
            <p className="sd-day" role="separator" key={`d:${row.separator}`}>{dayLabel(row.separator)}</p>
          ) : null
          if (row.kind === 'summary') {
            const summary = row.body as MentoringConversation
            return (
              <Fragment key={row.key}>
                {separator}
                <article className="sd-summary">
                  <span className="sd-summary__label"><Icon name="note" size={13} /> {t('sdash.chat.summary')}</span>
                  <p dir="auto">{summary.notes}</p>
                  {(summary.goals || []).map((goal) => (
                    <small key={goal.id || goal.title} dir="auto">
                      {t('sdash.chat.nextStep')}: {goal.title || goal.next_steps}
                    </small>
                  ))}
                </article>
              </Fragment>
            )
          }
          const message = row.body as DirectMessage
          return (
            <Fragment key={row.key}>
              {separator}
              {message.id === unreadFrom.current && (
                <p className="sd-chat-unreadBar" role="separator">
                  {t('sdash.chat.unreadFromHere')}
                </p>
              )}
              <article className={`sd-msg sd-msg--${row.kind === 'from_me' ? 'me' : 'them'}`}>
                {message.subgroup_name ? (
                  <span className="sd-msg__tag">
                    <Icon name="users" size={13} /> {t('sdash.chat.toSubgroup', { name: message.subgroup_name })}
                  </span>
                ) : null}
                <p dir="auto">{message.text}</p>
                <time dateTime={message.created_at}>{clock(message.created_at)}</time>
              </article>
            </Fragment>
          )
        }) : chat.kind === 'group' ? (
          <EmptyState icon="users" title={t('sdash.chat.groupEmpty')}
                      body={t('sdash.chat.groupEmptyBody', { teacher: chat.teacherName })} />
        ) : (
          <EmptyState icon="message" title={t('sdash.chat.empty')} body={t('sdash.chat.emptyBody')} />
        )}
      </div>

      {chat.kind === 'group' ? (
        /* A group line is a record of the send, not a room: the answer goes
           to the teacher, in the private chat. */
        <div className="sd-chat__groupNote">
          <p>{t('sdash.chat.groupNote', { teacher: chat.teacherName })}</p>
          <button type="button" onClick={onOpenTeacher}>
            <Icon name="message" size={16} />
            {t('sdash.chat.groupReply', { teacher: chat.teacherName })}
          </button>
        </div>
      ) : (
      /* The child's own box. A textarea and not an input: an answer to a
         teacher is often more than one line, and a single-line field that
         scrolls sideways is how a child gives up halfway through. */
      <form
        className="sd-chat-compose"
        onSubmit={(event) => { event.preventDefault(); void send() }}
      >
        <label className="sd-chat-compose__label" htmlFor="sd-chat-compose">
          {t('sdash.chat.compose.label', { teacher: chat.name })}
        </label>
        <div className="sd-chat-compose__row">
          <textarea
            id="sd-chat-compose"
            value={draft}
            dir="auto"
            rows={1}
            disabled={!canWrite}
            placeholder={canWrite
              ? t('sdash.chat.compose.placeholder')
              : t('sdash.chat.compose.closed')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter makes a new line — the shape every
              // chat this age group uses.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <button
            type="submit"
            className="sd-chat-compose__send"
            disabled={!draft.trim() || !canWrite || isBusy}
            aria-label={t('sdash.chat.compose.send')}
            title={t('sdash.chat.compose.send')}
          >
            <Icon name="send" size={18} aria-hidden />
          </button>
        </div>
        {failed ? (
          <p className={`sd-chat-compose__failed${failed === 'refused' ? ' is-refused' : ''}`}
             role="status">
            {failed === 'refused'
              ? t(refusalKey || 'moderation.default')
              : t('sdash.chat.compose.failed')}
          </p>
        ) : null}
      </form>
      )}
    </section>
  )
}
