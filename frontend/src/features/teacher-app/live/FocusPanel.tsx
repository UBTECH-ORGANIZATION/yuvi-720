/* Changing one child's focus — or everyone's at once.
 *
 * Grounded twice: the panel opens on what the planner already intends (the
 * exact next component, from the learner's own plan) and the catalog is laid
 * out subject → objective, with the learner's current objective first and
 * open. The teacher can still choose anything — the panel recommends, it
 * does not fence — but the fitting step is always one glance away, so the
 * easy path is the one that matches where the child actually is.
 *
 * Extracted from LiveClassView (#244): the live row, the student profile and
 * the calendar all open the SAME panel, because two pin dialogs would be two
 * opinions about what a pin is. The row-scoped positioning stays with each
 * caller (via `className`); this component owns only its content.
 *
 * #244 additions: a tasks tab (the child's open assignments — pinning one
 * makes it the dashboard hero), an optional end date, and a smart search —
 * the teacher DESCRIBES the learning they want and the server matches it
 * against this group's catalog (grounded: only real component ids come back;
 * a near-miss becomes a "search with {similar_topic}?" pointer instead).
 * The dialog is about the ONE child it was opened for — bulk pinning lives
 * on the calendar's task lane, not here.
 */

import { useEffect, useMemo, useState } from 'react'
import { Icon, SkeletonRows } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import {
  findLearnings, getGroupLearnings, getPinnedNext, pinNext, unpinNext,
  type FoundLearning, type LearningRow, type PinFocus, type PinnableTask,
  type PinnedNext,
} from '../../../services/teacher'
import { learningName, prettyId, variantOf } from './learning-names'
import './live-class.css'

export function FocusPanel({ learnerId, groupId, onChanged, className }: {
  learnerId: string
  groupId: string | null
  onChanged: () => void
  /** The caller's positioning classes, if any. Both call sites host the panel
   *  in the shared Modal now, which also owns dismissal (backdrop + Escape). */
  className?: string
}) {
  const { t, language } = useI18n()
  const [learnings, setLearnings] = useState<LearningRow[] | null>(null)
  const [tasks, setTasks] = useState<PinnableTask[]>([])
  const [current, setCurrent] = useState<PinnedNext | null>(null)
  const [pinState, setPinState] = useState<'active' | 'expired' | 'spent' | null>(null)
  const [focus, setFocus] = useState<PinFocus | null>(null)
  const [tab, setTab] = useState<'learnings' | 'tasks'>('learnings')
  /** Which subject's shelf is on display. null = the child's own subject —
   *  the tree keeps it first, so the fitting material opens the dialog. */
  const [subjectPick, setSubjectPick] = useState<string | null>(null)
  /** The optional end date, as the `<input type=date>` value (a bare day —
   *  the server reads it as "through that day" in the classroom's timezone). */
  const [until, setUntil] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  /** The smart search: the teacher SAYS what they want and the server matches
   *  it against this group's catalog. `found` is the whole answer — up to
   *  three grounded hits, or a navigation hint, or a clean "nothing". */
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [found, setFound] =
    useState<{ options: FoundLearning[]; similar_topic: string | null } | null>(null)
  const [searchFailed, setSearchFailed] = useState(false)

  useEffect(() => {
    if (!groupId) return
    let active = true
    getGroupLearnings(groupId, language)
      .then((view) => { if (active) setLearnings(view.learnings) })
      .catch(() => { if (active) setLearnings([]) })
    getPinnedNext(learnerId, language)
      .then((result) => {
        if (!active) return
        setCurrent(result.pinned)
        setPinState(result.pin_state)
        setTasks(result.tasks ?? [])
        setFocus(result.focus)
      })
      .catch(() => {})
    return () => { active = false }
  }, [groupId, learnerId, language])

  /* subject → objective → learnings, in catalog order; the learner's own
     subject first so the fitting material is never below the fold. */
  const tree = useMemo(() => {
    if (!learnings) return null
    const subjects = new Map<string, {
      key: string
      name: string
      objectives: Map<string, { id: string; title: string; rows: LearningRow[] }>
    }>()
    for (const row of learnings) {
      const subjectKey = row.subject || 'other'
      let subject = subjects.get(subjectKey)
      if (!subject) {
        // The shared `tch.subject.*` labels; an unmapped key falls back to
        // itself rather than to a blank heading.
        const labelKey = `tch.subject.${subjectKey}`
        const label = t(labelKey)
        subject = {
          key: subjectKey,
          name: label !== labelKey ? label : subjectKey,
          objectives: new Map(),
        }
        subjects.set(subjectKey, subject)
      }
      const objectiveKey = row.objective_id || row.unit_id || row.component_id
      let objective = subject.objectives.get(objectiveKey)
      if (!objective) {
        // The objective's NAME heads the group — but a registry with no
        // localized name for it (English today) hands back the raw id or
        // nothing, and "ENG.G7.FAMILY.GRAMMAR-01" is not a heading. Fall to
        // the unit's name, then to the id read as words.
        const named = row.objective_title && row.objective_title !== row.objective_id
          ? row.objective_title : ''
        objective = {
          id: row.objective_id || '',
          title: named || row.unit_title
            || prettyId(row.objective_id || row.component_id),
          rows: [],
        }
        subject.objectives.set(objectiveKey, objective)
      }
      objective.rows.push(row)
    }
    const ordered = [...subjects.values()]
    ordered.sort((a, b) => {
      if (a.key === focus?.subject) return -1
      if (b.key === focus?.subject) return 1
      return a.name.localeCompare(b.name)
    })
    return ordered
  }, [learnings, focus, t])

  /* One subject on display at a time. null pick = the child's own subject —
     the tree keeps it first, so the fitting material greets the dialog. */
  const shown = useMemo(() => {
    if (!tree || tree.length === 0) return null
    return tree.find((held) => held.key === (subjectPick ?? focus?.subject)) ?? tree[0]
  }, [tree, subjectPick, focus])

  async function search(text: string) {
    const asked = text.trim()
    if (!asked || !groupId || searching) return
    setSearching(true)
    setSearchFailed(false)
    try {
      setFound(await findLearnings(groupId, {
        query: asked,
        subject: shown?.key === 'other' ? undefined : shown?.key,
        language,
      }))
    } catch {
      setSearchFailed(true)
    } finally {
      setSearching(false)
    }
  }

  /** One pick, one child. (Pinning a whole audience lives on the calendar's
   *  task lane via the bulk route — the dialog stays about the one child it
   *  was opened for.) */
  async function pick(body: { component_id?: string; launch_id?: string }) {
    if (busy) return
    setBusy(true)
    setFailed(false)
    const payload = { ...body, ...(until ? { expires_at: until } : {}) }
    try {
      const { pinned } = await pinNext(learnerId, payload)
      setCurrent(pinned)
      setPinState('active')
      onChanged()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      await unpinNext(learnerId)
      setCurrent(null)
      setPinState(null)
      onChanged()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const titleOf = (pin: PinnedNext) => {
    if (pin.kind === 'task') return pin.title || pin.launch_id || ''
    const componentId = pin.component_id
    if (!componentId) return ''
    const row = learnings?.find((held) => held.component_id === componentId)
    return row ? learningName(row) : prettyId(componentId)
  }

  return (
    <div className={`tch-focusPanel${className ? ` ${className}` : ''}`}>
      {/* The dialog says what it IS before anything else — a bare catalog with
          a date field reads as noise; the same catalog under "pin the next
          step" reads as a choice. The profile modal borrows this heading as
          its accessible title. */}
      <header className="tch-focusPanel__head">
        <h3 className="tch-focusPanel__title" id="tch-focus-panel-title" dir="auto">
          <Icon name="target" size={15} aria-hidden />
          {t('tch.liveView.focusPanel.title')}
        </h3>
        <p className="tch-focusPanel__lead" dir="auto">
          {t('tch.liveView.focusPanel.lead')}
        </p>
      </header>

      {/* The standing state, next: a manual focus if one is set, else where
          Yuvi's own route is pointing — so "change" always says change FROM. */}
      <p className="tch-focusPanel__current" dir="auto">
        {current ? (
          <>
            <Icon name="target" size={13} aria-hidden />
            {t(current.kind === 'task'
              ? 'tch.liveView.focusPanel.pinnedTask'
              : 'tch.liveView.focusPanel.pinned', { title: titleOf(current) })}
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" disabled={busy}
                    onClick={() => void clear()}>
              {t('tch.liveView.act.unpin')}
            </button>
          </>
        ) : focus ? (
          <>
            <Icon name="compass" size={13} aria-hidden />
            {t('tch.liveView.focusPanel.planner', {
              subject: focus.subject_name || '',
              title: focus.objective_title ?? t('tch.liveView.spread.unnamed'),
            })}
          </>
        ) : (
          t('tch.loading')
        )}
      </p>
      {/* A pin that lapsed is a fact the teacher must see, not a blank: the
          record is still there, it just stopped steering. */}
      {pinState === 'expired' && (
        <p className="tch-focusPanel__note" dir="auto">
          {t('tch.liveView.focusPanel.expired')}
        </p>
      )}

      {/* What kind of thing to pin — then, in their own framed row, for whom
          and until when. Audience and date must sit ABOVE the catalog: a click
          on an option pins immediately, so anything that changes what that
          click means has to be seen first. */}
      <div className="tch-focusPanel__tabs" role="tablist">
        {(['learnings', 'tasks'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`tch-focusPanel__tab${tab === name ? ' is-active' : ''}`}
            onClick={() => setTab(name)}
          >
            {t(`tch.liveView.focusPanel.tab.${name}`)}
          </button>
        ))}
      </div>
      <div className="tch-focusPanel__options">
        <label className="tch-focusPanel__until">
          <Icon name="calendar" size={13} aria-hidden />
          <span>{t('tch.liveView.focusPanel.until')}</span>
          <input
            type="date"
            className="sp-input"
            value={until}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setUntil(event.target.value)}
          />
        </label>
      </div>

      {tab === 'tasks' ? (
        tasks.length === 0 ? (
          <p className="tch-focusPanel__note">{t('tch.liveView.focusPanel.noTasks')}</p>
        ) : (
          <ul className="tch-focusPanel__rows tch-focusPanel__rows--tasks">
            {tasks.map((task) => {
              const isCurrent = current?.kind === 'task' && current.launch_id === task.launch_id
              return (
                <li key={task.launch_id}>
                  <button
                    type="button"
                    className={`tch-focusPanel__option${isCurrent ? ' is-current' : ''}`}
                    disabled={busy || isCurrent}
                    onClick={() => void pick({ launch_id: task.launch_id })}
                  >
                    <span className="tch-focusPanel__optMain" dir="auto">
                      <span className="tch-focusPanel__optName">
                        {task.title || task.launch_id}
                      </span>
                      {isCurrent && (
                        <span className="tch-focusPanel__tag">
                          {t('tch.liveView.focusPanel.chosen')}
                        </span>
                      )}
                    </span>
                    {task.due_at && (
                      <span className="tch-focusPanel__optDesc" dir="auto">
                        {t('tch.liveView.focusPanel.due', {
                          date: new Date(task.due_at).toLocaleDateString(language),
                        })}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )
      ) : tree === null ? (
        <div aria-busy="true" className="tch-focusPanel__skeleton"><SkeletonRows rows={4} /></div>
      ) : tree.length === 0 ? (
        <p className="tch-focusPanel__note">{t('tch.liveView.pin.emptyCatalog')}</p>
      ) : (() => {
        if (!shown) return null
        const objectives = [...shown.objectives.values()]
        objectives.sort((a, b) =>
          Number(focus?.objective_id === b.id) - Number(focus?.objective_id === a.id))
        /* Topic starters: the shown subject's own objective names — clicking
           one IS a search, so the box teaches itself. */
        const suggestions = objectives.map((objective) => objective.title).slice(0, 3)
        return (
          <>
            {/* Say it instead of scanning for it: the description goes to the
                server, which matches it against THIS group's catalog only. */}
            <div className="tch-focusPanel__searchRow">
              <label className="tch-focusPanel__searchBox">
                <Icon name="wand" size={14} aria-hidden />
                <span className="sp-sr-only">
                  {t('tch.liveView.focusPanel.search.placeholder')}
                </span>
                <input
                  className="sp-input"
                  type="text"
                  value={query}
                  maxLength={300}
                  placeholder={t('tch.liveView.focusPanel.search.placeholder')}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void search(query) }
                  }}
                />
              </label>
              <button
                type="button"
                className="sp-btn sp-btn--sm"
                disabled={searching || !query.trim()}
                onClick={() => void search(query)}
              >
                {searching ? t('tch.loading') : t('tch.liveView.focusPanel.search.go')}
              </button>
            </div>
            {found === null && !searchFailed && suggestions.length > 0 && (
              <p className="tch-focusPanel__suggest" dir="auto">
                <span>{t('tch.liveView.focusPanel.search.suggest')}</span>
                {suggestions.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    className="tch-focusPanel__suggestChip"
                    disabled={searching}
                    onClick={() => { setQuery(topic); void search(topic) }}
                  >
                    {topic}
                  </button>
                ))}
              </p>
            )}
            {searchFailed && (
              <p role="status" className="tch-focusPanel__note is-error">
                {t('tch.liveView.focusPanel.search.failed')}
              </p>
            )}
            {found && (
              <div className="tch-focusPanel__results" role="status">
                <h4 className="tch-focusPanel__resultsHead">
                  <span>{t('tch.liveView.focusPanel.search.results')}</span>
                  <button
                    type="button"
                    className="sp-btn sp-btn--ghost sp-btn--sm"
                    onClick={() => { setFound(null); setSearchFailed(false) }}
                  >
                    {t('tch.liveView.focusPanel.search.clear')}
                  </button>
                </h4>
                {found.options.length > 0 ? (
                  <ul className="tch-focusPanel__rows">
                    {found.options.map((hit, index) => {
                      const isCurrent = current?.kind !== 'task'
                        && current?.component_id === hit.component_id
                      return (
                        <li key={hit.component_id}>
                          <button
                            type="button"
                            className={`tch-focusPanel__option${
                              isCurrent ? ' is-current' : ''}`}
                            disabled={busy || isCurrent}
                            onClick={() => void pick({ component_id: hit.component_id })}
                          >
                            <span className="tch-focusPanel__optMain" dir="auto">
                              <span className="tch-focusPanel__rank" aria-hidden>
                                {index + 1}
                              </span>
                              <span className="tch-focusPanel__optName">{hit.title}</span>
                              {isCurrent && (
                                <span className="tch-focusPanel__tag">
                                  {t('tch.liveView.focusPanel.chosen')}
                                </span>
                              )}
                            </span>
                            {hit.reason && (
                              <span className="tch-focusPanel__optDesc" dir="auto">
                                {hit.reason}
                              </span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : found.similar_topic ? (
                  /* Nothing matched, but something adjacent exists — navigate
                     rather than dead-end. Clicking IS the follow-up search. */
                  <button
                    type="button"
                    className="tch-focusPanel__similar"
                    disabled={searching}
                    onClick={() => {
                      setQuery(found.similar_topic ?? '')
                      void search(found.similar_topic ?? '')
                    }}
                  >
                    {t('tch.liveView.focusPanel.search.similar',
                       { topic: found.similar_topic })}
                  </button>
                ) : (
                  <p className="tch-focusPanel__note">
                    {t('tch.liveView.focusPanel.search.none')}
                  </p>
                )}
              </div>
            )}
            <div className="tch-focusPanel__subjNav" role="tablist">
              {tree.map((subject) => (
                <button
                  key={subject.key}
                  type="button"
                  role="tab"
                  aria-selected={subject.key === shown.key}
                  className={`tch-focusPanel__subjChip${
                    subject.key === shown.key ? ' is-active' : ''}`}
                  onClick={() => { setSubjectPick(subject.key); setFound(null) }}
                  title={subject.key === focus?.subject
                    ? t('tch.liveView.focusPanel.currentSubject') : undefined}
                >
                  {subject.key === focus?.subject && (
                    <Icon name="compass" size={12} aria-hidden />
                  )}
                  <span dir="auto">{subject.name}</span>
                </button>
              ))}
            </div>
            <div className="tch-focusPanel__subjects">
              {objectives.map((objective) => {
                const recommended = Boolean(
                  focus?.objective_id && objective.id === focus.objective_id)
                return (
                  <section
                    key={objective.id || objective.title}
                    className={`tch-focusPanel__objGroup${recommended ? ' is-recommended' : ''}`}
                  >
                    <h4 className="tch-focusPanel__objHead" dir="auto">
                      <span>{objective.title}</span>
                      {recommended && (
                        <span className="tch-focusPanel__tag tch-focusPanel__tag--fit">
                          {t('tch.liveView.focusPanel.recommended')}
                        </span>
                      )}
                    </h4>
                    <ul className="tch-focusPanel__rows">
                      {objective.rows.map((learning) => {
                        const isCurrent = current?.kind !== 'task'
                          && current?.component_id === learning.component_id
                        const isNext = focus?.next_component_id === learning.component_id
                        const full = learningName(learning)
                        const short = variantOf(learning, objective.rows)
                        /* The row's second line is what the chips never had
                           room for: the full name when the first line is a
                           trimmed variant, then the step's size. */
                        const meta: string[] = []
                        if (learning.questions_total > 0) {
                          meta.push(t('tch.liveView.focusPanel.qs',
                                      { count: learning.questions_total }))
                        }
                        if (learning.estimated_minutes) {
                          meta.push(t('tch.liveView.focusPanel.min',
                                      { count: learning.estimated_minutes }))
                        }
                        if (learning.is_assessment) {
                          meta.push(t('tch.learnings.assessment'))
                        }
                        const desc = [short !== full ? full : null, meta.join(' · ')]
                          .filter(Boolean).join(' · ')
                        return (
                          <li key={learning.component_id}>
                            <button
                              type="button"
                              className={`tch-focusPanel__option${isCurrent ? ' is-current' : ''}${
                                isNext ? ' is-next' : ''}`}
                              disabled={busy || isCurrent}
                              onClick={() => void pick({ component_id: learning.component_id })}
                            >
                              <span className="tch-focusPanel__optMain" dir="auto">
                                <span className="tch-focusPanel__optName">
                                  {short || learning.component_id}
                                </span>
                                {isNext && (
                                  <span className="tch-focusPanel__tag tch-focusPanel__tag--fit">
                                    {t('tch.liveView.focusPanel.fitsNow')}
                                  </span>
                                )}
                                {isCurrent && (
                                  <span className="tch-focusPanel__tag">
                                    {t('tch.liveView.focusPanel.chosen')}
                                  </span>
                                )}
                              </span>
                              {desc && (
                                <span className="tch-focusPanel__optDesc" dir="auto">{desc}</span>
                              )}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
          </>
        )
      })()}
      {failed && (
        <p role="status" className="tch-focusPanel__note is-error">
          {t('tch.liveView.pin.failed')}
        </p>
      )}
    </div>
  )
}
