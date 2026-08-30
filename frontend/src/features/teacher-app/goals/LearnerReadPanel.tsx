/* "מה יובי רואה" — what Yuvi makes of this student, in words.
 *
 * Lifted out of `GoalDialog` so the mentoring composer can show the same
 * reading without a second implementation of it. It is context, never a draft:
 * the suggestions elsewhere on the screen are the goal, and this says why one
 * would be a good idea. Keeping those apart is what stops the screen becoming a
 * machine that writes the goal and a teacher who presses OK.
 *
 * Cached for a day server-side, and the panel says when it was written, because
 * a teacher acting on a reading is entitled to know how old it is.
 */

import { useEffect, useState } from 'react'
import { Icon, Skeleton } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { formatDay } from '../../../i18n/dates'
import { getLearnerRead, type LearnerRead } from '../../../services/teacher'

export function LearnerReadPanel({ learnerId }: { learnerId: string }) {
  const { t, language } = useI18n()
  const [read, setRead] = useState<LearnerRead | null>(null)
  const [busy, setBusy] = useState(false)

  const load = (refresh = false) => {
    setBusy(true)
    getLearnerRead(learnerId, language, refresh)
      .then(setRead)
      .catch(() => setRead({ unavailable: true }))
      .finally(() => setBusy(false))
  }

  useEffect(() => {
    let active = true
    setRead(null)
    getLearnerRead(learnerId, language)
      .then((result) => { if (active) setRead(result) })
      .catch(() => { if (active) setRead({ unavailable: true }) })
    return () => { active = false }
  }, [learnerId, language])

  return (
    <aside className="tch-goalRead">
      <header className="tch-goalRead__head">
        <strong>
          <Icon name="spark" size={14} aria-hidden />
          {t('tch.goalRead.title')}
        </strong>
        {read && !read.unavailable ? (
          <button type="button" className="tch-evidence__toggle"
                  disabled={busy} onClick={() => load(true)}>
            <Icon name="reflect" size={13} aria-hidden />
            {busy ? t('tch.tasks.working') : t('tch.goalRead.refresh')}
          </button>
        ) : null}
      </header>

      {read === null ? (
        <div aria-busy="true" className="tch-goalRead__loading">
          <Skeleton w="100%" h={13} /><Skeleton w="90%" h={13} /><Skeleton w="75%" h={13} />
        </div>
      ) : read.unavailable ? (
        <p className="tch-goalRead__none">{t('tch.goalRead.unavailable')}</p>
      ) : (
        <>
          {/* One paragraph, not four labeled sections: the reading is context
              a teacher absorbs in one breath before choosing a draft, and a
              headed document beside a form made the dialog two competing
              screens. The sentences are the same ones — joined, in the same
              order the sections told them. */}
          <p className="tch-goalRead__paragraph" dir="auto">
            {[...(read.overview ? [read.overview] : []),
              ...(read.subjects ?? []).flatMap((section) =>
                [...(section.summary ? [section.summary] : []), ...section.points])]
              .join(' ')
              || t('tch.goalRead.noImprovements')}
          </p>

          {read.suggestion ? (
            <p className="tch-goalRead__suggestion" dir="auto">
              <Icon name="target" size={13} aria-hidden />
              {read.suggestion}
            </p>
          ) : null}

          {/* How old this is. A reading a teacher acts on has a date on it. */}
          {read.generated_at ? (
            <p className="tch-goalRead__when">
              {t(read.stale ? 'tch.goalRead.stale' : 'tch.goalRead.asOf', {
                date: formatDay(read.generated_at),
              })}
            </p>
          ) : null}
        </>
      )}
    </aside>
  )
}
