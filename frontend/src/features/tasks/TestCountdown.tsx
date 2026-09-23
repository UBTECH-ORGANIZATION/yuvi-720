import { useEffect, useState } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { formatTestTime, remainingTestSeconds } from './taskTime'

interface Props {
  minutes: number
  startedAt?: string | null
  onStart: () => Promise<{ test_started_at: string }>
}

export function TestCountdown({ minutes, startedAt, onStart }: Props) {
  const { t } = useI18n()
  const [start, setStart] = useState(startedAt)
  const [now, setNow] = useState(Date.now)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const remaining = remainingTestSeconds(start, minutes, now)

  useEffect(() => {
    if (remainingTestSeconds(start, minutes, Date.now()) !== null) return
    let active = true
    setFailed(false)
    void onStart().then((result) => {
      if (!active) return
      if (remainingTestSeconds(result.test_started_at, minutes, Date.now()) === null) {
        setFailed(true)
        return
      }
      setStart(result.test_started_at)
      setNow(Date.now())
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [start, minutes, onStart, retry])

  const ticking = remaining !== null && remaining > 0
  useEffect(() => {
    if (!ticking) return
    const tick = () => setNow(Date.now())
    const interval = window.setInterval(tick, 1000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [ticking])

  return (
    <div className="yv-player__clock">
      <p className="yv-player__limit" role="timer" aria-live="off">
        <Icon name="clock" size={15} />
        <span>{t(remaining === null
          ? (failed ? 'tasks.test.timerFailed' : 'tasks.test.timerStarting')
          : 'tasks.test.remaining')}</span>
        {remaining !== null ? <bdi className="yv-player__clockValue">{formatTestTime(remaining)}</bdi> : null}
      </p>
      {failed ? (
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                onClick={() => setRetry((previous) => previous + 1)}>
          {t('tasks.test.timerRetry')}
        </button>
      ) : null}
      {remaining === 0 ? <p className="yv-player__limit" role="status">{t('tasks.test.expired')}</p> : null}
    </div>
  )
}