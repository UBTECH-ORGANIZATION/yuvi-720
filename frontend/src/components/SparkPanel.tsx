import { useEffect, useRef, useState } from 'react'
import { navigate } from '../app/router'
import { useI18n } from '../i18n/I18nProvider'
import { useRewards } from '../providers/RewardsProvider'
import { getLedger, getShop, type LedgerEntry } from '../services/rewards'
import { Icon } from './primitives'
import './spark-panel.css'

/* The "where do my sparks come from" panel.

   Answers three questions in one place: how many sparks I have, how earning
   works (straight from the server rules, never hardcoded here), and where the
   last ones actually came from. Effort history only — no scores, no comparison
   to other learners. */

const STAGE_ORDER: Array<'started' | 'progressed' | 'summarized'> = ['started', 'progressed', 'summarized']

function reasonLabel(t: (key: string) => string, reason: string) {
  const key = `rewards.earned.${reason}`
  const text = t(key)
  return text === key ? reason : text
}

export function SparkPanel({ onClose }: { onClose: () => void }) {
  const { t, language } = useI18n()
  const { wallet } = useRewards()
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null)
  // How far the next locked item is — the concrete reason to finish a goal.
  const [gap, setGap] = useState(0)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    getLedger(8)
      .then((data) => { if (active) setEntries(data.entries) })
      .catch(() => { if (active) setEntries([]) })
    getShop()
      .then(({ items, wallet: fresh }) => {
        if (!active) return
        const missing = items
          .filter((item) => !item.owned && item.price > fresh.balance)
          .map((item) => item.price - fresh.balance)
        setGap(missing.length ? Math.min(...missing) : 0)
      })
      .catch(() => { if (active) setGap(0) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onClick = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    // Deferred so the click that opened the panel does not close it again.
    const timer = window.setTimeout(() => document.addEventListener('mousedown', onClick), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
      window.clearTimeout(timer)
    }
  }, [onClose])

  if (!wallet) return null
  const rules = wallet.rules

  return (
    <div className="spark-panel" ref={panel} role="dialog" aria-label={t('rewards.panel.title')}>
      <div className="spark-panel__head">
        <span className="spark-panel__balance">
          <Icon name="spark" size={18} />
          <strong>{wallet.balance}</strong>
          {t('rewards.currency')}
        </span>
        <button type="button" className="spark-panel__close" onClick={onClose} aria-label={t('rewards.shop.cancel')}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <p className="spark-panel__lede">{t('rewards.panel.lede')}</p>

      <h4 className="spark-panel__heading">{t('rewards.panel.earnTitle')}</h4>
      <ul className="spark-panel__rules">
        {STAGE_ORDER.map((stage) => {
          const share = rules?.stageShares?.[stage]
          if (!share) return null
          return (
            <li key={stage}>
              <span className="spark-panel__ruleText">{reasonLabel(t, `goal.${stage}`)}</span>
              <span className="spark-panel__ruleAmount">
                {t('rewards.panel.share', { percent: Math.round(share * 100) })}
              </span>
            </li>
          )
        })}
        {rules?.help ? (
          <li>
            <span className="spark-panel__ruleText">{reasonLabel(t, 'goal.help')}</span>
            <span className="spark-panel__ruleAmount">+{rules.help}</span>
          </li>
        ) : null}
      </ul>

      <h4 className="spark-panel__heading">{t('rewards.panel.historyTitle')}</h4>
      {entries === null ? (
        <p className="spark-panel__empty">{t('rewards.panel.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="spark-panel__empty">{t('rewards.panel.empty')}</p>
      ) : (
        <ul className="spark-panel__history">
          {entries.map((entry) => (
            <li key={`${entry.at}-${entry.reason}`}>
              <span className="spark-panel__historyText" dir="auto">
                {entry.kind === 'spend' ? t('rewards.panel.spent') : reasonLabel(t, entry.reason)}
              </span>
              <span className="spark-panel__historyMeta">
                <span className={`spark-panel__delta is-${entry.kind}`}>
                  {entry.kind === 'spend' ? '−' : '+'}{Math.abs(entry.amount)}
                </span>
                <time dateTime={entry.at}>
                  {new Date(entry.at).toLocaleDateString(language, { day: 'numeric', month: 'short' })}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="spark-panel__cta"
        onClick={() => { onClose(); navigate('/yuvi-studio') }}
      >
        {t('rewards.panel.spend')}
      </button>

      {gap > 0 && (
        <>
          <p className="spark-panel__nudge">{t('rewards.panel.nudge', { count: gap })}</p>
          <button
            type="button"
            className="spark-panel__cta is-quiet"
            onClick={() => { onClose(); navigate('/mentoring') }}
          >
            {t('rewards.panel.toGoals')}
          </button>
        </>
      )}
    </div>
  )
}
