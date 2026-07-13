import { useEffect, useState } from 'react'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { useI18n } from '../../i18n/I18nProvider'
import {
  createMentoring, listMentoring, type MentoringConversation,
} from '../../services/mentoring'
import {
  Panel, SectionHeader, Card, StatusPill, EvidenceChip,
  EmptyState, LoadingState, ErrorState,
} from '../../components/primitives'
import './mentoring-view.css'

/**
 * Mentoring (720 Feature 5) — real, wired to `services/mentoring.ts`.
 * Required fields (date, teacher, learner, stage, notes, next steps, deadline),
 * visibility + teacher-only notes, and next-steps mirror to the learner's goals.
 */
export function MentoringPage() {
  const { t, language } = useI18n()
  const [role, setRole] = useState<'teacher' | 'learner'>('teacher')
  const [rows, setRows] = useState<MentoringConversation[] | null>(null)
  const [error, setError] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    setRows(null); setError(false)
    listMentoring(role)
      .then((r) => active && setRows(r.conversations))
      .catch(() => active && setError(true))
    return () => { active = false }
  }, [role, reload])

  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
      <LearnerAppBar />
      <main className="mt-wrap">
      <SectionHeader title={t('mentoring.title')} subtitle={t('mentoring.subtitle')} />

      <div className="mt-roles" role="tablist">
        {(['teacher', 'learner'] as const).map((r) => (
          <button key={r} className={`mt-role ${role === r ? 'mt-role--active' : ''}`} onClick={() => setRole(r)}>
            {t(`mentoring.role.${r}`)}
          </button>
        ))}
      </div>

      <ConversationForm
        role={role} today={today} onSaved={() => setReload((x) => x + 1)}
      />

      {error ? (
        <ErrorState title={t('mentoring.error')} />
      ) : rows === null ? (
        <LoadingState title={t('mentoring.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('mentoring.empty')} />
      ) : (
        <div className="mt-list">
          {rows.map((c) => (
            <Card key={c.id}>
              <div className="mt-conv__head">
                <StatusPill tone="steady">{c.meeting_stage}</StatusPill>
                <span className="mt-conv__date">{c.date}</span>
              </div>
              <div className="mt-conv__row" dir="auto"><span className="mt-conv__label">{t('mentoring.field.notes')}: </span>{c.notes}</div>
              <div className="mt-conv__row" dir="auto"><span className="mt-conv__label">{t('mentoring.field.nextSteps')}: </span>{c.next_steps}</div>
              <div className="mt-conv__row" dir="auto"><span className="mt-conv__label">{t('mentoring.field.deadline')}: </span>{c.deadline}</div>
              {role === 'teacher' && c.teacher_only_note ? (
                <div className="mt-conv__row" dir="auto"><span className="mt-conv__label">{t('mentoring.field.teacherOnly')}: </span>{c.teacher_only_note}</div>
              ) : null}
              {c.visibility !== 'teacher_only' && c.next_steps ? (
                <div className="mt-conv__goal"><EvidenceChip label="✓">{t('mentoring.goalMirrored')}</EvidenceChip></div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      </main>
    </>
  )
}

function ConversationForm({
  role, today, onSaved,
}: {
  role: 'teacher' | 'learner'
  today: string
  onSaved: () => void
}) {
  const { t } = useI18n()
  const empty: MentoringConversation = {
    date: today, teacher_name: '', learner_name: '', meeting_stage: '',
    notes: '', next_steps: '', deadline: '', visibility: 'shared', teacher_only_note: '',
  }
  const [form, setForm] = useState<MentoringConversation>(empty)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = (k: keyof MentoringConversation, v: string) => {
    setForm((f) => ({ ...f, [k]: v })); setSaved(false)
  }
  const valid = form.notes.trim() && form.next_steps.trim() && form.deadline.trim()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      await createMentoring({ ...form, author: role })
      setForm(empty); setSaved(true); onSaved()
    } catch { /* teacher can retry */ }
    finally { setBusy(false) }
  }

  return (
    <Panel style={{ marginBlockEnd: 'var(--sp-6)' }}>
      <SectionHeader title={t('mentoring.new')} />
      <form className="mt-form" onSubmit={submit}>
        <Field label={t('mentoring.field.date')}><input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label={t('mentoring.field.stage')}>
          <select value={form.meeting_stage} onChange={(e) => set('meeting_stage', e.target.value)}>
            <option value="">—</option>
            <option value={t('mentoring.stage.opening')}>{t('mentoring.stage.opening')}</option>
            <option value={t('mentoring.stage.followup')}>{t('mentoring.stage.followup')}</option>
            <option value={t('mentoring.stage.summary')}>{t('mentoring.stage.summary')}</option>
          </select>
        </Field>
        <Field label={t('mentoring.field.teacher')}><input value={form.teacher_name} onChange={(e) => set('teacher_name', e.target.value)} dir="auto" /></Field>
        <Field label={t('mentoring.field.learner')}><input value={form.learner_name} onChange={(e) => set('learner_name', e.target.value)} dir="auto" /></Field>
        <Field label={t('mentoring.field.notes')} full><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} dir="auto" /></Field>
        <Field label={t('mentoring.field.nextSteps')} full><textarea value={form.next_steps} onChange={(e) => set('next_steps', e.target.value)} dir="auto" /></Field>
        <Field label={t('mentoring.field.deadline')}><input type="date" value={form.deadline} onChange={(e) => set('deadline', e.target.value)} /></Field>
        <Field label={t('mentoring.field.visibility')}>
          <select value={form.visibility} onChange={(e) => set('visibility', e.target.value)}>
            <option value="shared">{t('mentoring.visibility.shared')}</option>
            <option value="teacher_only">{t('mentoring.visibility.teacherOnly')}</option>
          </select>
        </Field>
        {role === 'teacher' && (
          <Field label={t('mentoring.field.teacherOnly')} full>
            <textarea value={form.teacher_only_note} onChange={(e) => set('teacher_only_note', e.target.value)} dir="auto" />
          </Field>
        )}
        <div className="mt-actions mt-full">
          <button className="mt-btn" type="submit" disabled={busy || !valid}>{t('mentoring.save')}</button>
          {saved && <span className="mt-saved">{t('mentoring.saved')}</span>}
        </div>
      </form>
    </Panel>
  )
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={`mt-field ${full ? 'mt-full' : ''}`}>
      <label>{label}</label>
      {children}
    </div>
  )
}
