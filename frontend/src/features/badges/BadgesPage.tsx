import { useEffect, useMemo, useState } from 'react'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { Badge } from '../../components/Badge'
import { YuviHeadIcon } from '../../components/YuviHeadIcon'
import { ProfileAvatar, announceAvatarUpdated } from './ProfileAvatar'
import { getBadges, updateLearnerState } from '../../services/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../providers/AuthProvider'
import { useBrain } from '../../providers/BrainProvider'
import type { AvatarChoice, BadgeDTO } from './types'
import './badges-page.css'

type Category = BadgeDTO['category']

const COPY = {
  he: {
    title: 'ההישגים שלי',
    lead: 'כל מטבע הוא הישג. הטבעת מתמלאת ככל שמתקדמים, ומתחת לכל מטבע כתוב איך זוכים בו.',
    picture: 'התמונה שלך',
    pictureHint: 'בחרו מטבע שהשגתם כתמונת הפרופיל שלכם.',
    pictureChosen: 'מטבע נבחר כתמונת הפרופיל שלך.',
    coinsEarned: 'מטבעות',
    onTheWay: 'בדרך',
    quickPick: 'המטבעות שלך — הקישו כדי להשתמש כתמונה',
    reset: 'חזרה לאותיות',
    use: 'השתמש/י כתמונה',
    inUse: '✓ התמונה שלך',
    earned: 'הושג',
    locked: 'נעול',
    inprogress: 'בתהליך',
    howTo: 'איך זוכים?',
    sections: { subject: 'המקצועות שלי', milestone: 'הישגים מיוחדים', world: 'האתגר הגדול', coming: 'בקרוב' } as Record<Category, string>,
    empty: 'עוד אין כאן מטבעות — כל למידה שתסיימו תדליק אחד.',
    error: 'לא הצלחנו לטעון את ההישגים. נסו שוב.',
  },
  en: {
    title: 'My badges',
    lead: 'Each coin is an achievement. The ring fills as you progress, and under every coin is how to win it.',
    picture: 'Your picture',
    pictureHint: 'Pick a badge you earned as your profile picture.',
    pictureChosen: 'A badge is set as your profile picture.',
    coinsEarned: 'earned',
    onTheWay: 'in progress',
    quickPick: 'Your coins — tap one to use it as your picture',
    reset: 'Back to initials',
    use: 'Use as picture',
    inUse: '✓ Your picture',
    earned: 'Earned',
    locked: 'Locked',
    inprogress: 'In progress',
    howTo: 'How to earn',
    sections: { subject: 'My subjects', milestone: 'Special achievements', world: 'The big challenge', coming: 'Coming soon' } as Record<Category, string>,
    empty: 'No coins yet — every lesson you finish lights one up.',
    error: 'Could not load your badges. Try again.',
  },
} as const

const SECTION_ORDER: Category[] = ['subject', 'world', 'milestone', 'coming']

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '🙂'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

function sameBadge(choice: AvatarChoice, b: BadgeDTO): boolean {
  return choice.kind === 'badge' && choice.badge.subject === b.subject && choice.badge.tier === b.tier
}

export function BadgesPage() {
  const { language, t: tr } = useI18n()
  const { brain } = useBrain()
  const { user } = useAuth()
  const t = COPY[language === 'en' ? 'en' : 'he']
  const displayName = brain?.identity.display_name || user?.display_name || ''
  const username = user?.username

  const [badges, setBadges] = useState<BadgeDTO[] | null>(null)
  const [error, setError] = useState(false)
  const [choice, setChoice] = useState<AvatarChoice>({ kind: 'initial' })
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setError(false)
    getBadges(language)
      .then((data) => { if (alive) setBadges(data) })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [language])

  const fallback = useMemo(() => initialsOf(displayName), [displayName])
  const earnedBadges = useMemo(() => (badges ?? []).filter((b) => b.earned), [badges])
  const inProgressCount = useMemo(() => (badges ?? []).filter((b) => b.state === 'inprogress').length, [badges])
  const grouped = useMemo(() => {
    const map = new Map<Category, BadgeDTO[]>()
    for (const b of badges ?? []) {
      const arr = map.get(b.category) ?? []
      arr.push(b)
      map.set(b.category, arr)
    }
    return map
  }, [badges])

  async function useAsPicture(b: BadgeDTO) {
    const next: AvatarChoice = { kind: 'badge', badge: { subject: b.subject, glyph: b.glyph, tier: b.tier } }
    setBusy(`${b.subject}:${b.tier}`)
    try {
      await updateLearnerState({ avatar: next })
      setChoice(next)
      announceAvatarUpdated(next)
    } catch { /* server rejects un-earned badges; button only shows for earned */ }
    finally { setBusy(null) }
  }

  async function resetPicture() {
    const next: AvatarChoice = { kind: 'initial' }
    setBusy('reset')
    try {
      await updateLearnerState({ avatar: next })
      setChoice(next)
      announceAvatarUpdated(next)
    } finally { setBusy(null) }
  }

  const stateLabel = (b: BadgeDTO) => (b.state === 'earned' ? t.earned : b.state === 'locked' ? t.locked : t.inprogress)

  return (
    <>
      <LearnerAppBar />
      <main className="badges-page" dir={language === 'en' ? 'ltr' : 'rtl'}>
        <header className="badges-page__head">
          <h1>{t.title}</h1>
          <p>{t.lead}</p>
        </header>

        <div className="badges-layout">
          {/* sticky profile — stays visible on the side as the shelf scrolls */}
          <aside className="badges-profile">
            <YuviHeadIcon className="badges-profile__mascot" />
            <div className="badges-profile__avatar-wrap">
              <ProfileAvatar className="badges-profile__avatar" fallback={fallback} choice={choice} />
              <span className="badges-profile__glow" aria-hidden />
            </div>
            <strong className="badges-profile__name" dir="auto">{displayName}</strong>
            {username && <span className="badges-profile__handle" dir="ltr">@{username}</span>}
            <div className="badges-profile__tally">
              <span className="badges-profile__stat"><b>{earnedBadges.length}</b> {t.coinsEarned}</span>
              {inProgressCount > 0 && (
                <span className="badges-profile__stat badges-profile__stat--soft"><b>{inProgressCount}</b> {t.onTheWay}</span>
              )}
            </div>

            {earnedBadges.length > 0 && (
              <div className="badges-profile__shelf" aria-label={t.quickPick}>
                {earnedBadges.map((b) => (
                  <button
                    key={`${b.subject}:${b.tier}:${b.title}`}
                    type="button"
                    className={`badges-profile__coin${sameBadge(choice, b) ? ' is-active' : ''}`}
                    onClick={() => useAsPicture(b)}
                    disabled={busy === `${b.subject}:${b.tier}`}
                    title={t.use}
                    aria-label={b.title}
                  >
                    <Badge subject={b.subject} glyph={b.glyph} tier={b.tier} state="earned" mini noStars={b.noStars} motif={b.motif} />
                  </button>
                ))}
              </div>
            )}

            <span className="badges-profile__hint">{choice.kind === 'badge' ? t.pictureChosen : t.pictureHint}</span>
            {choice.kind === 'badge' && (
              <button type="button" className="badges-profile__reset" onClick={resetPicture} disabled={busy === 'reset'}>
                {t.reset}
              </button>
            )}
          </aside>

          <div className="badges-main">
            {error && <p className="badges-page__error">{t.error}</p>}
            {!error && badges && badges.length === 0 && <p className="badges-page__empty">{t.empty}</p>}

            {SECTION_ORDER.filter((cat) => grouped.has(cat)).map((cat) => (
              <section key={cat} className="badges-section">
                <h2 className="badges-section__title">{t.sections[cat]}</h2>
                <div className="badges-grid">
                  {(grouped.get(cat) ?? []).map((b) => {
                    const chosen = sameBadge(choice, b)
                    return (
                      <article key={`${b.subject}:${b.tier}:${b.title}`} className={`badge-card badge-card--${b.state}`}>
                        <div className="badge-card__coin">
                          <Badge
                            subject={b.subject}
                            glyph={b.glyph}
                            tier={b.tier}
                            state={b.state}
                            progress={b.progress}
                            title={b.title}
                            noStars={b.noStars}
                            motif={b.motif}
                          />
                        </div>
                        <h3 className="badge-card__title">{b.title}</h3>
                        <div className={`badge-card__state badge-card__state--${b.state}`}>
                          {stateLabel(b)}
                          {b.state === 'inprogress' && <span className="badge-card__pct">{Math.round(b.progress * 100)}%</span>}
                        </div>

                        {b.howToEarn && b.state !== 'earned' && (
                          <p className="badge-card__howto">
                            <span className="badge-card__howto-label">{t.howTo}</span>
                            {b.howToEarn}
                          </p>
                        )}

                        {/* A coin is worth something concrete: say what, so the
                            effort has a picture attached to it. */}
                        {(b.unlocks?.length ?? 0) > 0 && (
                          <p className="badge-card__unlocks">
                            <span className="badge-card__howto-label">{tr('badges.unlocks')}</span>
                            {b.unlocks!
                              .map((u) => tr(u.kind === 'prop'
                                ? `YuviStudio.room.item.${u.id}`
                                : `YuviStudio.item.${u.id}`))
                              .join(' · ')}
                          </p>
                        )}

                        {b.state === 'earned' && (
                          <button
                            type="button"
                            className={`badges-btn ${chosen ? 'badges-btn--chosen' : 'badges-btn--primary'}`}
                            onClick={() => useAsPicture(b)}
                            disabled={chosen || busy === `${b.subject}:${b.tier}`}
                          >
                            {chosen ? t.inUse : t.use}
                          </button>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
    </>
  )
}
