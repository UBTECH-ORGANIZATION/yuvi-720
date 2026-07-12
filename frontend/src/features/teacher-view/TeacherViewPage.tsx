import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import {
  getGroupInsights, getStudentInsights, listGroups, saveDirective,
  type GroupInsight, type StudentInsight, type Group,
} from '../../services/teacher'
import {
  Card, Panel, SectionHeader, StatusPill, EvidenceChip,
  EmptyState, LoadingState, ErrorState, Icon,
} from '../../components/primitives'
import './teacher-view.css'

/**
 * Teacher view (720 Feature 6) — real, explainable, group-scoped.
 * Every attention flag expands to its raw evidence; no student comparison.
 * Wired to the verified `services/teacher.ts` (was a mock imperative page).
 */
export function TeacherViewPage() {
  const { t, language } = useI18n()
  const [tab, setTab] = useState<'group' | 'student'>('group')
  const [groupId, setGroupId] = useState<string>('')
  const [group, setGroup] = useState<GroupInsight | null>(null)
  const [studentId, setStudentId] = useState<string>('')
  const [student, setStudent] = useState<StudentInsight | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    listGroups()
      .then((r) => {
        if (!active) return
        if (r.groups[0]) setGroupId(r.groups[0].id)
        else setLoading(false)
      })
      .catch(() => active && setError(true))
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!groupId) return
    let active = true
    setLoading(true); setError(false)
    getGroupInsights(groupId, language)
      .then((g) => { if (active) { setGroup(g); if (g.students[0]) setStudentId(g.students[0].learner_id) } })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [groupId, language])

  useEffect(() => {
    if (!studentId || tab !== 'student') return
    let active = true
    getStudentInsights(studentId, language)
      .then((s) => active && setStudent(s))
      .catch(() => active && setStudent(null))
    return () => { active = false }
  }, [studentId, tab, language])

  if (loading && !group) return <div className="tv-wrap"><LoadingState title={t('teacher.loading')} /></div>
  if (error) return <div className="tv-wrap"><ErrorState title={t('teacher.error')} /></div>

  return (
    <div className="tv-wrap">
      <SectionHeader title={t('teacher.title')} subtitle={t('teacher.subtitle')} />
      <div className="tv-tabs" role="tablist">
        <button className={`tv-tab ${tab === 'group' ? 'tv-tab--active' : ''}`} onClick={() => setTab('group')}>
          {t('teacher.tab.group')}
        </button>
        <button className={`tv-tab ${tab === 'student' ? 'tv-tab--active' : ''}`} onClick={() => setTab('student')}>
          {t('teacher.tab.student')}
        </button>
      </div>

      {tab === 'group' ? (
        <GroupView group={group} onPick={(id) => { setStudentId(id); setTab('student') }} />
      ) : (
        <StudentView group={group} studentId={studentId} student={student} onSelect={setStudentId} />
      )}
    </div>
  )
}

function GroupView({ group, onPick }: { group: GroupInsight | null; onPick: (id: string) => void }) {
  const { t } = useI18n()
  if (!group || group.students.length === 0) return <EmptyState title={t('teacher.noStudents')} />
  const tr = group.trends
  const stats: [number, string][] = [
    [tr.students_total, t('teacher.trends.students')],
    [tr.active_last_7d, t('teacher.trends.active')],
    [tr.needing_attention, t('teacher.trends.attention')],
    [tr.objectives_mastered_total, t('teacher.trends.mastered')],
  ]
  return (
    <>
      <div className="tv-stats">
        {stats.map(([v, l], i) => (
          <Card key={i} className="tv-stat">
            <div className="tv-stat__value">{v}</div>
            <div className="tv-stat__label">{l}</div>
          </Card>
        ))}
      </div>

      <Panel>
        <SectionHeader title={t('teacher.attention.title')} />
        {group.attention.length === 0 ? (
          <p style={{ color: 'var(--sp-ink-400)', fontSize: 'var(--sp-fs-sm)' }}>{t('teacher.attention.none')}</p>
        ) : (
          <div className="tv-list">
            {group.attention.map((a) => (
              <Card key={a.learner_id} interactive className={`tv-row${a.kind === 'wellbeing' ? ' tv-row--wellbeing' : ''}`} onClick={() => onPick(a.learner_id)}>
                <span className="tv-row__name" dir="auto">
                  {a.kind === 'wellbeing' && <span className="tv-wellbeing__mark" aria-hidden="true">🚨</span>}
                  {a.display_name || a.learner_id}
                </span>
                <span className="tv-row__meta">
                  <StatusPill tone="support">{a.reason}</StatusPill>
                  <EvidenceChip label={t('teacher.evidence')}>{a.evidence}</EvidenceChip>
                </span>
              </Card>
            ))}
          </div>
        )}
      </Panel>

      <div style={{ height: 'var(--sp-4)' }} />
      <Panel>
        <SectionHeader title={t('teacher.tab.group')} />
        <div className="tv-list">
          {group.students.map((s) => (
            <Card key={s.learner_id} interactive className="tv-row" onClick={() => onPick(s.learner_id)}>
              <span className="tv-row__name" dir="auto">{s.display_name || s.learner_id}</span>
              <span className="tv-row__meta">
                {s.attention
                  ? <StatusPill tone="support">{s.attention.reason}</StatusPill>
                  : <StatusPill tone="steady">{t('teacher.ok')}</StatusPill>}
                <Icon name="arrow" size={16} />
              </span>
            </Card>
          ))}
        </div>
      </Panel>
    </>
  )
}

function StudentView({
  group, studentId, student, onSelect,
}: {
  group: GroupInsight | null
  studentId: string
  student: StudentInsight | null
  onSelect: (id: string) => void
}) {
  const { t } = useI18n()
  const options = group?.students || []

  return (
    <>
      <div className="tv-selectrow">
        <label htmlFor="tv-sel">{t('teacher.selectStudent')}</label>
        <select id="tv-sel" className="tv-select" value={studentId} onChange={(e) => onSelect(e.target.value)}>
          {options.map((s) => (
            <option key={s.learner_id} value={s.learner_id}>{s.display_name || s.learner_id}</option>
          ))}
        </select>
      </div>

      {!student ? (
        <LoadingState title={t('teacher.loading')} />
      ) : (
        <>
          {student.wellbeing_flags && student.wellbeing_flags.length > 0 && (
            <Card className="tv-wellbeing" style={{ marginBlockEnd: 'var(--sp-4)' }}>
              <div className="tv-wellbeing__head">
                <span className="tv-wellbeing__mark" aria-hidden="true">🚨</span>
                <strong>{t('teacher.wellbeing.title')}</strong>
              </div>
              <p className="tv-wellbeing__note">{t('teacher.wellbeing.note')}</p>
              <div className="tv-wellbeing__list">
                {student.wellbeing_flags.map((w, i) => (
                  <EvidenceChip key={i} label={t('teacher.evidence')}>{w.evidence}</EvidenceChip>
                ))}
              </div>
            </Card>
          )}
          {student.attention && student.attention.kind !== 'wellbeing' && (
            <Card style={{ marginBlockEnd: 'var(--sp-4)' }}>
              <span className="tv-row__meta">
                <StatusPill tone="support">{student.attention.reason}</StatusPill>
                <EvidenceChip label={t('teacher.evidence')}>{student.attention.evidence}</EvidenceChip>
              </span>
            </Card>
          )}

          <div className="tv-grid">
            <Panel>
              <SectionHeader title={t('teacher.progress')} />
              <div className="tv-progress">
                {Object.entries(student.progress).map(([subject, p]) => {
                  const pct = p.objectives_total ? Math.round((p.objectives_mastered / p.objectives_total) * 100) : 0
                  return (
                    <div key={subject} className="tv-progress__row">
                      <div className="tv-progress__head">
                        <span>{subject}</span><span>{p.objectives_mastered}/{p.objectives_total}</span>
                      </div>
                      <div className="tv-bar"><div className="tv-bar__fill" style={{ inlineSize: `${pct}%` }} /></div>
                    </div>
                  )
                })}
              </div>
            </Panel>

            <Panel>
              <SectionHeader title={t('teacher.strengths')} />
              <div className="tv-chips">
                {student.strengths.map((s, i) => <StatusPill key={i} tone="strong">{s}</StatusPill>)}
              </div>
              <div style={{ height: 'var(--sp-4)' }} />
              <SectionHeader title={t('teacher.struggles')} />
              <div className="tv-chips">
                {student.struggle_items.map((s, i) => <StatusPill key={i} tone="support">{s.label}</StatusPill>)}
              </div>
            </Panel>

            <Panel>
              <SectionHeader title={t('teacher.recommendations')} />
              <ol className="tv-recs">
                {student.recommendations.map((r, i) => <li key={i} dir="auto">{r}</li>)}
              </ol>
            </Panel>

            <Panel>
              <SectionHeader title={t('teacher.timeline')} />
              <div className="tv-timeline">
                {student.timeline.map((e, i) => (
                  <div key={i} className="tv-tl">
                    <span className={`tv-tl__dot tv-tl__dot--${e.success === true ? 'ok' : e.success === false ? 'no' : 'n'}`} />
                    <span dir="auto">{e.verb} · {e.objective_id}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div style={{ height: 'var(--sp-4)' }} />
          <DirectiveComposer learnerId={studentId} />
        </>
      )}
    </>
  )
}

function DirectiveComposer({ learnerId }: { learnerId: string }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true); setSaved(false)
    try {
      await saveDirective(learnerId, text.trim(), { priority: 'high' })
      setSaved(true); setText('')
    } catch { /* keep silent; teacher can retry */ }
    finally { setBusy(false) }
  }

  return (
    <Panel>
      <SectionHeader title={t('teacher.directive.title')} />
      <div className="tv-directive">
        <textarea value={text} onChange={(e) => { setText(e.target.value); setSaved(false) }}
          placeholder={t('teacher.directive.placeholder')} dir="auto" />
        <button className="tv-btn" onClick={submit} disabled={busy || !text.trim()}>
          {t('teacher.directive.send')}
        </button>
        {saved && <span className="tv-saved">{t('teacher.directive.saved')}</span>}
      </div>
    </Panel>
  )
}
