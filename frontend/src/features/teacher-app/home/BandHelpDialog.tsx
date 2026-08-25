/* How a student's band is decided (#450) — the ? on the students card.
 *
 * The classifier is deterministic (teacher_bands.py) and this dialog is its
 * teacher-facing contract: the same rules, in teacher words, one section per
 * band. Kept honest by hand — if a rule changes there, its sentence changes
 * here. Per-student whys live in the row's own dialog; this explains the
 * system.
 */

import { Icon } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { BandFace, type Band } from './BandFace'

export function BandHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  return (
    <Modal open={open} onClose={onClose} titleId="tch-band-help" className="tch-bandHelp">
      <header className="tch-bandHelp__head">
        <h2 id="tch-band-help">{t('tch.band.help.title')}</h2>
        <button
          type="button"
          className="sp-btn sp-btn--ghost sp-btn--sm"
          onClick={onClose}
          aria-label={t('tch.band.dialogClose')}
        >
          <Icon name="close" size={16} aria-hidden />
        </button>
      </header>
      <p className="tch-bandHelp__intro">{t('tch.band.help.intro')}</p>
      <div className="tch-bandHelp__bands">
        {(['red', 'orange', 'green'] as Band[]).map((band) => (
          <section key={band} className={`tch-bandHelp__band is-${band}`}>
            <h3>
              <BandFace band={band} size={22} />
              {t(`tch.band.${band}`)}
            </h3>
            <p>{t(`tch.band.help.${band}`)}</p>
          </section>
        ))}
      </div>
      {/* the momentum legend: each trend icon paired with its meaning in one
          chip, so the marks read as symbols with names — not floating arrows */}
      <div className="tch-bandHelp__new">
        <span>{t('tch.band.help.new')}</span>
        <span className="tch-bandHelp__legend">
          <span className="tch-bands__move is-up"><Icon name="trendUp" size={13} aria-hidden /></span>
          {t('tch.band.help.up')}
        </span>
        <span className="tch-bandHelp__legend">
          <span className="tch-bands__move is-down"><Icon name="trendDown" size={13} aria-hidden /></span>
          {t('tch.band.help.down')}
        </span>
      </div>
    </Modal>
  )
}
