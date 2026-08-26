import { useState } from 'react'
import { Modal } from '../../components/primitives/Modal'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../providers/AuthProvider'

/* Multi-institution picker.

   Connection guidelines §5.2.ו: a teacher or a child may belong to more than
   one school, and the ministry recommends letting them choose rather than
   guessing. Below two placements there is nothing to choose and this renders
   nothing.

   The choice is a *view scope*, not a grant — every route still re-derives
   access from the org graph — so it lives in preferences like the teacher's
   class selection, and a stale value can only cost a wrong-looking screen. */

export function InstitutionGate() {
  const { t, direction } = useI18n()
  const { user, updatePreferences } = useAuth()
  const [pending, setPending] = useState<string | null>(null)

  const institutions = user?.institutions ?? []
  const needsChoice =
    Boolean(user) &&
    user?.identity_source === 'moe' &&
    institutions.length > 1 &&
    !user?.preferences.active_institution

  if (!needsChoice) return null

  const choose = async (symbol: string) => {
    if (pending) return
    setPending(symbol)
    try {
      await updatePreferences({ active_institution: symbol })
    } finally {
      setPending(null)
    }
  }

  const label = (row: (typeof institutions)[number]) => {
    // `6/2`, not `62` — the two ministry fields are a class and its parallel.
    const classroom = [row.school_class, row.parallel].filter(Boolean).join('/')
    return classroom
      ? t('auth.institution.optionWithClass', { symbol: row.symbol, classroom })
      : t('auth.institution.option', { symbol: row.symbol })
  }

  return (
    <Modal
      open
      onClose={() => undefined}
      dismissible={false}
      titleId="institution-title"
      className="institution-picker"
    >
      <div dir={direction}>
        <h2 className="sp-modal__title" id="institution-title">{t('auth.institution.title')}</h2>
        <p className="sp-modal__subtitle">{t('auth.institution.subtitle')}</p>
        <ul className="institution-picker__list">
          {institutions.map((row) => (
            <li key={`${row.symbol}:${row.entity_type}`}>
              <button
                type="button"
                className="sp-btn sp-btn--pill institution-picker__option"
                disabled={pending !== null}
                onClick={() => choose(row.symbol)}
              >
                {label(row)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
