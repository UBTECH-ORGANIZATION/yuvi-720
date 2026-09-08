/* Games — what the Learning Game Lab costs, per learner, and the daily caps.
 *
 * A game build is the most expensive single thing a learner can trigger, so
 * the cap that stops "Yuvi built all the games allowed for today" is managed
 * here, not in a deployment env. Three layers: the env values are the floor,
 * the admin defaults replace them for everyone, and a per-learner override
 * replaces those for one kid (a pilot, a demo account, a teacher testing).
 *
 * Cost is what the worker measured per job, failed builds included — a failed
 * build spent the money too. Sparks are the same number in cents, the figure
 * the learner sees on the card.
 */

import { useEffect, useMemo, useState } from 'react'
import { EmptyState, Panel } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import {
  getGamesUsage, resetLearnerGameCaps, setGameCapDefaults, setLearnerGameCaps,
  type GameCaps, type GameUsageReport, type GameUsageRow,
} from '../../services/admin'
import type { AdminData } from './AdminConsolePage'
import { AdminSection, RefusalNotice, useAdminMutation } from './AdminShared'

const usd = (value: number) => `$${value.toFixed(2)}`

export function AdminGamesTab({ data }: { data: AdminData }) {
  const { t } = useI18n()
  const [report, setReport] = useState<GameUsageReport | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let active = true
    getGamesUsage().then((result) => { if (active) setReport(result) }).catch(() => {})
    return () => { active = false }
  }, [nonce])

  const refresh = () => setNonce((value) => value + 1)
  const mutation = useAdminMutation(refresh)

  if (!report) return <Panel className="adm-panel">{t('adm.loading')}</Panel>

  const listed = new Set(report.learners.map((row) => row.learner_id))
  const unlisted = data.people.filter(
    (person) => person.roles.includes('learner') && !listed.has(person.user_id),
  )

  return (
    <div className="adm-tab">
      <RefusalNotice code={mutation.code} retry={mutation.retry} onDismiss={mutation.clear} />

      <AdminSection title={t('adm.games.totals')}>
        <div className="adm-counts">
          <Panel className="adm-count">
            <span className="adm-count__label">{t('adm.games.total.cost')}</span>
            <span className="adm-count__value">{usd(report.totals.cost_usd)}</span>
          </Panel>
          <Panel className="adm-count">
            <span className="adm-count__label">{t('adm.games.total.today')}</span>
            <span className="adm-count__value">{usd(report.totals.cost_today_usd)}</span>
          </Panel>
          <Panel className="adm-count">
            <span className="adm-count__label">{t('adm.games.total.games')}</span>
            <span className="adm-count__value">{report.totals.games}</span>
          </Panel>
          <Panel className="adm-count">
            <span className="adm-count__label">{t('adm.games.total.jobs')}</span>
            <span className="adm-count__value">
              {report.totals.jobs}
              {report.totals.jobs_failed ? (
                <small className="adm-muted"> · {t('adm.games.failed', { count: report.totals.jobs_failed })}</small>
              ) : null}
            </span>
          </Panel>
          <Panel className="adm-count">
            <span className="adm-count__label">{t('adm.games.total.learners')}</span>
            <span className="adm-count__value">{report.totals.learners}</span>
          </Panel>
        </div>
      </AdminSection>

      <AdminSection title={t('adm.games.defaults')} hint={t('adm.games.defaults.hint')}>
        <Panel className="adm-panel">
          <CapsForm
            key={`${report.defaults.create_per_day}-${report.defaults.edit_per_day}`}
            caps={report.defaults}
            busy={mutation.busy}
            onSave={(caps) => mutation.run(() => setGameCapDefaults(caps))}
          />
          <p className="adm-panel__hint">
            {t(`adm.games.source.${report.defaults.source}`)}
            {' · '}
            {t('adm.games.env', { create: report.env.create_per_day, edit: report.env.edit_per_day })}
          </p>
        </Panel>
      </AdminSection>

      <AdminSection title={t('adm.games.learners')} hint={t('adm.games.learners.hint')}>
        {report.learners.length ? (
          <div className="adm-table__wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>{t('adm.games.col.learner')}</th>
                  <th>{t('adm.games.col.games')}</th>
                  <th>{t('adm.games.col.jobs')}</th>
                  <th>{t('adm.games.col.cost')}</th>
                  <th>{t('adm.games.col.today')}</th>
                  <th>{t('adm.games.col.caps')}</th>
                </tr>
              </thead>
              <tbody>
                {report.learners.map((row) => (
                  <LearnerRow key={row.learner_id} row={row} busy={mutation.busy}
                    onSave={(caps) => mutation.run(() => setLearnerGameCaps(row.learner_id, caps))}
                    onReset={() => mutation.run(() => resetLearnerGameCaps(row.learner_id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="gamepad" title={t('adm.games.empty')} />
        )}
      </AdminSection>

      {unlisted.length ? (
        <AdminSection title={t('adm.games.add')} hint={t('adm.games.add.hint')}>
          <Panel className="adm-panel">
            <AddOverride
              people={unlisted.map((person) => ({
                id: person.user_id, name: person.display_name || person.username || person.user_id,
              }))}
              defaults={report.defaults}
              busy={mutation.busy}
              onSave={(learnerId, caps) => mutation.run(() => setLearnerGameCaps(learnerId, caps))}
            />
          </Panel>
        </AdminSection>
      ) : null}
    </div>
  )
}

function LearnerRow({ row, busy, onSave, onReset }: {
  row: GameUsageRow
  busy: boolean
  onSave: (caps: { create_per_day: number; edit_per_day: number }) => void
  onReset: () => void
}) {
  const { t } = useI18n()
  const own = row.caps.source === 'learner'
  const atCap = row.creates_today >= row.caps.create_per_day
  return (
    <tr className={atCap ? 'is-capped' : ''}>
      <td dir="auto">
        <strong>{row.display_name || row.username || row.learner_id}</strong>
        <code className="adm-id">{row.learner_id}</code>
        {row.note ? <div className="adm-muted">{row.note}</div> : null}
      </td>
      <td>
        {row.games}
        {row.games_deleted ? <small className="adm-muted"> (+{row.games_deleted})</small> : null}
      </td>
      <td>
        {row.jobs}
        {row.jobs_failed ? (
          <small className="adm-muted"> · {t('adm.games.failed', { count: row.jobs_failed })}</small>
        ) : null}
      </td>
      <td>
        <strong>{usd(row.cost_usd)}</strong>
        <div className="adm-muted">{t('adm.games.sparks', { count: row.sparks })}</div>
      </td>
      <td>
        <div>{t('adm.games.today.creates', { used: row.creates_today, cap: row.caps.create_per_day })}</div>
        <div>{t('adm.games.today.edits', { used: row.edits_today, cap: row.caps.edit_per_day })}</div>
        {row.cost_today_usd ? <div className="adm-muted">{usd(row.cost_today_usd)}</div> : null}
      </td>
      <td>
        <CapsForm
          key={`${row.caps.create_per_day}-${row.caps.edit_per_day}-${row.caps.source}`}
          caps={row.caps}
          busy={busy}
          compact
          onSave={onSave}
          onReset={own ? onReset : undefined}
        />
        <div className="adm-muted">{t(`adm.games.source.${row.caps.source}`)}</div>
      </td>
    </tr>
  )
}

function CapsForm({ caps, busy, compact, onSave, onReset }: {
  caps: GameCaps
  busy: boolean
  compact?: boolean
  onSave: (caps: { create_per_day: number; edit_per_day: number }) => void
  onReset?: () => void
}) {
  const { t } = useI18n()
  const [create, setCreate] = useState(String(caps.create_per_day))
  const [edit, setEdit] = useState(String(caps.edit_per_day))
  const parsed = useMemo(() => {
    const c = Number(create); const e = Number(edit)
    const ok = Number.isInteger(c) && Number.isInteger(e) && c >= 0 && e >= 0 && c <= 1000 && e <= 1000
    return ok ? { create_per_day: c, edit_per_day: e } : null
  }, [create, edit])
  const dirty = parsed && (parsed.create_per_day !== caps.create_per_day || parsed.edit_per_day !== caps.edit_per_day)

  return (
    <form
      className={`adm-caps${compact ? ' adm-caps--compact' : ''}`}
      onSubmit={(event) => { event.preventDefault(); if (parsed) onSave(parsed) }}
    >
      <label>
        <span>{t('adm.games.create')}</span>
        <input className="adm-capInput" type="number" min={0} max={1000} inputMode="numeric"
          value={create} onChange={(event) => setCreate(event.target.value)} disabled={busy} />
      </label>
      <label>
        <span>{t('adm.games.edit')}</span>
        <input className="adm-capInput" type="number" min={0} max={1000} inputMode="numeric"
          value={edit} onChange={(event) => setEdit(event.target.value)} disabled={busy} />
      </label>
      <button type="submit" className="sp-btn sp-btn--primary" disabled={busy || !dirty}>
        {t('adm.games.save')}
      </button>
      {onReset ? (
        <button type="button" className="sp-btn" disabled={busy} onClick={onReset}>
          {t('adm.games.reset')}
        </button>
      ) : null}
    </form>
  )
}

function AddOverride({ people, defaults, busy, onSave }: {
  people: { id: string; name: string }[]
  defaults: GameCaps
  busy: boolean
  onSave: (learnerId: string, caps: { create_per_day: number; edit_per_day: number }) => void
}) {
  const { t } = useI18n()
  const [learnerId, setLearnerId] = useState('')
  return (
    <div className="adm-caps adm-caps--add">
      <select className="adm-picker" value={learnerId} onChange={(event) => setLearnerId(event.target.value)} disabled={busy}>
        <option value="">{t('adm.games.add.pick')}</option>
        {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select>
      {learnerId ? (
        <CapsForm caps={{ ...defaults, source: 'learner' }} busy={busy} compact
          onSave={(caps) => { onSave(learnerId, caps); setLearnerId('') }} />
      ) : null}
    </div>
  )
}
