/* Pinning one child's next step — a learning GOAL, never a single lomda.
 *
 * The teacher names the destination; WHICH lomda inside it the child meets
 * is the planner's own allocation, re-judged as they progress — so a pin can
 * never fight the sequencing the platform would have applied anyway. The
 * shelf is goal cards, one subject at a time, the child's own subject first
 * and their current goal marked; the teacher can still pick anything.
 *
 * Extracted from LiveClassView (#244): the live row and the student profile
 * open the SAME dialog, because two pin dialogs would be two opinions about
 * what a pin is. Task pinning lives on the calendar's task lane — this
 * dialog deals only in goals (a standing task pin still displays here).
 *
 * The smart search is grounded and catalog-wide: the teacher DESCRIBES the
 * learning they want, the server matches it against the group's catalog
 * across every subject (only real goal ids come back; a near-miss becomes a
 * "search with {similar_topic}?" pointer instead). The dialog is about the
 * ONE child it was opened for — bulk pinning lives on the calendar lane.
 */

import { useEffect, useMemo, useState } from 'react'
import { Icon, SkeletonRows } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import {
  findLearnings, getGroupLearnings, getPinnedNext, pinNext, unpinNext,
  type FoundLearning, type LearningRow, type PinFocus, type PinnedNext,
} from '../../../services/teacher'
import { learningName, prettyId } from './learning-names'
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
  const [current, setCurrent] = useState<PinnedNext | null>(null)
  const [pinState, setPinState] = useState<'active' | 'expired' | 'spent' | null>(null)
  const [focus, setFocus] = useState<PinFocus | null>(null)
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
      // Catalog-wide on purpose: a math request typed while the science
      // shelf is open must still find the math goal. Each hit says where
      // it lives.
      setFound(await findLearnings(groupId, { query: asked, language }))
    } catch {
      setSearchFailed(true)
    } finally {
      setSearching(false)
    }
  }

  /** One pick, one child. (Pinning a whole audience lives on the calendar's
   *  task lane via the bulk route — the dialog stays about the one child it
   *  was opened for.) */
  async function pick(body: { objective_id?: string; launch_id?: string }) {
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
    if (pin.kind === 'objective') {
      const row = learnings?.find((held) => held.objective_id === pin.objective_id)
      const named = row?.objective_title && row.objective_title !== row.objective_id
        ? row.objective_title : ''
      return named || row?.unit_title || prettyId(pin.objective_id || '')
    }
    // Component pins survive from #249 and from the calendar's older lane.
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

      {/* The end date sits ABOVE the catalog: a click on a goal pins
          immediately, so anything that changes what that click means has to
          be seen first. (Task pinning lives on the calendar's task lane —
          this dialog deals only in learning goals.) */}
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

      {tree === null ? (
        <div aria-busy="true" className="tch-focusPanel__skeleton"><SkeletonRows rows={4} /></div>
      ) : tree.length === 0 ? (
        <p className="tch-focusPanel__note">{t('tch.liveView.pin.emptyCatalog')}</p>
      ) : (() => {
        if (!shown) return null
        const objectives = [...shown.objectives.values()]
        objectives.sort((a, b) =>
          Number(focus?.objective_id === b.id) - Number(focus?.objective_id === a.id))
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
                      const isCurrent = current?.kind === 'objective'
                        && current.objective_id === hit.objective_id
                      const subjectKey = `tch.subject.${hit.subject}`
                      const subjectName = hit.subject
                        ? (t(subjectKey) !== subjectKey ? t(subjectKey) : hit.subject)
                        : null
                      return (
                        <li key={hit.objective_id}>
                          <button
                            type="button"
                            className={`tch-focusPanel__option${
                              isCurrent ? ' is-current' : ''}`}
                            disabled={busy || isCurrent}
                            onClick={() => void pick({ objective_id: hit.objective_id })}
                          >
                            <span className="tch-focusPanel__optMain" dir="auto">
                              <span className="tch-focusPanel__rank" aria-hidden>
                                {index + 1}
                              </span>
                              <span className="tch-focusPanel__optName">{hit.title}</span>
                              {/* The search reads every subject — the hit
                                  says where it lives, since the shelf below
                                  may be showing a different one. */}
                              {subjectName && (
                                <span className="tch-focusPanel__tag">{subjectName}</span>
                              )}
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
              <ul className="tch-focusPanel__goals">
                {/* A goal without an objective id (off-catalog activity rows)
                    cannot be pinned — so it is not offered. */}
                {objectives.filter((objective) => objective.id).map((objective) => {
                  const recommended = Boolean(
                    focus?.objective_id && objective.id === focus.objective_id)
                  const isCurrent = current?.kind === 'objective'
                    && current.objective_id === objective.id
                  /* The card says what the goal is ABOUT: the lomdot it
                     contains, then its size. The planner — not the teacher —
                     picks which of them the child meets first. */
                  const names = objective.rows.map((row) => learningName(row))
                  const preview = names.slice(0, 3).join(' · ')
                  const extra = names.length - 3
                  const minutes = objective.rows.reduce(
                    (sum, row) => sum + (row.estimated_minutes || 0), 0)
                  return (
                    <li key={objective.id}>
                      <button
                        type="button"
                        className={`tch-focusPanel__option tch-focusPanel__option--goal${
                          isCurrent ? ' is-current' : ''}${recommended ? ' is-next' : ''}`}
                        disabled={busy || isCurrent}
                        onClick={() => void pick({ objective_id: objective.id })}
                      >
                        <span className="tch-focusPanel__optMain" dir="auto">
                          <span className="tch-focusPanel__optName">{objective.title}</span>
                          {recommended && (
                            <span className="tch-focusPanel__tag tch-focusPanel__tag--fit">
                              {t('tch.liveView.focusPanel.recommended')}
                            </span>
                          )}
                          {isCurrent && (
                            <span className="tch-focusPanel__tag">
                              {t('tch.liveView.focusPanel.chosen')}
                            </span>
                          )}
                        </span>
                        <span className="tch-focusPanel__optDesc" dir="auto">
                          {preview}
                          {extra > 0
                            ? ` · ${t('tch.liveView.focusPanel.more', { count: extra })}`
                            : ''}
                        </span>
                        <span className="tch-focusPanel__goalMeta" dir="auto">
                          {t('tch.liveView.focusPanel.parts', { count: names.length })}
                          {minutes > 0
                            ? ` · ${t('tch.liveView.focusPanel.min', { count: minutes })}`
                            : ''}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
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
