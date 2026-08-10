/* Teacher-authored insights (MoE F6 student §3).
 *
 * "המערכת תאפשר למורה להזין תובנות שלו על התלמיד (חוזקות/חולשות/אתגרים
 * ספציפיים) שיכללו בפרופיל הלומד" — so these are written into the learner
 * profile, not kept as dashboard notes.
 *
 * The visibility control is the sharp edge and is labelled as such: `coach`
 * means Yuvi will use the note when talking to the child. It is never the
 * default, and the consequence is spelled out in the UI rather than implied.
 */

import { useEffect, useState } from 'react'
import {
  EmptyState, ErrorState, Icon, Panel, SectionHeader, SkeletonCard, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import {
  createTeacherInsight, deleteTeacherInsight, listTeacherInsights,
  type InsightKind, type InsightVisibility, type TeacherInsight,
} from '../../../services/teacher'

const KINDS: InsightKind[] = ['strength', 'weakness', 'challenge', 'note']
const VISIBILITIES: InsightVisibility[] = ['private', 'shared', 'coach']

export function TeacherNotes({ learnerId }: { learnerId: string }) {
  const { t } = useI18n()
  const [rows, setRows] = useState<TeacherInsight[] | null>(null)
  const [error, setError] = useState(false)
  const [kind, setKind] = useState<InsightKind>('strength')
  const [visibility, setVisibility] = useState<InsightVisibility>('private')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = () => {
    listTeacherInsights(learnerId)
      .then((result) => setRows(result.insights))
      .catch(() => setError(true))
  }

  useEffect(() => {
    setRows(null)
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnerId])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const body = text.trim()
    if (!body || saving) return
    setSaving(true)
    try {
      await createTeacherInsight(learnerId, { kind, text: body, visibility })
      setText('')
      setVisibility('private')
      refresh()
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (insightId: string) => {
    try {
      await deleteTeacherInsight(learnerId, insightId)
      refresh()
    } catch {
      setError(true)
    }
  }

  if (error) return <ErrorState title={t('tch.error')} />

  return (
    <div className="tch-student__body" role="tabpanel">
      <Panel data-tour="teacher.notes">
        <SectionHeader
          title={t('tch.notes.title')}
          subtitle={t('tch.notes.subtitle')}
        />

        <form className="tch-notes__form" onSubmit={submit}>
          <div className="tch-notes__row">
            <label>
              <span>{t('tch.notes.kind')}</span>
              <select value={kind} onChange={(event) => setKind(event.target.value as InsightKind)}>
                {KINDS.map((value) => (
                  <option key={value} value={value}>{t(`tch.notes.kind.${value}`)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('tch.notes.visibility')}</span>
              <select
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as InsightVisibility)}
              >
                {VISIBILITIES.map((value) => (
                  <option key={value} value={value}>{t(`tch.notes.visibility.${value}`)}</option>
                ))}
              </select>
            </label>
          </div>

          <textarea
            className="sp-input tch-notes__text"
            dir="auto"
            rows={3}
            value={text}
            maxLength={2000}
            placeholder={t('tch.notes.placeholder')}
            onChange={(event) => setText(event.target.value)}
          />

          {/* Spell out the consequence rather than trusting the label alone. */}
          {visibility === 'coach' ? (
            <p className="tch-notes__warning" dir="auto">
              <Icon name="alert" size={15} aria-hidden="true" />
              {t('tch.notes.coachWarning')}
            </p>
          ) : null}
          {visibility === 'shared' ? (
            <p className="tch-notes__hint" dir="auto">{t('tch.notes.sharedHint')}</p>
          ) : null}

          <button
            type="submit"
            className="sp-btn sp-btn--gradient"
            disabled={saving || !text.trim()}
          >
            {saving ? t('tch.notes.saving') : t('tch.notes.save')}
          </button>
        </form>

        {rows === null ? (
          <div aria-busy="true"><SkeletonCard rows={3} /></div>
        ) : rows.length ? (
          <ul className="tch-notes__list">
            {rows.map((row) => (
              <li key={row._id} className="tch-note">
                <div className="tch-note__head">
                  <StatusPill tone={row.kind === 'strength' ? 'strong' : 'steady'}>
                    {t(`tch.notes.kind.${row.kind}`)}
                  </StatusPill>
                  <StatusPill tone={row.visibility === 'coach' ? 'support' : 'neutral'}>
                    {t(`tch.notes.visibility.${row.visibility}`)}
                  </StatusPill>
                  <button
                    type="button"
                    className="sp-btn sp-btn--icon sp-btn--sm"
                    aria-label={t('tch.notes.delete')}
                    onClick={() => remove(row._id)}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
                <p dir="auto">{row.text}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t('tch.notes.none')} />
        )}
      </Panel>
    </div>
  )
}
