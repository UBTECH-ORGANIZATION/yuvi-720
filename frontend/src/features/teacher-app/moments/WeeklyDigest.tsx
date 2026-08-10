/* The Sunday-morning brief: what changed this week, in three lines.
 *
 * Generated once per group per week and cached, so the panel is cheap no matter
 * how many teachers open Home.
 *
 * The source badge is deliberate. A teacher should be able to tell at a glance
 * whether a line was written by the model or computed straight from the numbers
 * — and either way the `because` opens to the datum, so a bullet that cannot be
 * checked cannot exist.
 */

import { useEffect, useState } from 'react'
import { Icon } from '../../../components/primitives/Icon'
import { useI18n } from '../../../i18n/I18nProvider'
import { getGroupDigest, type Digest } from '../../../services/teacher'
import { EvidenceToggle } from '../shared/EvidenceDisclosure'
import './moments-feed.css'

export function WeeklyDigest({ groupId }: { groupId: string }) {
  const { t, language } = useI18n()
  const [digest, setDigest] = useState<Digest | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    let active = true
    setDigest(null)
    getGroupDigest(groupId, language)
      .then((result) => { if (active) setDigest(result) })
      .catch(() => { if (active) setDigest({
        week: '', bullets: [], generated_at: null, source: 'empty', cached: false,
      }) })
    return () => { active = false }
  }, [groupId, language])

  async function refresh() {
    setIsBusy(true)
    try {
      setDigest(await getGroupDigest(groupId, language, true))
    } catch {
      /* keep whatever is on screen — a failed refresh is not a reason to blank it */
    } finally {
      setIsBusy(false)
    }
  }

  if (!digest) {
    /* The first fetch of the week generates via an LLM and can take seconds —
       returning null here left the panel as a silent empty box for that whole
       window, which read as broken rather than busy. */
    return <p className="tch-digest__none tch-digest__none--loading">{t('tch.digest.loading')}</p>
  }
  if (!digest.bullets.length) {
    return <p className="tch-digest__none">{t('tch.digest.none')}</p>
  }

  return (
    <div className="tch-digest">
      <div className="tch-digest__head">
        <span className="tch-digest__source">
          {t(digest.source === 'ai' ? 'tch.digest.source.ai' : 'tch.digest.source.fallback')}
        </span>
        <button
          type="button"
          className="tch-digest__refresh"
          onClick={refresh}
          disabled={isBusy}
        >
          <Icon name="reflect" size={13} aria-hidden />
          {t('tch.digest.refresh')}
        </button>
      </div>

      <ul className="tch-digest__list">
        {digest.bullets.map((bullet, index) => (
          <li key={index} className="tch-digest__bullet">
            <p dir="auto">
              {/* Model text renders as written; a computed line renders from its
                  key, so switching language re-renders it correctly. */}
              {bullet.text
                ?? t(bullet.text_key ?? '', bullet.params as Record<string, string | number>)}
            </p>
            <EvidenceToggle raw={bullet.because?.raw} />
          </li>
        ))}
      </ul>
    </div>
  )
}
