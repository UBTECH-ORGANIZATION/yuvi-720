import { useEffect, useRef, useState } from 'react'
import { navigate } from '../app/router'
import { useI18n } from '../i18n/I18nProvider'
import { useRewards } from '../providers/RewardsProvider'
import { Icon } from './primitives'
import './wallet-chip.css'

/* The spark balance, shown wherever the learner can earn or spend.

   It is effort feedback, not an assessment: no percentages, no comparison to
   anyone else. Clicking it opens the studio, where sparks are actually useful. */

export function WalletChip({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const { wallet } = useRewards()
  const balance = wallet?.balance ?? null
  const [isEarning, setIsEarning] = useState(false)
  const previous = useRef<number | null>(null)

  useEffect(() => {
    if (balance === null) return
    const grew = previous.current !== null && balance > previous.current
    previous.current = balance
    if (!grew) return
    setIsEarning(true)
    const timer = window.setTimeout(() => setIsEarning(false), 600)
    return () => window.clearTimeout(timer)
  }, [balance])

  if (!wallet) return null

  return (
    <button
      type="button"
      className={`wallet-chip${compact ? ' is-compact' : ''}${isEarning ? ' is-earning' : ''}`}
      onClick={() => navigate('/yuvi-studio')}
      title={t('rewards.chip.hint')}
      aria-label={t('rewards.chip.aria').replace('{count}', String(wallet.balance))}
    >
      <Icon name="spark" size={16} />
      <span className="wallet-chip-amount">{wallet.balance}</span>
      {!compact && <span className="wallet-chip-label">{t('rewards.currency')}</span>}
    </button>
  )
}
